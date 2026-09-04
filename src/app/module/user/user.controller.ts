import httpStatus from 'http-status';
import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { UserService } from './user.service.js';

const updateMe = catchAsync(async (req, res) => {
  const result = await UserService.updateMe(req.user!.userId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Profile updated successfully',
    data: result,
  });
});

const getUsers = catchAsync(async (req, res) => {
  const result = await UserService.getUsers(req.query as Record<string, string>);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Users retrieved successfully',
    meta: result.meta,
    data: result.data,
  });
});

const updateUserRole = catchAsync(async (req, res) => {
  const result = await UserService.updateUserRole(
    req.user!.userId,
    req.params.id as string,
    req.body,
    req.ip,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'User role updated successfully',
    data: result,
  });
});

export const UserController = { updateMe, getUsers, updateUserRole };
