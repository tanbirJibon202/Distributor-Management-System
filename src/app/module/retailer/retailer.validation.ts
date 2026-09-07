import { listQueryBase } from '../../utils/queryValidation.js';
import { moneySchema } from '../../utils/money.js';
import { z } from 'zod';

const createRetailerSchema = z.object({
  body: z.object({
    shopName: z.string().min(1, 'Shop name is required'),
    ownerName: z.string().min(1, 'Owner name is required'),
    phone: z.string().min(1, 'Phone is required'),
    // Optional — most shops have no email. Supplying one enables invoice
    // copies by mail; without it the PDF endpoint is still available.
    email: z.string().email('Invalid email').optional(),
    address: z.string().min(1, 'Address is required'),
    routeArea: z.string().min(1, 'Route area is required'),
    creditLimit: moneySchema
      .refine((value) => value > 0, 'Credit limit must be positive')
      .optional(),
  }),
});

const listQuerySchema = listQueryBase
  .extend({
    routeArea: z.string().max(200).optional(),
    sortBy: z.enum(['shopName', 'createdAt', 'dueBalance']).optional(),
  })
  .strict();

export const RetailerValidation = { listQuerySchema, createRetailerSchema };
