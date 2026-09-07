import { z } from 'zod';

const initiatePaymentSchema = z.object({
  body: z.object({
    orderId: z.string().uuid('Invalid orderId'),
  }),
});

const callbackSchema = z.object({
  paymentID: z.string().min(1).max(200),
  status: z.enum(['success', 'failure', 'cancel']),
});

const refundPaymentSchema = z.object({
  body: z.object({
    // Required, not optional: a refund is money leaving the business, and the
    // audit log is only useful if it records why.
    reason: z.string().min(3, 'A refund reason is required').max(255),
  }),
});

export const PaymentValidation = { initiatePaymentSchema, callbackSchema, refundPaymentSchema };
