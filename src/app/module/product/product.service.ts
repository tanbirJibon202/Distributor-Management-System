import type { Prisma } from '@prisma/client';
import httpStatus from 'http-status';
import { prisma } from '../../lib/prisma.js';
import { redisClient } from '../../lib/redis.js';
import { AppError } from '../../utils/AppError.js';
import { buildMeta, getPaginationParams } from '../../utils/pagination.js';
import { createAuditLog } from '../audit/audit.service.js';

const CACHE_TTL_SECONDS = 300;
const CACHE_PREFIX = 'products:';

type CreateProductInput = {
  name: string;
  sku: string;
  description?: string;
  category: string;
  unit: string;
  price: number;
  costPrice: number;
};

type ProductQuery = {
  page?: string;
  limit?: string;
  search?: string;
  category?: string;
  minPrice?: string;
  maxPrice?: string;
  sortBy?: 'name' | 'price' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
};

// Cache reads/writes are best-effort — a Redis outage must never break the
// request, so every call site swallows errors and falls through to Postgres.
const safeCacheGet = async (key: string) => {
  try {
    return await redisClient.get(key);
  } catch (error) {
    console.error('Redis GET failed, falling back to DB:', error);
    return null;
  }
};

const safeCacheSet = async (key: string, value: string) => {
  try {
    await redisClient.set(key, value, { EX: CACHE_TTL_SECONDS });
  } catch (error) {
    console.error('Redis SET failed:', error);
  }
};

const invalidateProductCache = async () => {
  try {
    const keys = await redisClient.keys(`${CACHE_PREFIX}*`);
    if (keys.length) await redisClient.del(keys);
  } catch (error) {
    console.error('Redis cache invalidation failed:', error);
  }
};

const createProduct = async (
  actorId: string,
  data: CreateProductInput,
  ipAddress?: string | null,
) => {
  const product = await prisma.$transaction(async (tx) => {
    const created = await tx.product.create({ data });

    await createAuditLog(tx, {
      userId: actorId,
      action: 'PRODUCT_CREATE',
      entity: 'Product',
      entityId: created.id,
      details: { sku: created.sku, name: created.name },
      ipAddress,
    });

    return created;
  });

  await invalidateProductCache();
  return product;
};

const getProducts = async (query: ProductQuery) => {
  const { page, limit, skip } = getPaginationParams(query);
  const cacheKey = `${CACHE_PREFIX}${new URLSearchParams(query as Record<string, string>).toString()}`;

  const cached = await safeCacheGet(cacheKey);
  if (cached) return JSON.parse(cached);

  const where: Prisma.ProductWhereInput = { deletedAt: null };

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { sku: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  if (query.category) where.category = query.category;
  if (query.minPrice || query.maxPrice) {
    where.price = {
      ...(query.minPrice ? { gte: Number(query.minPrice) } : {}),
      ...(query.maxPrice ? { lte: Number(query.maxPrice) } : {}),
    };
  }

  const sortBy = query.sortBy ?? 'createdAt';
  const sortOrder = query.sortOrder ?? 'desc';

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
    }),
    prisma.product.count({ where }),
  ]);

  const result = { meta: buildMeta(page, limit, total), data: products };
  await safeCacheSet(cacheKey, JSON.stringify(result));
  return result;
};

const getProductById = async (id: string) => {
  const product = await prisma.product.findFirst({ where: { id, deletedAt: null } });
  if (!product) {
    throw new AppError(httpStatus.NOT_FOUND, 'Product not found');
  }
  return product;
};

type UpdateProductInput = Partial<Omit<CreateProductInput, 'sku'>>;

const updateProduct = async (
  actorId: string,
  id: string,
  data: UpdateProductInput,
  ipAddress?: string | null,
) => {
  const product = await prisma.product.findFirst({ where: { id, deletedAt: null } });
  if (!product) {
    throw new AppError(httpStatus.NOT_FOUND, 'Product not found');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.product.update({ where: { id }, data });

    await createAuditLog(tx, {
      userId: actorId,
      action: 'PRODUCT_UPDATE',
      entity: 'Product',
      entityId: id,
      details: { sku: product.sku, changes: data },
      ipAddress,
    });

    return result;
  });

  await invalidateProductCache();
  return updated;
};

const deleteProduct = async (actorId: string, id: string, ipAddress?: string | null) => {
  const product = await prisma.product.findFirst({ where: { id, deletedAt: null } });
  if (!product) {
    throw new AppError(httpStatus.NOT_FOUND, 'Product not found');
  }

  const result = await prisma.$transaction(async (tx) => {
    const deleted = await tx.product.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        sku: `${product.sku}:deleted:${product.id}`,
      },
    });

    await createAuditLog(tx, {
      userId: actorId,
      action: 'PRODUCT_DELETE',
      entity: 'Product',
      entityId: id,
      details: { sku: product.sku, name: product.name },
      ipAddress,
    });

    return deleted;
  });

  await invalidateProductCache();
  return result;
};

export const ProductService = {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
};
