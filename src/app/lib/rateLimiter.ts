import type { RequestHandler } from 'express';
import rateLimitImport, { type Options } from 'express-rate-limit';

/**
 * express-rate-limit, narrowed to the callable it is.
 *
 * The package is dual-published, and which set of declarations the toolchain
 * resolves varies by environment: the ESM ones locally, the CommonJS ones in
 * the deploy build. Under the CommonJS view TypeScript models the default
 * import as the whole module namespace, which has no call signature, so the
 * same source compiles in one place and not the other.
 *
 * The value is identical and callable at runtime either way. Stating the shape
 * once here keeps that detail in a single place instead of repeating a cast at
 * every limiter.
 */
export const rateLimit = rateLimitImport as unknown as (
  options?: Partial<Options>,
) => RequestHandler;
