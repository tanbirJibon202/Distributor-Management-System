import { Role } from '../../../generated/prisma/client.js';
import { Router } from 'express';
import { rateLimit } from '../../lib/rateLimiter.js';
import { AdaptiveRateLimitStore } from '../../lib/rateLimitStore.js';
import { auth } from '../../middleware/checkAuth.js';
import { validateRequest } from '../../middleware/validateRequest.js';
import { AuthController } from './auth.controller.js';
import { AuthValidation } from './auth.validation.js';

const router = Router();

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  // Its own prefix, separate from the global limiter: these count different
  // things and must not spend each other's budget.
  store: new AdaptiveRateLimitStore('rl:auth:'),
  passOnStoreError: true,
  message: { success: false, message: 'Too many attempts, please try again later', errors: [] },
});

router.post(
  '/register',
  auth(Role.SUPER_ADMIN, Role.BRANCH_MANAGER),
  authRateLimiter,
  validateRequest(AuthValidation.registerSchema),
  AuthController.register,
);
router.post(
  '/login',
  authRateLimiter,
  validateRequest(AuthValidation.loginSchema),
  AuthController.login,
);
router.post(
  '/verify-email',
  authRateLimiter,
  validateRequest(AuthValidation.verifyEmailSchema),
  AuthController.verifyEmail,
);
router.post(
  '/resend-otp',
  authRateLimiter,
  validateRequest(AuthValidation.resendOtpSchema),
  AuthController.resendOtp,
);
router.post(
  '/forgot-password',
  authRateLimiter,
  validateRequest(AuthValidation.forgotPasswordSchema),
  AuthController.forgotPassword,
);
router.post(
  '/reset-password',
  authRateLimiter,
  validateRequest(AuthValidation.resetPasswordSchema),
  AuthController.resetPassword,
);
router.post('/refresh-token', AuthController.refreshToken);
router.post(
  '/google',
  authRateLimiter,
  validateRequest(AuthValidation.googleAuthSchema),
  AuthController.googleAuth,
);
router.post('/logout', auth(), AuthController.logout);
router.get('/me', auth(), AuthController.getMe);

export const AuthRoutes = router;
