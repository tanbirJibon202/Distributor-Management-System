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

const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email'),
  }),
});

const resetPasswordSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email'),
    // Exactly six digits, as a string: a number would drop leading zeros, and
    // the generator pads to six precisely so "004221" stays a valid code.
    otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
    newPassword: z.string().min(6, 'Password must be at least 6 characters'),
  }),
});

const verifyEmailSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email'),
    otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
  }),
});

const resendOtpSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email'),
  }),
});

export const AuthValidation = {
  registerSchema,
  loginSchema,
  googleAuthSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  resendOtpSchema,
};
