import httpStatus from 'http-status';
import { OrderStatus, PaymentStatus, type Prisma, Role } from '../../generated/prisma/index.js';
import { AppError } from '../../utils/AppError.js';
import { generateInvoiceNo } from '../../utils/generateInvoiceNo.js';
import { type PaginationQuery, buildMeta, getPaginationParams } from '../../utils/pagination.js';
import { prisma } from '../../utils/prisma.js';
import { createAuditLog } from '../audit/audit.service.js';
import {
  type CreateOrderInput,
  ORDER_STATUS_TRANSITIONS,
  type RequestActor,
} from './order.interface.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const createOrder = async (
  actor: RequestActor,
  input: CreateOrderInput,
  ipAddress?: string | null,
) => {
  if (!actor.branchId) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Your account is not assigned to a branch');
  }
  const branchId = actor.branchId;
  const discount = input.discount ?? 0;

  const order = await prisma.$transaction(async (tx) => {
    const retailer = await tx.retailer.findFirst({
      where: { id: input.retailerId, deletedAt: null },
    });
    if (!retailer) {
      throw new AppError(httpStatus.NOT_FOUND, 'Retailer not found');
    }

    const productIds = input.items.map((item) => item.productId);
    const products = await tx.product.findMany({
      where: { id: { in: productIds }, deletedAt: null },
    });
    if (products.length !== new Set(productIds).size) {
      throw new AppError(httpStatus.NOT_FOUND, 'One or more products were not found');
    }
    const productById = new Map(products.map((p) => [p.id, p]));

    let totalAmount = 0;
    const itemsData = input.items.map((item) => {
      const product = productById.get(item.productId)!;
      const unitPrice = Number(product.price);
      const subTotal = unitPrice * item.quantity;
      totalAmount += subTotal;
      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
        subTotal,
        productName: product.name,
      };
    });

    const payableAmount = totalAmount - discount;
    if (payableAmount < 0) {
      throw new AppError(httpStatus.BAD_REQUEST, 'Discount cannot exceed the order total');
    }

    // Credit check must run inside the transaction — outside it, two
    // concurrent orders for the same retailer could both read a stale
    // dueBalance and both pass the limit check.
    const currentDue = Number(retailer.dueBalance);
    const creditLimit = Number(retailer.creditLimit);
    if (currentDue + payableAmount > creditLimit) {
      const availableCredit = creditLimit - currentDue;
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Credit limit exceeded: available credit is ${availableCredit.toFixed(2)}, attempted order is ${payableAmount.toFixed(2)}`,
      );
    }

    // Conditional update, never read-then-write — this is what makes the
    // stock check race-free under concurrent SRs hitting the same branch.
    for (const item of itemsData) {
      const updateResult = await tx.branchInventory.updateMany({
        where: { branchId, productId: item.productId, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      });
      if (updateResult.count === 0) {
        throw new AppError(httpStatus.BAD_REQUEST, `Insufficient stock for ${item.productName}`);
      }
    }

    const invoiceNo = await generateInvoiceNo(tx);

    const createdOrder = await tx.order.create({
      data: {
        invoiceNo,
        branchId,
        srId: actor.id,
        retailerId: input.retailerId,
        totalAmount,
        discount,
        payableAmount,
        dueDate: new Date(Date.now() + THIRTY_DAYS_MS),
        status: OrderStatus.PENDING,
        paymentStatus: PaymentStatus.UNPAID,
        items: {
          create: itemsData.map(({ productId, quantity, unitPrice, subTotal }) => ({
            productId,
            quantity,
            unitPrice,
            subTotal,
          })),
        },
      },
      include: { items: true },
    });

    await tx.retailer.update({
      where: { id: input.retailerId },
      data: { dueBalance: { increment: payableAmount } },
    });

    await createAuditLog(tx, {
      userId: actor.id,
      action: 'ORDER_CREATE',
      entity: 'Order',
      entityId: createdOrder.id,
      details: { invoiceNo, payableAmount, retailerId: input.retailerId },
      ipAddress,
    });

    return createdOrder;
  });

  return order;
};

type OrderQuery = PaginationQuery & { status?: OrderStatus; sortOrder?: 'asc' | 'desc' };

const getOrders = async (actor: RequestActor, query: OrderQuery) => {
  const { page, limit, skip } = getPaginationParams(query);

  if (actor.role === Role.BRANCH_MANAGER && !actor.branchId) {
    throw new AppError(httpStatus.FORBIDDEN, 'Your account is not assigned to a branch');
  }

  const where: Prisma.OrderWhereInput =
    actor.role === Role.SUPER_ADMIN
      ? {}
      : actor.role === Role.BRANCH_MANAGER
        ? { branchId: actor.branchId as string }
        : { srId: actor.id };

  if (query.status) where.status = query.status;

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: query.sortOrder ?? 'desc' },
      include: { items: true, retailer: true },
    }),
    prisma.order.count({ where }),
  ]);

  return { meta: buildMeta(page, limit, total), data: orders };
};

const updateOrderStatus = async (
  actor: RequestActor,
  orderId: string,
  status: OrderStatus,
  ipAddress?: string | null,
) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, payments: true },
  });
  if (!order) {
    throw new AppError(httpStatus.NOT_FOUND, 'Order not found');
  }

  if (actor.role === Role.BRANCH_MANAGER && actor.branchId !== order.branchId) {
    throw new AppError(httpStatus.FORBIDDEN, 'You can only manage orders for your own branch');
  }

  const allowedNext = ORDER_STATUS_TRANSITIONS[order.status];
  if (!allowedNext.includes(status)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Cannot transition order from ${order.status} to ${status}`,
    );
  }

  if (status === OrderStatus.CANCELLED) {
    const hasSuccessfulPayment = order.payments.some((p) => p.status === PaymentStatus.PAID);
    if (hasSuccessfulPayment) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        'Cannot cancel an order with a successful payment',
      );
    }

    return prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        await tx.branchInventory.upsert({
          where: { branchId_productId: { branchId: order.branchId, productId: item.productId } },
          update: { stock: { increment: item.quantity } },
          create: { branchId: order.branchId, productId: item.productId, stock: item.quantity },
        });
      }

      await tx.retailer.update({
        where: { id: order.retailerId },
        data: { dueBalance: { decrement: order.payableAmount } },
      });

      const updated = await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED },
      });

      await createAuditLog(tx, {
        userId: actor.id,
        action: 'ORDER_STATUS_CHANGE',
        entity: 'Order',
        entityId: orderId,
        details: { from: order.status, to: status },
        ipAddress,
      });

      return updated;
    });
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({ where: { id: orderId }, data: { status } });

    await createAuditLog(tx, {
      userId: actor.id,
      action: 'ORDER_STATUS_CHANGE',
      entity: 'Order',
      entityId: orderId,
      details: { from: order.status, to: status },
      ipAddress,
    });

    return updated;
  });
};

export const OrderService = { createOrder, getOrders, updateOrderStatus };
