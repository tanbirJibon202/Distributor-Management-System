import { type Prisma, Role } from '../../../generated/prisma/client.js';
import httpStatus from 'http-status';
import { deleteImage, uploadImage } from '../../lib/cloudinary.js';
import { sendEmailSafely } from '../../lib/mailer.js';
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
  imageUrl: true,
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
  const { updated, notify } = await prisma.$transaction(async (tx) => {
    // Serializes all admin-membership changes, including deactivation.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(73194211)`;
    const targetUser = await tx.user.findFirst({ where: { id: targetUserId, deletedAt: null } });
    if (!targetUser) throw new AppError(httpStatus.NOT_FOUND, 'User not found');
    const branchId = data.role === Role.SUPER_ADMIN ? null : (data.branchId ?? targetUser.branchId);
    if (data.role !== Role.SUPER_ADMIN && !branchId) {
      throw new AppError(httpStatus.BAD_REQUEST, 'A branch is required for staff roles');
    }
    if (branchId && !(await tx.branch.findFirst({ where: { id: branchId, deletedAt: null } }))) {
      throw new AppError(httpStatus.NOT_FOUND, 'Branch not found');
    }
    if (
      targetUser.role === Role.SUPER_ADMIN &&
      data.role !== Role.SUPER_ADMIN &&
      (await tx.user.count({ where: { role: Role.SUPER_ADMIN, deletedAt: null } })) <= 1
    ) {
      throw new AppError(
        httpStatus.CONFLICT,
        'Cannot demote the last super admin; promote another user first',
      );
    }
    const updated = await tx.user.update({
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
    return {
      updated,
      notify: {
        email: targetUser.email,
        name: targetUser.name,
        previousRole: targetUser.role,
        branchId,
      },
    };
  });

  // After the commit. A role change silently alters what someone can see and
  // do, and they had no part in it — so they are told, which also makes an
  // unauthorised change visible to the person it affects rather than only to
  // the audit log.
  const [actor, branch] = await Promise.all([
    prisma.user.findUnique({ where: { id: actorId }, select: { name: true } }).catch(() => null),
    notify.branchId
      ? prisma.branch
          .findUnique({ where: { id: notify.branchId }, select: { name: true } })
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  await sendEmailSafely({
    to: notify.email,
    subject: `Your DMS role is now ${data.role}`,
    template: 'account-role-changed',
    data: {
      name: notify.name,
      actorName: actor?.name ?? 'An administrator',
      previousRole: notify.previousRole,
      newRole: data.role,
      branchName: branch?.name ?? 'All branches',
    },
  });

  return updated;
};

/**
 * Replaces the caller's own avatar.
 *
 * Ordered the same way the product image is: upload first, commit second,
 * delete the superseded file last. A failed upload therefore leaves the current
 * picture intact instead of clearing the column and then failing, and the old
 * file is only discarded once the new URL is safely committed.
 */
const updateProfileImage = async (
  userId: string,
  file: Express.Multer.File,
  ipAddress?: string | null,
) => {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }

  const uploaded = await uploadImage(file.buffer, 'dms/avatars');

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.update({
      where: { id: userId },
      data: { imageUrl: uploaded.url, imagePublicId: uploaded.publicId },
      select: userPublicSelect,
    });

    await createAuditLog(tx, {
      userId,
      action: 'PROFILE_IMAGE_UPDATE',
      entity: 'User',
      entityId: userId,
      details: { imageUrl: uploaded.url },
      ipAddress,
    });

    return result;
  });

  if (user.imagePublicId) {
    await deleteImage(user.imagePublicId);
  }

  return updated;
};

const deactivateUser = async (actorId: string, targetUserId: string, ipAddress?: string | null) => {
  if (actorId === targetUserId) {
    throw new AppError(httpStatus.BAD_REQUEST, 'You cannot deactivate your own account');
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(73194211)`;
    const targetUser = await tx.user.findFirst({ where: { id: targetUserId, deletedAt: null } });
    if (!targetUser) throw new AppError(httpStatus.NOT_FOUND, 'User not found');
    // Soft delete rewrites the natural keys, the same way products and
    // retailers do it: `email` and `googleId` are unique, so a deactivated
    // row would otherwise permanently reserve that address.
    const deleted = await tx.user.update({
      where: { id: targetUserId },
      data: {
        deletedAt: new Date(),
        email: `${targetUser.email}:deleted:${targetUser.id}`,
        ...(targetUser.googleId
          ? { googleId: `${targetUser.googleId}:deleted:${targetUser.id}` }
          : {}),
      },
      select: userPublicSelect,
    });

    // Counted after the delete, so this transaction sees its own effect: an
    // admin may hand over to another admin, but the last one cannot leave or
    // the system becomes unadministrable. The shared advisory lock above
    // serializes this count with both deactivation and demotion.
    if (targetUser.role === Role.SUPER_ADMIN) {
      const remainingAdmins = await tx.user.count({
        where: { role: Role.SUPER_ADMIN, deletedAt: null },
      });
      if (remainingAdmins === 0) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          'Cannot deactivate the last super admin — promote another user first',
        );
      }
    }

    await createAuditLog(tx, {
      userId: actorId,
      // Details record the address as it was, since the stored value is now
      // the mutated one and is never shown to a client.
      action: 'USER_DEACTIVATE',
      entity: 'User',
      entityId: targetUserId,
      details: { email: targetUser.email, name: targetUser.name, role: targetUser.role },
      ipAddress,
    });

    return deleted;
  });
};

export const UserService = {
  updateMe,
  updateProfileImage,
  getUsers,
  updateUserRole,
  deactivateUser,
};
