import type { Server } from 'node:http';
import app from './app.js';
import config from './app/config/index.js';
import { startScheduledJobs } from './app/lib/cron.js';
import { prisma } from './app/lib/prisma.js';
import { redisClient } from './app/lib/redis.js';
import { seedDemoData, seedSuperAdmin } from './app/utils/seed.js';

const PORT = config.port;

// Long enough for a healthy Redis on the same network, short enough that a
// missing one costs a few seconds of boot rather than the whole startup.
const REDIS_CONNECT_TIMEOUT_MS = 5000;

let server: Server;

const main = async () => {
  try {
    await prisma.$connect();
    console.log('Connected to the database successfully.');

    // Redis is a cache and a token store, never a source of truth — the product
    // cache falls back to Postgres and the bKash token simply re-grants on a
    // miss, and every call site already swallows its errors. So a Redis outage
    // makes the API slower, not wrong, and must not stop it booting. Postgres
    // above stays a hard requirement: nothing works without it.
    //
    // The race matters. connect() does not reject when Redis is down — it hands
    // the failure to the reconnect strategy and keeps retrying, so awaiting it
    // alone hangs boot forever and the catch below never runs. Giving up on the
    // *wait* is not giving up on the connection: the client keeps retrying in
    // the background and starts serving cache reads the moment it succeeds.
    await Promise.race([
      redisClient.connect(),
      new Promise((resolve) => setTimeout(resolve, REDIS_CONNECT_TIMEOUT_MS)),
    ]).catch((error) => {
      console.error('Redis connect failed:', error instanceof Error ? error.message : error);
    });

    if (!redisClient.isReady) {
      console.warn(
        `Redis not ready after ${REDIS_CONNECT_TIMEOUT_MS}ms — starting without cache. Product listings read straight from Postgres, and rate limiting falls back to per-instance counting.`,
      );
    }

    await seedSuperAdmin();
    await seedDemoData();

    startScheduledJobs();

    server = app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Error starting the server:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
};

main();

const shutdown = async (signal: string) => {
  console.log(`${signal} received, shutting down gracefully...`);
  server?.close(async () => {
    await prisma.$disconnect();
    if (redisClient.isOpen) await redisClient.disconnect();
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  server?.close(() => process.exit(1));
});
