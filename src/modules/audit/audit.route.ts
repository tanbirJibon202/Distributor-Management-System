import { Role } from '@prisma/client';
import { Router } from 'express';
import { auth } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { AuditController } from './audit.controller.js';

const router = Router();

router.get('/', auth, authorize(Role.SUPER_ADMIN), AuditController.getAuditLogs);

export const AuditRoutes = router;
