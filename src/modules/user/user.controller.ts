import httpStatus from 'http-status';
import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { UserService } from './user.service.js';

const updateMe = catchAsync(async (req, res) => {
  const result = await UserService.updateMe(req.user!.id, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Profile updated successfully',
    data: result,
  });
});

const updateUserRole = catchAsync(async (req, res) => {
  const result = await UserService.updateUserRole(
    req.user!.id,
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

export const UserController = { updateMe, updateUserRole };
