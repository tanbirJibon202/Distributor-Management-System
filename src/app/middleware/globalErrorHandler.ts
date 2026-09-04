import { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import httpStatus from 'http-status';
import jwt from 'jsonwebtoken';
import { ZodError } from 'zod';
import config from '../config/index.js';
import { AppError } from '../utils/AppError.js';

type ErrorDetail = { path: string; message: string };

export const globalErrorHandler = (
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  let statusCode: number = httpStatus.INTERNAL_SERVER_ERROR;
  let message = 'Something went wrong';
  let errors: ErrorDetail[] = [];

  if (error instanceof ZodError) {
    statusCode = httpStatus.BAD_REQUEST;
    message = 'Validation failed';
    errors = error.issues.map((issue) => ({
      path: issue.path.filter((p) => p !== 'body').join('.'),
      message: issue.message,
    }));
  } else if (error instanceof AppError) {
    statusCode = error.statusCode;
    message = error.message;
  } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      statusCode = httpStatus.CONFLICT;
      const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
      message = `A record with this ${target} already exists`;
    } else if (error.code === 'P2025') {
      statusCode = httpStatus.NOT_FOUND;
      message = 'Requested record was not found';
    } else {
      statusCode = httpStatus.BAD_REQUEST;
      message = 'Database request error';
    }
  } else if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
    statusCode = httpStatus.UNAUTHORIZED;
    message = 'Invalid or expired token';
  } else if (error instanceof Error) {
    message = error.message;
  }

  // `errors` is always present, even when empty — the response contract is
  // { success, message, errors } for every failure, whatever the cause.
  res.status(statusCode).json({
    success: false,
    message,
    errors,
    ...(config.node_env === 'development' && error instanceof Error ? { stack: error.stack } : {}),
  });
};
