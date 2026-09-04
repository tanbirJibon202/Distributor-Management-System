import { Router } from 'express';
import { auth } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { Role } from '../../generated/prisma/index.js';
import { BranchController } from './branch.controller.js';
import { BranchValidation } from './branch.validation.js';

const router = Router();

router.post(
  '/',
  auth,
  authorize(Role.SUPER_ADMIN),
  validateRequest(BranchValidation.createBranchSchema),
  BranchController.createBranch,
);
router.get('/', auth, BranchController.getBranches);

export const BranchRoutes = router;
