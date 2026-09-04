import { Router } from 'express';
import { auth } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { Role } from '../../generated/prisma/index.js';
import { UserController } from './user.controller.js';
import { UserValidation } from './user.validation.js';

const userRouter = Router();
userRouter.patch('/me', auth, validateRequest(UserValidation.updateMeSchema), UserController.updateMe);

const adminUserRouter = Router();
adminUserRouter.patch(
  '/:id/role',
  auth,
  authorize(Role.SUPER_ADMIN),
  validateRequest(UserValidation.updateRoleSchema),
  UserController.updateUserRole,
);

export const UserRoutes = { userRouter, adminUserRouter };
