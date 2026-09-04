import { Role } from '@prisma/client';
import { Router } from 'express';
import { auth } from '../../middleware/checkAuth.js';
import { validateRequest } from '../../middleware/validateRequest.js';
import { UserController } from './user.controller.js';
import { UserValidation } from './user.validation.js';

const userRouter = Router();
userRouter.patch(
  '/me',
  auth(),
  validateRequest(UserValidation.updateMeSchema),
  UserController.updateMe,
);

const adminUserRouter = Router();
adminUserRouter.patch(
  '/:id/role',
  auth(Role.SUPER_ADMIN),
  validateRequest(UserValidation.updateRoleSchema),
  UserController.updateUserRole,
);

export const UserRoutes = { userRouter, adminUserRouter };
