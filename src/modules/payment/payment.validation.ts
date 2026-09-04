import { z } from 'zod';

const initiatePaymentSchema = z.object({
  body: z.object({
    orderId: z.string().uuid('Invalid orderId'),
  }),
});

export const PaymentValidation = { initiatePaymentSchema };
