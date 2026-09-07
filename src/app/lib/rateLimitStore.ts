import {
  type ClientRateLimitInfo,
  type IncrementResponse,
  MemoryStore,
  type Options,
  type Store,
} from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redisClient } from './redis.js';

const DEFAULT_PREFIX = 'rl:';

/**
 * A rate-limit store that decides where counters live at first use rather than
 * at import time.
 *
 * RedisStore cannot be built eagerly. Its constructor issues SCRIPT LOAD and
 * never awaits the result, so building it against a client that is not yet
 * connected throws into an unhandled rejection at import — before the server is
 * listening, on every boot. Redis connects after this module loads, and may
 * never connect at all since it is optional here, so the choice has to wait
 * until a request actually arrives.
 *
 * Counting in memory is the fallback, not a failure: it is per-instance, which
 * is the behaviour this service had before Redis and is exactly right on a
 * single instance. Redis only becomes necessary once there is more than one.
 */
export class AdaptiveRateLimitStore implements Store {
  private options?: Options;
  private readonly memory = new MemoryStore();
  private redis?: RedisStore;

  /**
   * Each limiter needs its own prefix. Keys are derived from the client IP, so
   * two limiters sharing a prefix would increment the same counter and enforce
   * neither of their limits — the strict auth limit would be spent by ordinary
   * browsing, and vice versa.
   */
  constructor(private readonly keyPrefix: string = DEFAULT_PREFIX) {}

  init(options: Options) {
    this.options = options;
    this.memory.init(options);
  }

  /**
   * Resolves the store to use for this call. Promoting to Redis resets the
   * window for clients counted in memory so far — a one-off cost, paid the
   * first time Redis becomes reachable, in exchange for never holding a
   * half-initialised Redis store.
   */
  private active(): Store {
    if (!redisClient.isReady) return this.memory;

    if (!this.redis) {
      this.redis = new RedisStore({
        sendCommand: (...args: string[]) =>
          redisClient.sendCommand(args) as Promise<number | string>,
        prefix: this.keyPrefix,
      });
      if (this.options) this.redis.init(this.options);
    }

    return this.redis;
  }

  increment(key: string): Promise<IncrementResponse> | IncrementResponse {
    return this.active().increment(key);
  }

  decrement(key: string): Promise<void> | void {
    return this.active().decrement(key);
  }

  resetKey(key: string): Promise<void> | void {
    return this.active().resetKey(key);
  }

  get(key: string): Promise<ClientRateLimitInfo | undefined> | ClientRateLimitInfo | undefined {
    return this.active().get?.(key);
  }
}
