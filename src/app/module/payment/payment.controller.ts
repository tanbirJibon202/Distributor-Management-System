import httpStatus from 'http-status';
import { AppError } from '../../utils/AppError.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { PaymentService } from './payment.service.js';

const initiatePayment = catchAsync(async (req, res) => {
  const result = await PaymentService.initiatePayment(req.user!.userId, req.body.orderId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Payment initiated successfully',
    data: result,
  });
});

const getPaymentById = catchAsync(async (req, res) => {
  const result = await PaymentService.getPaymentById(req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Payment retrieved successfully',
    data: result,
  });
});

const handleCallback = catchAsync(async (req, res) => {
  const paymentID = (req.query.paymentID as string) ?? req.body.paymentID;
  const status = (req.query.status as string) ?? req.body.status;

  if (!paymentID || !status) {
    throw new AppError(httpStatus.BAD_REQUEST, 'paymentID and status are required');
  }

  const result = await PaymentService.handleCallback(paymentID, status);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: result.message,
    data: result,
  });
});

export const PaymentController = { initiatePayment, getPaymentById, handleCallback };
