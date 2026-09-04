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

export const InventoryController = { adjustInventory };
