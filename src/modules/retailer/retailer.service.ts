import httpStatus from 'http-status';
import { prisma } from '../../utils/prisma.js';
import { AppError } from '../../utils/AppError.js';

type CreateRetailerInput = {
  shopName: string;
  ownerName: string;
  phone: string;
  address: string;
  routeArea: string;
  creditLimit?: number;
};

const createRetailer = async (data: CreateRetailerInput) => {
  return prisma.retailer.create({ data });
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
