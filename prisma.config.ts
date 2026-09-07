import 'dotenv/config';
import path from 'node:path';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: path.join('prisma', 'schema'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  datasource: {
    // Only the Prisma CLI reads this. The running app never does — it connects
    // through its own driver adapter in src/app/lib/prisma.ts using the pooled
    // DATABASE_URL. That split is what keeps migrations off the pooler: they
    // take a Postgres advisory lock and issue DDL, neither of which survives
    // PgBouncer's transaction pooling.
    //
    // Prisma 7 dropped the schema's `directUrl`, so the preference is expressed
    // here instead: use DIRECT_URL when one is configured, and fall back to
    // DATABASE_URL on a plain Postgres that has no separate direct endpoint.
    url: env(process.env.DIRECT_URL ? 'DIRECT_URL' : 'DATABASE_URL'),
  },
});
