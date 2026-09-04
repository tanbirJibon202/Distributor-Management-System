import httpStatus from 'http-status';
import { Role } from '../../generated/prisma/index.js';
import { AppError } from '../../utils/AppError.js';
import { prisma } from '../../utils/prisma.js';
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

export const UserService = { updateMe, updateUserRole };
