import httpStatus from 'http-status';
import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { InventoryService } from './inventory.service.js';

const adjustInventory = catchAsync(async (req, res) => {
  const result = await InventoryService.adjustInventory(req.user!, req.body, req.ip);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Inventory adjusted successfully',
    data: result,
  });
});

const getInventory = catchAsync(async (req, res) => {
  const result = await InventoryService.getInventory(
    req.user!,
    req.query as Record<string, string>,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Inventory retrieved successfully',
    meta: result.meta,
    data: result.data,
  });
});

export const InventoryController = { adjustInventory, getInventory };
