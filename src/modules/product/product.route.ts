import { Router } from 'express';
import { Role } from '../../generated/prisma/index.js';
import { auth } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { ProductController } from './product.controller.js';
import { ProductValidation } from './product.validation.js';

const router = Router();

router.post(
  '/',
  auth,
  authorize(Role.SUPER_ADMIN),
  validateRequest(ProductValidation.createProductSchema),
  ProductController.createProduct,
);
router.get('/', auth, ProductController.getProducts);
router.get('/:id', auth, ProductController.getProductById);
router.delete('/:id', auth, authorize(Role.SUPER_ADMIN), ProductController.deleteProduct);

export const ProductRoutes = router;
