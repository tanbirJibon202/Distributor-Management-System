import fs from 'node:fs';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();
const results = { checkedAt: new Date().toISOString(), checks: [] };
await Promise.all([
  (async () => {
    try {
      const base = new URL(process.env.BKASH_BASE_URL);
      if (base.protocol !== 'https:' || base.hostname !== 'tokenized.sandbox.bka.sh') {
        throw Object.assign(new Error(), { code: 'NOT_SANDBOX' });
      }
      const response = await fetch(`${base.href.replace(/\/$/, '')}/tokenized/checkout/token/grant`, {
        method: 'POST', signal: AbortSignal.timeout(20000),
        headers: {
          'Content-Type': 'application/json', Accept: 'application/json',
          username: process.env.BKASH_USERNAME, password: process.env.BKASH_PASSWORD,
        },
        body: JSON.stringify({ app_key: process.env.BKASH_APP_KEY, app_secret: process.env.BKASH_APP_SECRET }),
      });
      const data = await response.json();
      results.checks.push({ check: 'bkash-grant', httpStatus: response.status,
        tokenReceived: typeof data.id_token === 'string' && data.id_token.length > 0,
        gatewayCode: data.statusCode ?? null });
    } catch (error) {
      results.checks.push({ check: 'bkash-grant', error: error.code || error.cause?.code || error.name });
    }
  })(),
  (async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
    try {
      await client.connect();
      const result = await client.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('users','orders','payments')");
      results.checks.push({ check: 'database', connected: true,
        ordersTable: result.rows.some(row => row.table_name === 'orders'),
        paymentsTable: result.rows.some(row => row.table_name === 'payments'),
        tokenVersionApplied: result.rows.some(row => row.table_name === 'users' && row.column_name === 'tokenVersion') });
    } catch (error) {
      results.checks.push({ check: 'database', connected: false, error: error.code || error.name });
    } finally {
      await client.end().catch(() => {});
    }
  })(),
]);
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/bkash-sandbox-preflight.json', `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
if (!results.checks.some(check => check.tokenReceived) || !results.checks.some(check => check.connected)) process.exitCode = 1;
