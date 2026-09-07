import httpStatus from 'http-status';
import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { OrderService } from './order.service.js';

const createOrder = catchAsync(async (req, res) => {
  const result = await OrderService.createOrder(req.user!, req.body, req.ip);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    message: 'Order created successfully',
    data: result,
  });
});

const getOrders = catchAsync(async (req, res) => {
  const result = await OrderService.getOrders(req.user!, req.query as Record<string, string>);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Orders retrieved successfully',
    meta: result.meta,
    data: result.data,
  });
});

const getOrderById = catchAsync(async (req, res) => {
  const result = await OrderService.getOrderById(req.user!, req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Order retrieved successfully',
    data: result,
  });
});

const updateOrderStatus = catchAsync(async (req, res) => {
  const result = await OrderService.updateOrderStatus(
    req.user!,
    req.params.id as string,
    req.body.status,
    req.ip,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Order status updated successfully',
    data: result,
  });
});

// The only endpoint that does not go through sendResponse: the body is the PDF
// itself, not the { success, message, data } envelope. Errors thrown before the
// headers are sent still reach the global handler and keep that contract.
const getOrderInvoice = catchAsync(async (req, res) => {
  const { pdf, invoiceNo } = await OrderService.getOrderInvoice(req.user!, req.params.id as string);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${invoiceNo}.pdf"`);
  res.setHeader('Content-Length', pdf.length);
  res.status(httpStatus.OK).send(pdf);
});

const emailOrderInvoice = catchAsync(async (req, res) => {
  const result = await OrderService.emailOrderInvoice(req.user!, req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: result.message,
    data: null,
  });
});

export const OrderController = {
  createOrder,
  getOrders,
  getOrderById,
  updateOrderStatus,
  getOrderInvoice,
  emailOrderInvoice,
};
