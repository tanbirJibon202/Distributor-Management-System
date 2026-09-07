import { validateQuery, validateId } from '../../middleware/validateQuery.js';
import { Role } from '../../../generated/prisma/client.js';
import { Router } from 'express';
import { auth } from '../../middleware/checkAuth.js';
import { validateRequest } from '../../middleware/validateRequest.js';
import { RetailerController } from './retailer.controller.js';
import { RetailerValidation } from './retailer.validation.js';

const router = Router();
router.param('id', validateId);

router.post(
  '/',
  auth(Role.SUPER_ADMIN, Role.BRANCH_MANAGER),
  validateRequest(RetailerValidation.createRetailerSchema),
  RetailerController.createRetailer,
);
router.get(
  '/',
  auth(),
  validateQuery(RetailerValidation.listQuerySchema),
  RetailerController.getRetailers,
);
router.get('/:id/credit-status', auth(), RetailerController.getCreditStatus);
router.delete(
  '/:id',
  auth(Role.SUPER_ADMIN, Role.BRANCH_MANAGER),
  RetailerController.deleteRetailer,
);

export const RetailerRoutes = router;
