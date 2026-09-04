import { Router } from 'express';
import { auth } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { Role } from '../../generated/prisma/index.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryValidation } from './inventory.validation.js';

const router = Router();

router.patch(
  '/adjust',
  auth,
  authorize(Role.BRANCH_MANAGER, Role.SUPER_ADMIN),
  validateRequest(InventoryValidation.adjustInventorySchema),
  InventoryController.adjustInventory,
);

export const InventoryRoutes = router;
