import dotenv from 'dotenv';
import path from 'path';
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
  SUPER_ADMIN_NAME: z.string().default('Super Admin'),
  SUPER_ADMIN_EMAIL: z.string().default('admin@dms.com'),
  SUPER_ADMIN_PASSWORD: z.string().default('SuperAdmin123!'),
});

const parsed = envSchema.safeParse(process.env);

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
  super_admin_name: env.SUPER_ADMIN_NAME,
  super_admin_email: env.SUPER_ADMIN_EMAIL,
  super_admin_password: env.SUPER_ADMIN_PASSWORD,
};
