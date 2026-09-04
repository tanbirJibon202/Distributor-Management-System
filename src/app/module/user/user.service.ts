import { type Prisma, Role } from '@prisma/client';
import httpStatus from 'http-status';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { buildMeta, getPaginationParams } from '../../utils/pagination.js';
import { createAuditLog } from '../audit/audit.service.js';

const userPublicSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  branchId: true,
  createdAt: true,
  updatedAt: true,
} as const;

const updateMe = async (userId: string, data: { name?: string; phone?: string }) => {
  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: userPublicSelect,
  });
  return user;
};

type UserQuery = {
  page?: string;
  limit?: string;
  search?: string;
  role?: Role;
  branchId?: string;
  sortOrder?: 'asc' | 'desc';
};

const getUsers = async (query: UserQuery) => {
  const { page, limit, skip } = getPaginationParams(query);

  const where: Prisma.UserWhereInput = { deletedAt: null };

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { email: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  if (query.role) where.role = query.role;
  if (query.branchId) where.branchId = query.branchId;

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: query.sortOrder ?? 'desc' },
      select: {
        ...userPublicSelect,
        branch: { select: { id: true, name: true, code: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return { meta: buildMeta(page, limit, total), data: users };
};

const updateUserRole = async (
  actorId: string,
  targetUserId: string,
  data: { role: Role; branchId?: string | null },
  ipAddress?: string | null,
) => {
  const targetUser = await prisma.user.findFirst({
    where: { id: targetUserId, deletedAt: null },
  });
  if (!targetUser) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }

  const branchId = data.role === Role.SUPER_ADMIN ? null : (data.branchId ?? null);

  if (branchId) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, deletedAt: null } });
    if (!branch) {
      throw new AppError(httpStatus.NOT_FOUND, 'Branch not found');
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.update({
      where: { id: targetUserId },
      data: { role: data.role, branchId },
      select: userPublicSelect,
    });

    await createAuditLog(tx, {
      userId: actorId,
      action: 'ROLE_CHANGE',
      entity: 'User',
      entityId: targetUserId,
      details: { from: targetUser.role, to: data.role, branchId },
      ipAddress,
    });

    return result;
  });

  return updated;
};

export const UserService = { updateMe, getUsers, updateUserRole };
