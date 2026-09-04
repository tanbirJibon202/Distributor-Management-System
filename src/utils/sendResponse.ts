import type { Response } from 'express';

type Meta = {
  page: number;
  limit: number;
  total: number;
  totalPage: number;
};

type SendResponseArgs<T> = {
  statusCode: number;
  success?: boolean;
  message: string;
  meta?: Meta;
  data?: T;
};

export const sendResponse = <T>(res: Response, args: SendResponseArgs<T>) => {
  res.status(args.statusCode).json({
    success: args.success ?? true,
    message: args.message,
    ...(args.meta ? { meta: args.meta } : {}),
    data: args.data ?? null,
  });
};
