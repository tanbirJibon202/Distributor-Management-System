import crypto from 'node:crypto';
import httpStatus from 'http-status';
import { AppError } from '../utils/AppError.js';
import { redisClient } from './redis.js';

export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_TTL_MINUTES = OTP_TTL_SECONDS / 60;

// A six-digit code has a million possibilities, which sounds like plenty until
// you notice nothing stops a script trying all of them inside the five-minute
// window. Capping attempts is what actually makes the code strong; the global
// rate limiter is per-IP and does not protect a single account.
const MAX_ATTEMPTS = 5;

/** Uniform over 000000-999999, and leading zeros are preserved. */
export const generateOtp = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

export const otpKey = (purpose: string, email: string) => `otp:${purpose}:${email}`;
const attemptsKey = (purpose: string, email: string) => `otp-attempts:${purpose}:${email}`;

export const storeOtp = async (purpose: string, email: string, otp: string) => {
  await redisClient
    .multi()
    .set(otpKey(purpose, email), otp, { EX: OTP_TTL_SECONDS })
    .del(attemptsKey(purpose, email))
    .exec();
};

// Redis runs the read, attempt count and consumption atomically. Two valid
// requests cannot both consume one code; a concurrent resend cannot be deleted
// by an older verification request.
const VERIFY_OTP_SCRIPT = `
local stored = redis.call('GET', KEYS[1])
if not stored then return -1 end
local used = redis.call('INCR', KEYS[2])
if used == 1 then redis.call('EXPIRE', KEYS[2], ARGV[3]) end
if used > tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1], KEYS[2])
  return -2
end
if stored ~= ARGV[1] then
  if used >= tonumber(ARGV[2]) then
    redis.call('DEL', KEYS[1], KEYS[2])
    return -2
  end
  return tonumber(ARGV[2]) - used
end
redis.call('DEL', KEYS[1], KEYS[2])
return 10
`;

export const verifyOtp = async (purpose: string, email: string, submitted: string) => {
  const result = Number(
    await redisClient.eval(VERIFY_OTP_SCRIPT, {
      keys: [otpKey(purpose, email), attemptsKey(purpose, email)],
      arguments: [submitted, String(MAX_ATTEMPTS), String(OTP_TTL_SECONDS + 60)],
    }),
  );
  if (result === 10) return;
  if (result === -1)
    throw new AppError(httpStatus.BAD_REQUEST, 'This code has expired. Request a new one.');
  if (result === -2)
    throw new AppError(
      httpStatus.TOO_MANY_REQUESTS,
      'Too many incorrect attempts. Request a new code.',
    );
  throw new AppError(httpStatus.BAD_REQUEST, `Incorrect code. ${result} attempts remaining.`);
};
