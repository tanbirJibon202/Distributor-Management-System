import { AuditValidation } from './audit.validation.js';
import { validateQuery, validateId } from '../../middleware/validateQuery.js';
import { Role } from '../../../generated/prisma/client.js';
import { Router } from 'express';
import { auth } from '../../middleware/checkAuth.js';
import { AuditController } from './audit.controller.js';

const router = Router();
router.param('id', validateId);

router.get(
  '/',
  auth(Role.SUPER_ADMIN),
  validateQuery(AuditValidation.listQuerySchema),
  AuditController.getAuditLogs,
);

export const AuditRoutes = router;
