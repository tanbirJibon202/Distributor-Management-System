import httpStatus from 'http-status';
import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { AuditService } from './audit.service.js';

const getAuditLogs = catchAsync(async (req, res) => {
  const result = await AuditService.getAuditLogs(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Audit logs retrieved successfully',
    meta: result.meta,
    data: result.data,
  });
});

export const AuditController = { getAuditLogs };
