import httpStatus from 'http-status';
import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { AnalyticsService } from './analytics.service.js';

const getDashboardStats = catchAsync(async (_req, res) => {
  const result = await AnalyticsService.getDashboardStats();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Dashboard statistics retrieved successfully',
    data: result,
  });
});

export const AnalyticsController = { getDashboardStats };
