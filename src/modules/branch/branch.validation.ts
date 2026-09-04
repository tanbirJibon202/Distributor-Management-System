import { z } from 'zod';

const createBranchSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    code: z.string().min(1, 'Code is required'),
    type: z.enum(['CENTRAL', 'DEPOT', 'BRANCH']),
    location: z.string().min(1, 'Location is required'),
  }),
});

export const BranchValidation = { createBranchSchema };
