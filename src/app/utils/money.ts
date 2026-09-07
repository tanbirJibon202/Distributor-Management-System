import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';

export const moneySchema = z
  .number()
  .finite()
  .min(0)
  .max(9999999999.99)
  .refine(
    (value) => new Prisma.Decimal(value).decimalPlaces() <= 2,
    'Use at most two decimal places',
  );
