import { z } from 'zod';

const registerSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Invalid email'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    phone: z.string().optional(),
    branchId: z.string().uuid('branchId must be a valid id'),
  }),
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email'),
    password: z.string().min(1, 'Password is required'),
  }),
});

const googleAuthSchema = z.object({
  body: z.object({
    idToken: z.string().min(1, 'idToken is required'),
  }),
});

export const AuthValidation = { registerSchema, loginSchema, googleAuthSchema };
