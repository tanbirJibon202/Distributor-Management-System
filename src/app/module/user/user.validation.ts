import { listQueryBase } from '../../utils/queryValidation.js';
import { Role } from '../../../generated/prisma/client.js';
import { z } from 'zod';

const updateMeSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    phone: z.string().optional(),
  }),
});

const updateRoleSchema = z.object({
  body: z
    .object({
      role: z.enum([Role.SUPER_ADMIN, Role.BRANCH_MANAGER, Role.FIELD_SR]),
      branchId: z.string().uuid().nullable().optional(),
    })
    .superRefine((data, ctx) => {
      const needsBranch = data.role === Role.BRANCH_MANAGER || data.role === Role.FIELD_SR;
      if (needsBranch && !data.branchId) {
        ctx.addIssue({
          code: 'custom',
          path: ['branchId'],
          message: 'branchId is required for BRANCH_MANAGER and FIELD_SR roles',
        });
      }
    }),
});

const listQuerySchema = listQueryBase
  .extend({
    role: z.enum(['SUPER_ADMIN', 'BRANCH_MANAGER', 'FIELD_SR']).optional(),
    branchId: z.string().uuid().optional(),
  })
  .strict();

export const UserValidation = { listQuerySchema, updateMeSchema, updateRoleSchema };
