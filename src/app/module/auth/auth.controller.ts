import httpStatus from 'http-status';
import config from '../../config/index.js';
import { AppError } from '../../utils/AppError.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { AuthService } from './auth.service.js';

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: config.node_env === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

// No tokens and no cookie here any more: registration only stages the account
// and emails a code. The session is issued by verifyEmail, once the address is
// proven. 202 rather than 201 — nothing has been created yet.
const register = catchAsync(async (req, res) => {
  const result = await AuthService.registerUser(req.user!, req.body);

  sendResponse(res, {
    statusCode: httpStatus.ACCEPTED,
    message: result.message,
    data: { email: result.email },
  });
});

const verifyEmail = catchAsync(async (req, res) => {
  const result = await AuthService.verifyEmail(req.body, req.ip);
  res.cookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    message: 'Email verified and account created successfully',
    data: result,
  });
});

const resendOtp = catchAsync(async (req, res) => {
  const result = await AuthService.resendRegistrationOtp(req.body.email);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: result.message,
    data: { email: result.email },
  });
});

const forgotPassword = catchAsync(async (req, res) => {
  const result = await AuthService.forgotPassword(req.body.email);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: result.message,
    data: null,
  });
});

const resetPassword = catchAsync(async (req, res) => {
  const result = await AuthService.resetPassword(req.body, req.ip);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: result.message,
    data: null,
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

const logout = catchAsync(async (req, res) => {
  await AuthService.logout(req.user!.userId);
  res.clearCookie('refreshToken', { ...REFRESH_COOKIE_OPTIONS, maxAge: undefined });
  res.clearCookie('accessToken', { ...REFRESH_COOKIE_OPTIONS, maxAge: undefined });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Logged out successfully',
    data: null,
  });
});

const getMe = catchAsync(async (req, res) => {
  const result = await AuthService.getMe(req.user!.userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Profile retrieved successfully',
    data: result,
  });
});

export const AuthController = {
  register,
  verifyEmail,
  resendOtp,
  login,
  refreshToken,
  googleAuth,
  logout,
  getMe,
  forgotPassword,
  resetPassword,
};
