import { listQueryBase, integerString } from '../../utils/queryValidation.js';
import { z } from 'zod';

const adjustInventorySchema = z.object({
  body: z.object({
    productId: z.string().uuid('Invalid productId'),
    branchId: z.string().uuid('Invalid branchId'),
    quantity: z
      .number()
      .int()
      .min(-2147483647)
      .max(2147483647)
      .refine((v) => v !== 0, 'quantity must not be zero'),
    reason: z.string().min(1, 'Reason is required'),
  }),
});

const listQuerySchema = listQueryBase
  .extend({
    branchId: z.string().uuid().optional(),
    lowStock: integerString(0, 2147483647).optional(),
  })
  .strict();

export const InventoryValidation = { listQuerySchema, adjustInventorySchema };
