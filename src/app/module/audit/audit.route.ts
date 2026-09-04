import { Role } from '@prisma/client';
import { Router } from 'express';
import { auth } from '../../middleware/checkAuth.js';
import { AuditController } from './audit.controller.js';

const router = Router();

router.get('/', auth(Role.SUPER_ADMIN), AuditController.getAuditLogs);

export const AuditRoutes = router;
