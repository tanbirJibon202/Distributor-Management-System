import { OrderStatus } from '../../generated/prisma/index.js';

export type CreateOrderItemInput = {
  productId: string;
  quantity: number;
};

export type CreateOrderInput = {
  retailerId: string;
  items: CreateOrderItemInput[];
  discount?: number;
};

export type RequestActor = {
  id: string;
  role: string;
  branchId: string | null;
};

// A constant map, not scattered ifs — any transition not listed here is rejected.
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.APPROVED, OrderStatus.CANCELLED],
  [OrderStatus.APPROVED]: [OrderStatus.DISPATCHED, OrderStatus.CANCELLED],
  [OrderStatus.DISPATCHED]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [],
};
