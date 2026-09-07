import { validateQuery, validateId } from '../../middleware/validateQuery.js';
import { Role } from '../../../generated/prisma/client.js';
import { Router } from 'express';
import { auth } from '../../middleware/checkAuth.js';
import { validateRequest } from '../../middleware/validateRequest.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryValidation } from './inventory.validation.js';

const router = Router();
router.param('id', validateId);

router.get(
  '/',
  auth(),
  validateQuery(InventoryValidation.listQuerySchema),
  InventoryController.getInventory,
);

router.patch(
  '/adjust',
  auth(Role.BRANCH_MANAGER, Role.SUPER_ADMIN),
  validateRequest(InventoryValidation.adjustInventorySchema),
  InventoryController.adjustInventory,
);

export const InventoryRoutes = router;
