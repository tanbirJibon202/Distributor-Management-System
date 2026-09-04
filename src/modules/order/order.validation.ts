import { OrderStatus } from '@prisma/client';
import { z } from 'zod';

const createOrderSchema = z.object({
  body: z.object({
    retailerId: z.string().uuid('Invalid retailerId'),
    items: z
      .array(
        z.object({
          productId: z.string().uuid('Invalid productId'),
          quantity: z.number().int().positive('quantity must be positive'),
        }),
      )
      .min(1, 'At least one item is required'),
    discount: z.number().nonnegative().optional(),
  }),
});

const updateOrderStatusSchema = z.object({
  body: z.object({
    status: z.enum([
      OrderStatus.PENDING,
      OrderStatus.APPROVED,
      OrderStatus.DISPATCHED,
      OrderStatus.DELIVERED,
      OrderStatus.CANCELLED,
    ]),
  }),
});

export const OrderValidation = { createOrderSchema, updateOrderStatusSchema };
