import { Role } from '../../../generated/prisma/client.js';
import { Router } from 'express';
import { auth } from '../../middleware/checkAuth.js';
import { AnalyticsController } from './analytics.controller.js';

const router = Router();

router.get('/', auth(Role.SUPER_ADMIN), AnalyticsController.getDashboardStats);

export const AnalyticsRoutes = router;
