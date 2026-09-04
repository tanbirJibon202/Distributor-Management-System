import { Router } from 'express';
import { Role } from '../../generated/prisma/index.js';
import { auth } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { OrderController } from './order.controller.js';
import { OrderValidation } from './order.validation.js';

const router = Router();

router.post(
  '/',
  auth,
  authorize(Role.FIELD_SR),
  validateRequest(OrderValidation.createOrderSchema),
  OrderController.createOrder,
);
router.get('/', auth, OrderController.getOrders);
router.patch(
  '/:id/status',
  auth,
  authorize(Role.BRANCH_MANAGER, Role.SUPER_ADMIN),
  validateRequest(OrderValidation.updateOrderStatusSchema),
  OrderController.updateOrderStatus,
);

export const OrderRoutes = router;
