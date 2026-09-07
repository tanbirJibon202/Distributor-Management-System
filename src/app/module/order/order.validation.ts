import { paginationSchema } from '../../utils/queryValidation.js';
import { moneySchema } from '../../utils/money.js';
import { OrderStatus } from '../../../generated/prisma/client.js';
import { z } from 'zod';

const createOrderSchema = z.object({
  body: z.object({
    retailerId: z.string().uuid('Invalid retailerId'),
    items: z
      .array(
        z.object({
          productId: z.string().uuid('Invalid productId'),
          quantity: z.number().int().positive('quantity must be positive').max(2147483647),
        }),
      )
      .min(1, 'At least one item is required')
      .max(100, 'At most 100 items are allowed')
      .refine(
        (items) => new Set(items.map((item) => item.productId)).size === items.length,
        'Duplicate products are not allowed',
      ),
    discount: moneySchema.optional(),
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

const listQuerySchema = paginationSchema
  .extend({
    sortOrder: z.enum(['asc', 'desc']).optional(),
    status: z.enum(['PENDING', 'APPROVED', 'DISPATCHED', 'DELIVERED', 'CANCELLED']).optional(),
  })
  .strict();

export const OrderValidation = { listQuerySchema, createOrderSchema, updateOrderStatusSchema };
