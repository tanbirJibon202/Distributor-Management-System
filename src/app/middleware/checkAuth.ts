import type { Role } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import httpStatus from 'http-status';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';
import { verifyAccessToken } from '../utils/jwt.js';

export interface RequestUser {
  userId: string;
  email: string;
  role: Role;
  branchId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: RequestUser;
    }
  }
}

// auth(Role.SUPER_ADMIN, Role.BRANCH_MANAGER) — verifies the token, checks the
// role, and confirms the account still exists before the request continues.
// auth() with no arguments allows any authenticated user.
export const auth = (...requiredRoles: Role[]) => {
  return catchAsync(async (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.accessToken
      ? req.cookies.accessToken
      : req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.split(' ')[1]
        : req.headers.authorization;

    if (!token) {
      throw new AppError(
        httpStatus.UNAUTHORIZED,
        'You are not logged in. Please log in to access this resource.',
      );
    }

    let decoded: RequestUser;
    try {
      const payload = verifyAccessToken(token);
      decoded = {
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
        branchId: payload.branchId,
      };
    } catch {
      throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid or expired token');
    }

    if (requiredRoles.length && !requiredRoles.includes(decoded.role)) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "Forbidden. You don't have permission to access this resource.",
      );
    }

    // Looked up by id alone: a token stays valid when the account's name or
    // branch changes, but stops working the moment the account is deleted.
    const user = await prisma.user.findFirst({
      where: { id: decoded.userId, deletedAt: null },
    });

    if (!user) {
      throw new AppError(httpStatus.UNAUTHORIZED, 'User not found. Please log in again.');
    }

    req.user = { ...decoded, role: user.role, branchId: user.branchId };

    next();
  });
};
