import httpStatus from 'http-status';
import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { RetailerService } from './retailer.service.js';

const createRetailer = catchAsync(async (req, res) => {
  const result = await RetailerService.createRetailer(req.user!.userId, req.body, req.ip);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    message: 'Retailer created successfully',
    data: result,
  });
});

const getRetailers = catchAsync(async (req, res) => {
  const result = await RetailerService.getRetailers(req.query as Record<string, string>);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Retailers retrieved successfully',
    meta: result.meta,
    data: result.data,
  });
});

const deleteRetailer = catchAsync(async (req, res) => {
  const result = await RetailerService.deleteRetailer(
    req.user!.userId,
    req.params.id as string,
    req.ip,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Retailer deleted successfully',
    data: result,
  });
});

const getCreditStatus = catchAsync(async (req, res) => {
  const result = await RetailerService.getCreditStatus(req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Retailer credit status retrieved successfully',
    data: result,
  });
});

export const RetailerController = {
  createRetailer,
  getRetailers,
  deleteRetailer,
  getCreditStatus,
};
