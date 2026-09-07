import type { RequestHandler, RequestParamHandler } from 'express';
import { z, type ZodType } from 'zod';

export const validateQuery =
  (schema: ZodType): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req.query);
    next(result.success ? undefined : result.error);
  };

export const validateId: RequestParamHandler = (_req, _res, next, value) => {
  const result = z.object({ id: z.string().uuid('Invalid id') }).safeParse({ id: value });
  next(result.success ? undefined : result.error);
};
