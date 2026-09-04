import { Router } from 'express';
import { auth } from '../../middlewares/auth.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { PaymentController } from './payment.controller.js';
import { PaymentValidation } from './payment.validation.js';

const router = Router();

router.post(
  '/initiate',
  auth,
  validateRequest(PaymentValidation.initiatePaymentSchema),
  PaymentController.initiatePayment,
);
router.post('/callback', PaymentController.handleCallback);

export const PaymentRoutes = router;
