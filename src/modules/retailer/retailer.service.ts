import httpStatus from 'http-status';
import { AppError } from '../../utils/AppError.js';
import { prisma } from '../../utils/prisma.js';
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

export const RetailerService = { createRetailer, getCreditStatus };
