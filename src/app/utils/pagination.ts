import { paginationSchema } from './queryValidation.js';

export type PaginationQuery = {
  page?: string;
  limit?: string;
};

export const getPaginationParams = (query: PaginationQuery) => {
  const parsed = paginationSchema.parse(query);
  const page = Number(parsed.page ?? 1);
  const limit = Number(parsed.limit ?? 10);
  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

export const buildMeta = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPage: Math.max(1, Math.ceil(total / limit)),
});
