import { Role } from '@prisma/client';
import { Router } from 'express';
import { auth } from '../../middleware/checkAuth.js';
import { validateRequest } from '../../middleware/validateRequest.js';
import { BranchController } from './branch.controller.js';
import { BranchValidation } from './branch.validation.js';

const router = Router();

router.post(
  '/',
  auth(Role.SUPER_ADMIN),
  validateRequest(BranchValidation.createBranchSchema),
  BranchController.createBranch,
);
router.get('/', auth(), BranchController.getBranches);

export const BranchRoutes = router;
