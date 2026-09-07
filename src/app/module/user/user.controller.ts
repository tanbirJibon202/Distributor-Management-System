import httpStatus from 'http-status';
import { AppError } from '../../utils/AppError.js';
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

const deactivateUser = catchAsync(async (req, res) => {
  const result = await UserService.deactivateUser(
    req.user!.userId,
    req.params.id as string,
    req.ip,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'User deactivated successfully',
    data: result,
  });
});

const updateProfileImage = catchAsync(async (req, res) => {
  if (!req.file) {
    throw new AppError(httpStatus.BAD_REQUEST, 'No image uploaded. Send one as the "image" field.');
  }

  const result = await UserService.updateProfileImage(req.user!.userId, req.file, req.ip);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Profile image updated successfully',
    data: result,
  });
});

export const UserController = {
  updateMe,
  updateProfileImage,
  getUsers,
  updateUserRole,
  deactivateUser,
};
