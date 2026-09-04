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

const updateProductSchema = z.object({
  body: z
    .object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      category: z.string().min(1).optional(),
      unit: z.enum(['PCS', 'CTN', 'KG']).optional(),
      price: z.number().positive('Price must be positive').optional(),
      costPrice: z.number().positive('Cost price must be positive').optional(),
    })
    .refine((data) => Object.keys(data).length > 0, 'At least one field must be provided'),
});

export const ProductValidation = { createProductSchema, updateProductSchema };
