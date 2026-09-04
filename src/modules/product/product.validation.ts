import { z } from 'zod';

const createProductSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    sku: z.string().min(1, 'SKU is required'),
    description: z.string().optional(),
    category: z.string().min(1, 'Category is required'),
    unit: z.enum(['PCS', 'CTN', 'KG']),
    price: z.number().positive('Price must be positive'),
    costPrice: z.number().positive('Cost price must be positive'),
  }),
});

export const ProductValidation = { createProductSchema };
