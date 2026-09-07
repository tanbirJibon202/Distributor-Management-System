import httpStatus from 'http-status';
import { PaymentValidation } from './payment.validation.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { PaymentService } from './payment.service.js';

const initiatePayment = catchAsync(async (req, res) => {
  const result = await PaymentService.initiatePayment(req.user!, req.body.orderId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Payment initiated successfully',
    data: result,
  });
});

const getPaymentById = catchAsync(async (req, res) => {
  const result = await PaymentService.getPaymentById(req.user!, req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Payment retrieved successfully',
    data: result,
  });
});

const handleCallback = catchAsync(async (req, res) => {
  const { paymentID, status } = PaymentValidation.callbackSchema.parse({
    paymentID: req.query.paymentID ?? req.body?.paymentID,
    status: req.query.status ?? req.body?.status,
  });

  const result = await PaymentService.handleCallback(paymentID, status);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: result.message,
    data: result,
  });
});

const refundPayment = catchAsync(async (req, res) => {
  const result = await PaymentService.refundPayment(
    req.user!,
    req.params.id as string,
    req.body.reason,
    req.ip,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Payment refunded successfully',
    data: result,
  });
});

export const PaymentController = { initiatePayment, getPaymentById, handleCallback, refundPayment };
