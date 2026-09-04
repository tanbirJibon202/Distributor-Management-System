import httpStatus from 'http-status';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError.js';
import type { Role } from '../generated/prisma/index.js';

export const authorize = (...roles: Role[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new AppError(httpStatus.UNAUTHORIZED, 'You are not authorized, please login');
    }

    if (!roles.includes(req.user.role)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not have permission to perform this action');
    }

    next();
  };
};
