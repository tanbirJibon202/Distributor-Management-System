import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

export const validateRequest = (schema: ZodType) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      req.body = parsed.body ?? req.body;
      next();
    } catch (error) {
      next(error);
    }
  };
};
