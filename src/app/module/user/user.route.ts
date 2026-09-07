import { validateQuery, validateId } from '../../middleware/validateQuery.js';
import { Role } from '../../../generated/prisma/client.js';
import { Router } from 'express';
import { uploadSingleImage } from '../../lib/multer.js';
import { auth } from '../../middleware/checkAuth.js';
import { validateRequest } from '../../middleware/validateRequest.js';
import { UserController } from './user.controller.js';
import { UserValidation } from './user.validation.js';

const userRouter = Router();
userRouter.param('id', validateId);
userRouter.patch(
  '/me',
  auth(),
  validateRequest(UserValidation.updateMeSchema),
  UserController.updateMe,
);

// Kept under /me rather than PH's flat /profile-image, so every "acting on my
// own account" route sits at one path. Any authenticated role may set theirs.
userRouter.patch('/me/image', auth(), uploadSingleImage, UserController.updateProfileImage);

const adminUserRouter = Router();
adminUserRouter.param('id', validateId);
adminUserRouter.get(
  '/',
  auth(Role.SUPER_ADMIN),
  validateQuery(UserValidation.listQuerySchema),
  UserController.getUsers,
);
adminUserRouter.patch(
  '/:id/role',
  auth(Role.SUPER_ADMIN),
  validateRequest(UserValidation.updateRoleSchema),
  UserController.updateUserRole,
);
adminUserRouter.delete('/:id', auth(Role.SUPER_ADMIN), UserController.deactivateUser);

export const UserRoutes = { userRouter, adminUserRouter };
