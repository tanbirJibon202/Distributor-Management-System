import { listQueryBase, priceQuery } from '../../utils/queryValidation.js';
import { moneySchema } from '../../utils/money.js';
import { z } from 'zod';

const createProductSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    sku: z.string().min(1, 'SKU is required'),
    description: z.string().optional(),
    category: z.string().min(1, 'Category is required'),
    unit: z.enum(['PCS', 'CTN', 'KG']),
    price: moneySchema.refine((value) => value > 0, 'Price must be positive'),
    costPrice: moneySchema.refine((value) => value > 0, 'Cost price must be positive'),
  }),
});

const updateProductSchema = z.object({
  body: z
    .object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      category: z.string().min(1).optional(),
      unit: z.enum(['PCS', 'CTN', 'KG']).optional(),
      price: moneySchema.refine((value) => value > 0, 'Price must be positive').optional(),
      costPrice: moneySchema.refine((value) => value > 0, 'Cost price must be positive').optional(),
    })
    .refine((data) => Object.keys(data).length > 0, 'At least one field must be provided'),
});

const listQuerySchema = listQueryBase
  .extend({
    category: z.string().max(200).optional(),
    minPrice: priceQuery.optional(),
    maxPrice: priceQuery.optional(),
    sortBy: z.enum(['name', 'price', 'createdAt']).optional(),
  })
  .strict()
  .refine(
    (q) =>
      q.minPrice === undefined ||
      q.maxPrice === undefined ||
      Number(q.minPrice) <= Number(q.maxPrice),
    { path: ['maxPrice'], message: 'maxPrice must be at least minPrice' },
  );

export const ProductValidation = { listQuerySchema, createProductSchema, updateProductSchema };
