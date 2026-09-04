import { z } from 'zod';

const adjustInventorySchema = z.object({
  body: z.object({
    productId: z.string().uuid('Invalid productId'),
    branchId: z.string().uuid('Invalid branchId'),
    quantity: z.number().int().refine((v) => v !== 0, 'quantity must not be zero'),
    reason: z.string().min(1, 'Reason is required'),
  }),
});

export const InventoryValidation = { adjustInventorySchema };
