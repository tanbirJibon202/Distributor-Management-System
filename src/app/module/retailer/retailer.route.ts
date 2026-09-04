import { Role } from '@prisma/client';
import { Router } from 'express';
import { auth } from '../../middleware/checkAuth.js';
import { validateRequest } from '../../middleware/validateRequest.js';
import { RetailerController } from './retailer.controller.js';
import { RetailerValidation } from './retailer.validation.js';

const router = Router();

router.post(
  '/',
  auth(Role.SUPER_ADMIN, Role.BRANCH_MANAGER),
  validateRequest(RetailerValidation.createRetailerSchema),
  RetailerController.createRetailer,
);
router.get('/:id/credit-status', auth(), RetailerController.getCreditStatus);

export const RetailerRoutes = router;
