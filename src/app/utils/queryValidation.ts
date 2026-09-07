import { z } from 'zod';

export const integerString = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, 'Must be an integer')
    .refine(
      (value) =>
        Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max,
      `Must be between ${min} and ${max}`,
    );
export const priceQuery = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Must be a non-negative amount with at most two decimals')
  .refine((value) => Number(value) <= 9999999999.99, 'Amount is too large');
export const paginationSchema = z.object({
  page: integerString(1, 1_000_000).optional(),
  limit: integerString(1, 100).optional(),
});
export const listQueryBase = paginationSchema.extend({
  search: z.string().max(200).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});
