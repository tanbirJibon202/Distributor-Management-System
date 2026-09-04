import { Router } from 'express';
import { AuthRoutes } from '../modules/auth/auth.route.js';
import { UserRoutes } from '../modules/user/user.route.js';
import { BranchRoutes } from '../modules/branch/branch.route.js';
import { ProductRoutes } from '../modules/product/product.route.js';
import { InventoryRoutes } from '../modules/inventory/inventory.route.js';
import { RetailerRoutes } from '../modules/retailer/retailer.route.js';
import { OrderRoutes } from '../modules/order/order.route.js';
import { PaymentRoutes } from '../modules/payment/payment.route.js';
import { AuditRoutes } from '../modules/audit/audit.route.js';

const router = Router();

const moduleRoutes = [
  { path: '/auth', route: AuthRoutes },
  { path: '/users', route: UserRoutes.userRouter },
  { path: '/admin/users', route: UserRoutes.adminUserRouter },
  { path: '/branches', route: BranchRoutes },
  { path: '/products', route: ProductRoutes },
  { path: '/inventory', route: InventoryRoutes },
  { path: '/retailers', route: RetailerRoutes },
  { path: '/orders', route: OrderRoutes },
  { path: '/payments', route: PaymentRoutes },
  { path: '/admin/audit-logs', route: AuditRoutes },
];

moduleRoutes.forEach(({ path, route }) => router.use(path, route));

export default router;
