import httpStatus from 'http-status';
import { prisma } from '../../utils/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { Role } from '../../generated/prisma/index.js';
import { createAuditLog } from '../audit/audit.service.js';
import type { AdjustInventoryInput, RequestActor } from './inventory.interface.js';

const adjustInventory = async (
  actor: RequestActor,
  input: AdjustInventoryInput,
  ipAddress?: string | null,
) => {
  if (actor.role === Role.BRANCH_MANAGER && actor.branchId !== input.branchId) {
    throw new AppError(httpStatus.FORBIDDEN, 'You can only adjust inventory for your own branch');
  }

  const [branch, product] = await Promise.all([
    prisma.branch.findFirst({ where: { id: input.branchId, deletedAt: null } }),
    prisma.product.findFirst({ where: { id: input.productId, deletedAt: null } }),
  ]);
  if (!branch) throw new AppError(httpStatus.NOT_FOUND, 'Branch not found');
  if (!product) throw new AppError(httpStatus.NOT_FOUND, 'Product not found');

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.branchInventory.findUnique({
      where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
    });

    const newStock = (existing?.stock ?? 0) + input.quantity;
    if (newStock < 0) {
      throw new AppError(httpStatus.BAD_REQUEST, 'Adjustment would take stock below zero');
    }

    const inventory = await tx.branchInventory.upsert({
      where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
      update: { stock: newStock },
      create: { branchId: input.branchId, productId: input.productId, stock: newStock },
    });

    await createAuditLog(tx, {
      userId: actor.id,
      action: 'INVENTORY_ADJUST',
      entity: 'BranchInventory',
      entityId: inventory.id,
      details: { productId: input.productId, branchId: input.branchId, quantity: input.quantity, reason: input.reason },
      ipAddress,
    });

    return inventory;
  });

  return result;
};

export const InventoryService = { adjustInventory };
