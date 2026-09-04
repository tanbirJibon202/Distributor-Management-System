import httpStatus from 'http-status';
import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { ProductService } from './product.service.js';

const createProduct = catchAsync(async (req, res) => {
  const result = await ProductService.createProduct(req.body);

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

const deleteProduct = catchAsync(async (req, res) => {
  const result = await ProductService.deleteProduct(req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Product deleted successfully',
    data: result,
  });
});

export const ProductController = { createProduct, getProducts, getProductById, deleteProduct };
