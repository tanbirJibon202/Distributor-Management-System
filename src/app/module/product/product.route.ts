import { validateQuery, validateId } from '../../middleware/validateQuery.js';
import { Role } from '../../../generated/prisma/client.js';
import { Router } from 'express';
import { uploadSingleImage } from '../../lib/multer.js';
import { auth } from '../../middleware/checkAuth.js';
import { validateRequest } from '../../middleware/validateRequest.js';
import { ProductController } from './product.controller.js';
import { ProductValidation } from './product.validation.js';

const router = Router();
router.param('id', validateId);

router.post(
  '/',
  auth(Role.SUPER_ADMIN),
  validateRequest(ProductValidation.createProductSchema),
  ProductController.createProduct,
);
router.get(
  '/',
  auth(),
  validateQuery(ProductValidation.listQuerySchema),
  ProductController.getProducts,
);
router.get('/:id', auth(), ProductController.getProductById);
router.patch(
  '/:id',
  auth(Role.SUPER_ADMIN),
  validateRequest(ProductValidation.updateProductSchema),
  ProductController.updateProduct,
);
// multipart/form-data, not JSON — no validateRequest here, since the body is a
// file stream rather than a parsable object. multer does the validating.
router.patch(
  '/:id/image',
  auth(Role.SUPER_ADMIN),
  uploadSingleImage,
  ProductController.updateProductImage,
);
router.delete('/:id', auth(Role.SUPER_ADMIN), ProductController.deleteProduct);

export const ProductRoutes = router;
