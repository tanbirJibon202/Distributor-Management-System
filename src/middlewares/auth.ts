import httpStatus from 'http-status';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { verifyAccessToken, type JwtPayload } from '../utils/jwt.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export const auth = catchAsync(async (req, _res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  if (!token) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'You are not authorized, please login');
  }

  try {
    req.user = verifyAccessToken(token);
  } catch {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid or expired token');
  }

  next();
});
