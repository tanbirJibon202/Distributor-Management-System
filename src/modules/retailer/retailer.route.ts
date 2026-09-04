import { Router } from 'express';
import { Role } from '../../generated/prisma/index.js';
import { auth } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { RetailerController } from './retailer.controller.js';
import { RetailerValidation } from './retailer.validation.js';

const router = Router();

router.post(
  '/',
  auth,
  authorize(Role.SUPER_ADMIN, Role.BRANCH_MANAGER),
  validateRequest(RetailerValidation.createRetailerSchema),
  RetailerController.createRetailer,
);
router.get('/:id/credit-status', auth, RetailerController.getCreditStatus);

export const RetailerRoutes = router;
