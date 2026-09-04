export type PaginationQuery = {
  page?: string;
  limit?: string;
};

export const getPaginationParams = (query: PaginationQuery) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Number(query.limit) || 10);
  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

export const buildMeta = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPage: Math.max(1, Math.ceil(total / limit)),
});
