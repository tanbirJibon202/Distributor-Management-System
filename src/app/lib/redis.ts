import { createClient } from 'redis';
import config from '../config/index.js';

// How long to stay quiet between reconnect-failure logs. node-redis emits an
// error on *every* failed attempt, so one unreachable Redis produced thousands
// of stack traces an hour and buried everything else in the log.
const ERROR_LOG_INTERVAL_MS = 30_000;

export const redisClient = createClient({
  url: config.redis_url,
  socket: {
    // Back off to a 5s ceiling and keep trying forever: Redis is optional here,
    // so the right behaviour during an outage is quiet patience — reconnect on
    // its own once it comes back, without hammering it meanwhile.
    reconnectStrategy: (retries) => Math.min(200 * (retries + 1), 5000),
  },
});

let lastErrorLoggedAt = 0;

redisClient.on('error', (error) => {
  const now = Date.now();
  if (now - lastErrorLoggedAt < ERROR_LOG_INTERVAL_MS) return;
  lastErrorLoggedAt = now;
  // Message only, not the stack: these are connection failures, and the stack
  // is always node-redis internals rather than anything actionable.
  console.error('Redis unavailable:', error instanceof Error ? error.message : error);
});

redisClient.on('ready', () => {
  lastErrorLoggedAt = 0;
  console.log('Redis connected.');
});

export const connectRedis = async () => {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
};

// Serverless has no boot step: each cold start imports the app and handles a
// request, so nothing ever calls connectRedis. OTP storage is not optional —
// registration and password reset fail outright without it — so the request
// path has to be able to open the connection itself.
//
// The in-flight promise is cached rather than the result, so concurrent
// requests on one cold start share a single connect instead of racing several.
let connecting: Promise<unknown> | null = null;

export const ensureRedis = async () => {
  if (redisClient.isOpen) return;
  if (!connecting) {
    connecting = redisClient.connect().catch((error) => {
      // Cleared so a later request can retry rather than being stuck behind a
      // permanently rejected promise.
      connecting = null;
      throw error;
    });
  }
  await connecting;
  connecting = null;
};
