import { Role } from '@prisma/client';
import { Router } from 'express';
import { auth } from '../../middleware/checkAuth.js';
import { validateRequest } from '../../middleware/validateRequest.js';
import { ProductController } from './product.controller.js';
import { ProductValidation } from './product.validation.js';

const router = Router();

router.post(
  '/',
  auth(Role.SUPER_ADMIN),
  validateRequest(ProductValidation.createProductSchema),
  ProductController.createProduct,
);
router.get('/', auth(), ProductController.getProducts);
router.get('/:id', auth(), ProductController.getProductById);
router.patch(
  '/:id',
  auth(Role.SUPER_ADMIN),
  validateRequest(ProductValidation.updateProductSchema),
  ProductController.updateProduct,
);
router.delete('/:id', auth(Role.SUPER_ADMIN), ProductController.deleteProduct);

export const ProductRoutes = router;
