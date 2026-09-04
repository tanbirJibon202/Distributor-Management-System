import type { Prisma } from '@prisma/client';
import httpStatus from 'http-status';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { buildMeta, getPaginationParams } from '../../utils/pagination.js';
import { createAuditLog } from '../audit/audit.service.js';

type CreateRetailerInput = {
  shopName: string;
  ownerName: string;
  phone: string;
  address: string;
  routeArea: string;
  creditLimit?: number;
};

const createRetailer = async (
  actorId: string,
  data: CreateRetailerInput,
  ipAddress?: string | null,
) => {
  return prisma.$transaction(async (tx) => {
    const retailer = await tx.retailer.create({ data });

    await createAuditLog(tx, {
      userId: actorId,
      action: 'RETAILER_CREATE',
      entity: 'Retailer',
      entityId: retailer.id,
      details: { shopName: retailer.shopName, phone: retailer.phone },
      ipAddress,
    });

    return retailer;
  });
};

type RetailerQuery = {
  page?: string;
  limit?: string;
  search?: string;
  routeArea?: string;
  sortBy?: 'shopName' | 'createdAt' | 'dueBalance';
  sortOrder?: 'asc' | 'desc';
};

const getRetailers = async (query: RetailerQuery) => {
  const { page, limit, skip } = getPaginationParams(query);

  const where: Prisma.RetailerWhereInput = { deletedAt: null };

  if (query.search) {
    where.OR = [
      { shopName: { contains: query.search, mode: 'insensitive' } },
      { ownerName: { contains: query.search, mode: 'insensitive' } },
      { phone: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  if (query.routeArea) where.routeArea = query.routeArea;

  const [retailers, total] = await Promise.all([
    prisma.retailer.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
    }),
    prisma.retailer.count({ where }),
  ]);

  return { meta: buildMeta(page, limit, total), data: retailers };
};

const deleteRetailer = async (actorId: string, id: string, ipAddress?: string | null) => {
  const retailer = await prisma.retailer.findFirst({ where: { id, deletedAt: null } });
  if (!retailer) {
    throw new AppError(httpStatus.NOT_FOUND, 'Retailer not found');
  }

  // An outstanding balance is money still owed — deleting the shop row would
  // quietly erase that debt, so it has to be settled first.
  if (Number(retailer.dueBalance) > 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Cannot delete a retailer with an outstanding due balance of ${Number(retailer.dueBalance).toFixed(2)}`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const deleted = await tx.retailer.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        phone: `${retailer.phone}:deleted:${retailer.id}`,
      },
    });

    await createAuditLog(tx, {
      userId: actorId,
      action: 'RETAILER_DELETE',
      entity: 'Retailer',
      entityId: id,
      details: { shopName: retailer.shopName, phone: retailer.phone },
      ipAddress,
    });

    return deleted;
  });
};

const getCreditStatus = async (id: string) => {
  const retailer = await prisma.retailer.findFirst({
    where: { id, deletedAt: null },
    select: { creditLimit: true, dueBalance: true },
  });
  if (!retailer) {
    throw new AppError(httpStatus.NOT_FOUND, 'Retailer not found');
  }

  const availableCredit = Number(retailer.creditLimit) - Number(retailer.dueBalance);

  return {
    creditLimit: retailer.creditLimit,
    dueBalance: retailer.dueBalance,
    availableCredit,
  };
};

export const RetailerService = {
  createRetailer,
  getRetailers,
  deleteRetailer,
  getCreditStatus,
};
