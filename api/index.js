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

export default async function handler(request, response) {
  // Idempotent and near-free once the connection is open, which it stays for
  // the life of a warm container. OTP storage depends on it, so a failure here
  // is logged rather than swallowed — but it must not take the request down,
  // since most routes work perfectly well without Redis.
  try {
    await ensureRedis();
  } catch (error) {
    console.error('Redis unavailable for this invocation:', error?.message ?? error);
  }

  return app(request, response);
}
