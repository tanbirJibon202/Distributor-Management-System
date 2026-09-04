import httpStatus from 'http-status';
import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { BranchService } from './branch.service.js';

const createBranch = catchAsync(async (req, res) => {
  const result = await BranchService.createBranch(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    message: 'Branch created successfully',
    data: result,
  });
});

const getBranches = catchAsync(async (_req, res) => {
  const result = await BranchService.getBranches();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Branches retrieved successfully',
    data: result,
  });
});

export const BranchController = { createBranch, getBranches };
