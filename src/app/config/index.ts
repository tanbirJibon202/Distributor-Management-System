import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('5000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_SECRET: z.string().min(1, 'JWT_ACCESS_SECRET is required'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  BKASH_BASE_URL: z.string().optional(),
  BKASH_USERNAME: z.string().optional(),
  BKASH_PASSWORD: z.string().optional(),
  BKASH_APP_KEY: z.string().optional(),
  BKASH_APP_SECRET: z.string().optional(),
  BKASH_CALLBACK_URL: z.string().optional(),
  // All optional: email is a feature, not a dependency. Without SMTP the app
  // boots and serves everything else; only the routes that send mail refuse,
  // the same way the bKash routes do without gateway credentials.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().default('587'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_SENDER: z.string().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  SUPER_ADMIN_NAME: z.string().default('Super Admin'),
  // Validated as an email, not just a string: the seed writes this straight
  // into users.email, while the login route validates its input with .email().
  // A value like "admin" therefore seeds an account that can never log in, and
  // nothing catches it until someone tries. Fail at boot instead.
  SUPER_ADMIN_EMAIL: z
    .string()
    .email('SUPER_ADMIN_EMAIL must be a valid email')
    .default('admin@dms.com'),
  SUPER_ADMIN_PASSWORD: z.string().default('SuperAdmin123!'),
});

const parsed = envSchema
  .superRefine((env, ctx) => {
    if (
      env.NODE_ENV === 'production' &&
      (!process.env.SUPER_ADMIN_PASSWORD ||
        env.SUPER_ADMIN_PASSWORD === 'SuperAdmin123!' ||
        env.SUPER_ADMIN_PASSWORD.length < 12)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SUPER_ADMIN_PASSWORD'],
        message: 'Production requires a non-default SUPER_ADMIN_PASSWORD of at least 12 characters',
      });
    }
  })
  .safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export default {
  node_env: env.NODE_ENV,
  port: Number(env.PORT),
  database_url: env.DATABASE_URL,
  jwt_access_secret: env.JWT_ACCESS_SECRET,
  jwt_refresh_secret: env.JWT_REFRESH_SECRET,
  jwt_access_expires_in: env.JWT_ACCESS_EXPIRES_IN,
  jwt_refresh_expires_in: env.JWT_REFRESH_EXPIRES_IN,
  cors_origins: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
  google_client_id: env.GOOGLE_CLIENT_ID,
  redis_url: env.REDIS_URL,
  bkash_base_url: env.BKASH_BASE_URL,
  bkash_username: env.BKASH_USERNAME,
  bkash_password: env.BKASH_PASSWORD,
  bkash_app_key: env.BKASH_APP_KEY,
  bkash_app_secret: env.BKASH_APP_SECRET,
  bkash_callback_url: env.BKASH_CALLBACK_URL,
  smtp_host: env.SMTP_HOST,
  smtp_port: Number(env.SMTP_PORT),
  smtp_user: env.SMTP_USER,
  smtp_password: env.SMTP_PASSWORD,
  email_sender: env.EMAIL_SENDER ?? env.SMTP_USER,
  cloudinary_cloud_name: env.CLOUDINARY_CLOUD_NAME,
  cloudinary_api_key: env.CLOUDINARY_API_KEY,
  cloudinary_api_secret: env.CLOUDINARY_API_SECRET,
  super_admin_name: env.SUPER_ADMIN_NAME,
  super_admin_email: env.SUPER_ADMIN_EMAIL,
  super_admin_password: env.SUPER_ADMIN_PASSWORD,
};
