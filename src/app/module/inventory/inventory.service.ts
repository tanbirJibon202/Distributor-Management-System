import { type Prisma, Role } from '@prisma/client';
import httpStatus from 'http-status';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { buildMeta, getPaginationParams } from '../../utils/pagination.js';
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
      userId: actor.userId,
      action: 'INVENTORY_ADJUST',
      entity: 'BranchInventory',
      entityId: inventory.id,
      details: {
        productId: input.productId,
        branchId: input.branchId,
        quantity: input.quantity,
        reason: input.reason,
      },
      ipAddress,
    });

    return inventory;
  });

  return result;
};

type InventoryQuery = {
  page?: string;
  limit?: string;
  branchId?: string;
  search?: string;
  lowStock?: string;
  sortOrder?: 'asc' | 'desc';
};

const getInventory = async (actor: RequestActor, query: InventoryQuery) => {
  const { page, limit, skip } = getPaginationParams(query);

  // A branch manager and an SR only ever see their own branch's stock; only a
  // super admin can look across branches, and may narrow with ?branchId=.
  const where: Prisma.BranchInventoryWhereInput =
    actor.role === Role.SUPER_ADMIN
      ? query.branchId
        ? { branchId: query.branchId }
        : {}
      : { branchId: actor.branchId ?? '' };

  where.product = { deletedAt: null };

  if (query.search) {
    where.product = {
      deletedAt: null,
      OR: [
        { name: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
      ],
    };
  }
  if (query.lowStock) where.stock = { lte: Number(query.lowStock) };

  const [inventory, total] = await Promise.all([
    prisma.branchInventory.findMany({
      where,
      skip,
      take: limit,
      orderBy: { stock: query.sortOrder ?? 'asc' },
      include: {
        product: { select: { id: true, name: true, sku: true, unit: true, price: true } },
        branch: { select: { id: true, name: true, code: true } },
      },
    }),
    prisma.branchInventory.count({ where }),
  ]);

  return { meta: buildMeta(page, limit, total), data: inventory };
};

export const InventoryService = { adjustInventory, getInventory };
