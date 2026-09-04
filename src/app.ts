import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import httpStatus from 'http-status';
import config from './config/index.js';
import { globalErrorHandler } from './middlewares/globalErrorHandler.js';
import { notFound } from './middlewares/notFound.js';
import routes from './routes/index.js';

const app: Application = express();

app.use(helmet());
app.use(
  cors({
    origin: config.cors_origins,
    credentials: true,
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later', errors: [] },
});
app.use(globalRateLimiter);

app.get('/', (_req: Request, res: Response) => {
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Welcome to DMS — Distributor Management System Backend',
  });
});

app.use('/api/v1', routes);

app.use(globalErrorHandler);
app.use(notFound);

export default app;
