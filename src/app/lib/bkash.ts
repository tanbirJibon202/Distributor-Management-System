import httpStatus from 'http-status';
import config from '../config/index.js';
import { AppError } from '../utils/AppError.js';
import { redisClient } from './redis.js';

const ID_TOKEN_KEY = 'bkash:idToken';
const REFRESH_TOKEN_KEY = 'bkash:refreshToken';
// bKash refresh tokens are valid for 28 days, far longer than the ~1h id token.
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 28;

type GrantTokenResponse = {
  id_token: string;
  refresh_token?: string;
  expires_in: number;
};

type CreatePaymentResponse = {
  paymentID: string;
  bkashURL: string;
};

type ExecutePaymentResponse = {
  paymentID: string;
  trxID?: string;
  transactionStatus?: string;
  amount?: string;
  statusCode?: string;
  statusMessage?: string;
};

const requireBkashConfig = () => {
  if (
    !config.bkash_base_url ||
    !config.bkash_username ||
    !config.bkash_password ||
    !config.bkash_app_key ||
    !config.bkash_app_secret ||
    !config.bkash_callback_url
  ) {
    throw new AppError(httpStatus.SERVICE_UNAVAILABLE, 'bKash payment gateway is not configured');
  }
};

// Cached a minute short of bKash's own expiry, so a cache hit is never a token
// that dies mid-request.
const cacheIdToken = async (idToken: string, expiresIn: number) => {
  await redisClient
    .set(ID_TOKEN_KEY, idToken, { EX: Math.max(60, expiresIn - 60) })
    .catch((error) => console.error('Failed to cache bKash id token:', error));
};

// Returns null rather than throwing: a refusal here is not fatal, the caller
// simply falls through to a full grant.
const refreshIdToken = async (refreshToken: string): Promise<string | null> => {
  const response = await fetch(`${config.bkash_base_url}/tokenized/checkout/token/refresh`, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      username: config.bkash_username!,
      password: config.bkash_password!,
    },
    body: JSON.stringify({
      app_key: config.bkash_app_key,
      app_secret: config.bkash_app_secret,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) return null;

  const data = (await response.json()) as GrantTokenResponse;
  if (!data.id_token) return null;

  await cacheIdToken(data.id_token, data.expires_in);
  return data.id_token;
};

// bKash id tokens live ~1 hour and are cached in Redis so a payment doesn't pay
// the grant round-trip every time. On a miss the 28-day refresh token is tried
// first — that is the call bKash expects a merchant to make, and it avoids
// re-sending the app secret. Only if that fails does this grant from scratch,
// so a Redis outage still works, just at full cost.
const grantToken = async (): Promise<string> => {
  requireBkashConfig();

  const cached = await redisClient.get(ID_TOKEN_KEY).catch(() => null);
  if (cached) return cached;

  const refreshToken = await redisClient.get(REFRESH_TOKEN_KEY).catch(() => null);
  if (refreshToken) {
    const refreshed = await refreshIdToken(refreshToken);
    if (refreshed) return refreshed;
  }

  const response = await fetch(`${config.bkash_base_url}/tokenized/checkout/token/grant`, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      username: config.bkash_username!,
      password: config.bkash_password!,
    },
    body: JSON.stringify({
      app_key: config.bkash_app_key,
      app_secret: config.bkash_app_secret,
    }),
  });

  if (!response.ok) {
    throw new AppError(httpStatus.BAD_GATEWAY, 'Failed to obtain bKash token');
  }

  const data = (await response.json()) as GrantTokenResponse;

  await cacheIdToken(data.id_token, data.expires_in);

  if (data.refresh_token) {
    await redisClient
      .set(REFRESH_TOKEN_KEY, data.refresh_token, { EX: REFRESH_TOKEN_TTL_SECONDS })
      .catch((error) => console.error('Failed to cache bKash refresh token:', error));
  }

  return data.id_token;
};

const createPayment = async (params: {
  amount: number;
  merchantInvoiceNumber: string;
}): Promise<CreatePaymentResponse> => {
  requireBkashConfig();
  const token = await grantToken();

  const response = await fetch(`${config.bkash_base_url}/tokenized/checkout/create`, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'X-APP-Key': config.bkash_app_key!,
    },
    body: JSON.stringify({
      mode: '0011',
      payerReference: params.merchantInvoiceNumber,
      callbackURL: config.bkash_callback_url,
      amount: params.amount.toFixed(2),
      currency: 'BDT',
      intent: 'sale',
      merchantInvoiceNumber: params.merchantInvoiceNumber,
    }),
  });

  if (!response.ok) {
    throw new AppError(httpStatus.BAD_GATEWAY, 'Failed to create bKash payment');
  }

  const data = (await response.json()) as CreatePaymentResponse;
  if (!data.paymentID || !data.bkashURL) {
    throw new AppError(httpStatus.BAD_GATEWAY, 'bKash did not return a valid checkout');
  }
  return data;
};

const executePayment = async (paymentID: string): Promise<ExecutePaymentResponse> => {
  requireBkashConfig();
  const token = await grantToken();

  const response = await fetch(`${config.bkash_base_url}/tokenized/checkout/execute`, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'X-APP-Key': config.bkash_app_key!,
    },
    body: JSON.stringify({ paymentID }),
  });

  if (!response.ok) {
    throw new AppError(httpStatus.BAD_GATEWAY, 'Failed to execute bKash payment');
  }

  return (await response.json()) as ExecutePaymentResponse;
};

const queryPayment = async (paymentID: string): Promise<ExecutePaymentResponse> => {
  const token = await grantToken();
  const response = await fetch(`${config.bkash_base_url}/tokenized/checkout/payment/status`, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'X-APP-Key': config.bkash_app_key!,
    },
    body: JSON.stringify({ paymentID }),
  });
  if (!response.ok) throw new AppError(httpStatus.BAD_GATEWAY, 'Failed to query bKash payment');
  return (await response.json()) as ExecutePaymentResponse;
};

export const BkashClient = { grantToken, createPayment, executePayment, queryPayment };
