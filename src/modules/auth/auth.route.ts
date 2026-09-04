import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { auth } from '../../middlewares/auth.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { AuthController } from './auth.controller.js';
import { AuthValidation } from './auth.validation.js';

const router = Router();

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts, please try again later', errors: [] },
});

router.post(
  '/register',
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
router.post('/refresh-token', AuthController.refreshToken);
router.post(
  '/google',
  validateRequest(AuthValidation.googleAuthSchema),
  AuthController.googleAuth,
);
router.get('/me', auth, AuthController.getMe);

export const AuthRoutes = router;
