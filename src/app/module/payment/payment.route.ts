import { validateId } from '../../middleware/validateQuery.js';
import { Role } from '../../../generated/prisma/client.js';
import { Router } from 'express';
import { auth } from '../../middleware/checkAuth.js';
import { validateRequest } from '../../middleware/validateRequest.js';
import { PaymentController } from './payment.controller.js';
import { PaymentValidation } from './payment.validation.js';

const router = Router();
router.param('id', validateId);

router.post(
  '/initiate',
  auth(),
  validateRequest(PaymentValidation.initiatePaymentSchema),
  PaymentController.initiatePayment,
);
router.get('/callback', PaymentController.handleCallback);
router.post('/callback', PaymentController.handleCallback);
router.get('/:id', auth(), PaymentController.getPaymentById);
// Returning money is restricted and audited, so it is its own route rather
// than a consequence of cancelling an order.
router.post(
  '/:id/refund',
  auth(Role.SUPER_ADMIN, Role.BRANCH_MANAGER),
  validateRequest(PaymentValidation.refundPaymentSchema),
  PaymentController.refundPayment,
);

export const PaymentRoutes = router;
