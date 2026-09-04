import { Role } from '@prisma/client';
import { Router } from 'express';
import { auth } from '../../middleware/checkAuth.js';
import { validateRequest } from '../../middleware/validateRequest.js';
import { OrderController } from './order.controller.js';
import { OrderValidation } from './order.validation.js';

const router = Router();

router.post(
  '/',
  auth(Role.FIELD_SR),
  validateRequest(OrderValidation.createOrderSchema),
  OrderController.createOrder,
);
router.get('/', auth(), OrderController.getOrders);
router.get('/:id', auth(), OrderController.getOrderById);
router.patch(
  '/:id/status',
  auth(Role.BRANCH_MANAGER, Role.SUPER_ADMIN),
  validateRequest(OrderValidation.updateOrderStatusSchema),
  OrderController.updateOrderStatus,
);

export const OrderRoutes = router;
