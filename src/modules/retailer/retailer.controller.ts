import httpStatus from 'http-status';
import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { RetailerService } from './retailer.service.js';

const createRetailer = catchAsync(async (req, res) => {
  const result = await RetailerService.createRetailer(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    message: 'Retailer created successfully',
    data: result,
  });
});

const getCreditStatus = catchAsync(async (req, res) => {
  const result = await RetailerService.getCreditStatus(req.params.id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Retailer credit status retrieved successfully',
    data: result,
  });
});

export const RetailerController = { createRetailer, getCreditStatus };
