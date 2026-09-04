import type { Prisma } from '../../generated/prisma/index.js';
import { type PaginationQuery, buildMeta, getPaginationParams } from '../../utils/pagination.js';
import { prisma } from '../../utils/prisma.js';

type TxClient = Prisma.TransactionClient;

type CreateAuditLogInput = {
  userId: string;
  action: string;
  entity: string;
  entityId: string;
  details?: Prisma.InputJsonValue;
  ipAddress?: string | null;
};

export const createAuditLog = async (tx: TxClient, input: CreateAuditLogInput) => {
  await tx.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      details: input.details ?? undefined,
      ipAddress: input.ipAddress ?? null,
    },
  });
};

const getAuditLogs = async (query: PaginationQuery) => {
  const { page, limit, skip } = getPaginationParams(query);

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    }),
    prisma.auditLog.count(),
  ]);

  return { meta: buildMeta(page, limit, total), data: logs };
};

export const AuditService = { getAuditLogs };
