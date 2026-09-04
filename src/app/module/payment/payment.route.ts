import { Router } from 'express';
import { auth } from '../../middleware/checkAuth.js';
import { validateRequest } from '../../middleware/validateRequest.js';
import { PaymentController } from './payment.controller.js';
import { PaymentValidation } from './payment.validation.js';

const router = Router();

router.post(
  '/initiate',
  auth(),
  validateRequest(PaymentValidation.initiatePaymentSchema),
  PaymentController.initiatePayment,
);
router.post('/callback', PaymentController.handleCallback);
router.get('/:id', auth(), PaymentController.getPaymentById);

export const PaymentRoutes = router;
