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

export const OrderController = { createOrder, getOrders, updateOrderStatus };
