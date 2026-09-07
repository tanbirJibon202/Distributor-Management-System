import httpStatus from 'http-status';
import { AppError } from '../../utils/AppError.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { ProductService } from './product.service.js';

const createProduct = catchAsync(async (req, res) => {
  const result = await ProductService.createProduct(req.user!.userId, req.body, req.ip);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    message: 'Product created successfully',
    data: result,
  });
});

const getProducts = catchAsync(async (req, res) => {
  const result = await ProductService.getProducts(req.query as Record<string, string>);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Products retrieved successfully',
    meta: result.meta,
    data: result.data,
  });
});

const getProductById = catchAsync(async (req, res) => {
  const result = await ProductService.getProductById(req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Product retrieved successfully',
    data: result,
  });
});

const updateProduct = catchAsync(async (req, res) => {
  const result = await ProductService.updateProduct(
    req.user!.userId,
    req.params.id as string,
    req.body,
    req.ip,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Product updated successfully',
    data: result,
  });
});

const deleteProduct = catchAsync(async (req, res) => {
  const result = await ProductService.deleteProduct(
    req.user!.userId,
    req.params.id as string,
    req.ip,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Product deleted successfully',
    data: result,
  });
});

const updateProductImage = catchAsync(async (req, res) => {
  if (!req.file) {
    throw new AppError(httpStatus.BAD_REQUEST, 'No image uploaded. Send one as the "image" field.');
  }

  const result = await ProductService.updateProductImage(
    req.user!.userId,
    req.params.id as string,
    req.file,
    req.ip,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Product image updated successfully',
    data: result,
  });
});

export const ProductController = {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  updateProductImage,
  deleteProduct,
};
