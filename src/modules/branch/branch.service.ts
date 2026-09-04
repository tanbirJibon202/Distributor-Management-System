import { prisma } from '../../utils/prisma.js';

const createBranch = async (data: {
  name: string;
  code: string;
  type: string;
  location: string;
}) => {
  return prisma.branch.create({ data });
};

const getBranches = async () => {
  return prisma.branch.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
};

export const BranchService = { createBranch, getBranches };
