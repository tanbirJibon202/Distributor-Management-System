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
export const PaymentValidation = { initiatePaymentSchema, callbackSchema };
