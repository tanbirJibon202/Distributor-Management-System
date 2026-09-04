import httpStatus from 'http-status';
import config from '../../config/index.js';
import { AppError } from '../../utils/AppError.js';
import { redisClient } from '../../utils/redis.js';

const TOKEN_CACHE_KEY = 'bkash:token';

type GrantTokenResponse = {
  id_token: string;
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
    !config.bkash_app_secret
  ) {
    throw new AppError(httpStatus.SERVICE_UNAVAILABLE, 'bKash payment gateway is not configured');
  }
};

// bKash tokens live ~1 hour. Cached in Redis so a new payment doesn't pay
// the grant round-trip every time; a Redis miss just re-grants.
const grantToken = async (): Promise<string> => {
  requireBkashConfig();

  const cached = await redisClient.get(TOKEN_CACHE_KEY).catch(() => null);
  if (cached) return cached;

  const response = await fetch(`${config.bkash_base_url}/tokenized/checkout/token/grant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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

  await redisClient
    .set(TOKEN_CACHE_KEY, data.id_token, { EX: Math.max(60, data.expires_in - 60) })
    .catch((error) => console.error('Failed to cache bKash token:', error));

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

  return (await response.json()) as CreatePaymentResponse;
};

const executePayment = async (paymentID: string): Promise<ExecutePaymentResponse> => {
  requireBkashConfig();
  const token = await grantToken();

  const response = await fetch(`${config.bkash_base_url}/tokenized/checkout/execute`, {
    method: 'POST',
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

export const BkashClient = { grantToken, createPayment, executePayment };
