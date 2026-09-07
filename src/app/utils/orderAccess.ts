import { Role } from '../../generated/prisma/client.js';
import type { RequestActor } from '../module/order/order.interface.js';
import { AppError } from './AppError.js';

export const assertOrderAccess = (
  actor: RequestActor,
  order: { branchId: string; srId: string },
) => {
  if (
    actor.role === Role.SUPER_ADMIN ||
    (actor.role === Role.BRANCH_MANAGER && actor.branchId === order.branchId) ||
    (actor.role === Role.FIELD_SR && actor.userId === order.srId)
  )
    return;
  throw new AppError(403, 'You do not have access to this order');
};
