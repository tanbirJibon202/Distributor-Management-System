import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Application, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import httpStatus from 'http-status';
import config from './app/config/index.js';
import { AdaptiveRateLimitStore } from './app/lib/rateLimitStore.js';
import { globalErrorHandler } from './app/middleware/globalErrorHandler.js';
import { notFound } from './app/middleware/notFound.js';
import { AnalyticsRoutes } from './app/module/analytics/analytics.route.js';
import { AuditRoutes } from './app/module/audit/audit.route.js';
import { AuthRoutes } from './app/module/auth/auth.route.js';
import { BranchRoutes } from './app/module/branch/branch.route.js';
import { InventoryRoutes } from './app/module/inventory/inventory.route.js';
import { OrderRoutes } from './app/module/order/order.route.js';
import { PaymentRoutes } from './app/module/payment/payment.route.js';
import { ProductRoutes } from './app/module/product/product.route.js';
import { RetailerRoutes } from './app/module/retailer/retailer.route.js';
import { UserRoutes } from './app/module/user/user.route.js';
import { sendResponse } from './app/utils/sendResponse.js';

const app: Application = express();

app.use(helmet());
app.use(
  cors({
    origin: config.cors_origins,
    credentials: true,
  }),
);

// Middleware to parse JSON bodies
app.use(express.json());
// Enable URL-encoded form data parsing
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  // Counters live in Redis so one limit is shared by every instance. With the
  // default in-memory store each process counted on its own, so the real limit
  // was 100 x instances and any restart wiped it — fine on a single dyno, wrong
  // the moment this scales.
  // Counts in Redis when Redis is up, so one limit is shared across instances,
  // and in memory when it is not. Chosen per request rather than at import —
  // see the store for why that indirection is necessary.
  store: new AdaptiveRateLimitStore(),
  // Belt and braces for the case where Redis drops *after* the store promoted
  // itself. Fails open: requests pass unlimited rather than every one 500-ing.
  // Rate limiting protects capacity; it is not an authorisation control, and
  // auth still runs regardless.
  passOnStoreError: true,
  message: { success: false, message: 'Too many requests, please try again later', errors: [] },
});
app.use(globalRateLimiter);

app.use('/api/v1/auth', AuthRoutes);
app.use('/api/v1/users', UserRoutes.userRouter);
app.use('/api/v1/admin/users', UserRoutes.adminUserRouter);
app.use('/api/v1/branches', BranchRoutes);
app.use('/api/v1/products', ProductRoutes);
app.use('/api/v1/inventory', InventoryRoutes);
app.use('/api/v1/retailers', RetailerRoutes);
app.use('/api/v1/orders', OrderRoutes);
app.use('/api/v1/payments', PaymentRoutes);
app.use('/api/v1/admin/audit-logs', AuditRoutes);
app.use('/api/v1/admin/dashboard-stats', AnalyticsRoutes);

// Basic route — goes through sendResponse so even the health check follows
// the { success, message, data } contract every other endpoint uses.
app.get('/', (_req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Welcome to DMS - Distributor Management System Backend',
    data: { service: 'dms-backend', status: 'ok' },
  });
});

app.use(globalErrorHandler);
app.use(notFound);

export default app;
