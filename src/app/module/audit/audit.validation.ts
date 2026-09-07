import { paginationSchema } from '../../utils/queryValidation.js';

export const AuditValidation = { listQuerySchema: paginationSchema.strict() };
