import { z } from 'zod';

const createRetailerSchema = z.object({
  body: z.object({
    shopName: z.string().min(1, 'Shop name is required'),
    ownerName: z.string().min(1, 'Owner name is required'),
    phone: z.string().min(1, 'Phone is required'),
    address: z.string().min(1, 'Address is required'),
    routeArea: z.string().min(1, 'Route area is required'),
    creditLimit: z.number().positive().optional(),
  }),
});

export const RetailerValidation = { createRetailerSchema };
