import httpStatus from 'http-status';
import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { AppError } from '../../utils/AppError.js';
import config from '../../config/index.js';
import { AuthService } from './auth.service.js';

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: config.node_env === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const register = catchAsync(async (req, res) => {
  const result = await AuthService.registerUser(req.body);
  res.cookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    message: 'User registered successfully',
    data: result,
  });
});

const login = catchAsync(async (req, res) => {
  const result = await AuthService.loginUser(req.body);
  res.cookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Logged in successfully',
    data: result,
  });
});

const refreshToken = catchAsync(async (req, res) => {
  const token = req.cookies?.refreshToken ?? req.body?.refreshToken;
  if (!token) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Refresh token not found');
  }

  const result = await AuthService.refreshAccessToken(token);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Access token refreshed successfully',
    data: result,
  });
});

const googleAuth = catchAsync(async (req, res) => {
  const result = await AuthService.googleAuth(req.body.idToken);
  res.cookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Logged in with Google successfully',
    data: result,
  });
});

const getMe = catchAsync(async (req, res) => {
  const result = await AuthService.getMe(req.user!.id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Profile retrieved successfully',
    data: result,
  });
});

export const AuthController = { register, login, refreshToken, googleAuth, getMe };
