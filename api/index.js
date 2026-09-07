/**
 * Vercel serverless entry.
 *
 * server.ts is the process-based entry: it connects, seeds, registers the cron
 * schedule and listens. None of that applies here — Vercel imports this module
 * on a cold start and hands it one request at a time — so this deliberately
 * skips the bootstrap and only does the part a request actually needs.
 *
 * Two consequences worth knowing:
 *   - The hourly overdue/low-stock report does not run. A serverless deployment
 *     has no persistent process to hold a schedule; use Vercel Cron for it.
 *   - Seeding does not run. Migrations and seeding belong in the build, or in a
 *     one-off command against the database.
 */
import app from '../dist/src/app.js';
import { ensureRedis } from '../dist/src/app/lib/redis.js';

// Bounded, for the same reason server.ts bounds its connect: the reconnect
// strategy retries indefinitely, so a connect against an unreachable Redis
// never settles. Awaiting it unbounded here does not fail the request — it
// hangs the whole invocation until the platform kills it, turning an optional
// dependency into a total outage. Giving up on the wait is not giving up on the
// connection: it continues in the background and later invocations pick it up.
const REDIS_WAIT_MS = 1500;

export default async function handler(request, response) {
  try {
    await Promise.race([
      ensureRedis(),
      new Promise((resolve) => setTimeout(resolve, REDIS_WAIT_MS)),
    ]);
  } catch (error) {
    console.error('Redis unavailable for this invocation:', error?.message ?? error);
  }

  return app(request, response);
}
