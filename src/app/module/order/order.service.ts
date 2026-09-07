import { OrderStatus, PaymentStatus, Prisma, Role } from '../../../generated/prisma/client.js';
import httpStatus from 'http-status';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { lockOrder } from '../../utils/orderLock.js';
import { assertOrderAccess } from '../../utils/orderAccess.js';
import { sendEmail, sendEmailSafely } from '../../lib/mailer.js';
import { generateInvoiceNo } from '../../utils/generateInvoiceNo.js';
import { buildInvoicePdf } from '../../utils/invoicePdf.js';
import { type PaginationQuery, buildMeta, getPaginationParams } from '../../utils/pagination.js';
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
  const discount = new Prisma.Decimal(input.discount ?? 0);

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

    let totalAmount = new Prisma.Decimal(0);
    const itemsData = input.items.map((item) => {
      const product = productById.get(item.productId)!;
      const unitPrice = product.price;
      const subTotal = unitPrice.mul(item.quantity);
      totalAmount = totalAmount.plus(subTotal);
      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
        subTotal,
        productName: product.name,
      };
    });

    if (totalAmount.gt('9999999999.99')) {
      throw new AppError(httpStatus.BAD_REQUEST, 'Order total exceeds the supported amount');
    }
    const payableAmount = totalAmount.minus(discount);
    if (payableAmount.lte(0)) {
      throw new AppError(httpStatus.BAD_REQUEST, 'Order payable amount must be greater than zero');
    }

    // Reserving credit is the same conditional-update shape as the stock
    // decrement below, for the same reason: being inside a transaction does
    // not make a read-then-write safe. At READ COMMITTED — the default, and
    // nothing here raises it — two concurrent orders for one retailer would
    // both read the same dueBalance, both pass a plain comparison, and both
    // increment, taking the retailer past their limit. Checking and
    // incrementing in one statement lets the database serialise them.
    const creditCeiling = retailer.creditLimit.minus(payableAmount);
    const creditReserved = await tx.retailer.updateMany({
      where: {
        id: input.retailerId,
        deletedAt: null,
        dueBalance: { lte: creditCeiling },
      },
      data: { dueBalance: { increment: payableAmount } },
    });
    if (creditReserved.count === 0) {
      // Re-read so the message reports the balance that actually blocked
      // this order, not the one read before a concurrent order landed.
      const current = await tx.retailer.findUnique({
        where: { id: input.retailerId },
        select: { dueBalance: true, creditLimit: true },
      });
      const availableCredit = Number(current?.creditLimit ?? 0) - Number(current?.dueBalance ?? 0);
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Credit limit exceeded: available credit is ${availableCredit.toFixed(2)}, attempted order is ${payableAmount.toFixed(2)}`,
      );
    }

    // Conditional update, never read-then-write — this is what makes the
    // stock check race-free under concurrent SRs hitting the same branch.
    for (const item of [...itemsData].sort((a, b) => a.productId.localeCompare(b.productId))) {
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
        srId: actor.userId,
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

    // No dueBalance increment here — the credit reservation above already
    // applied it as part of the same conditional update.

    await createAuditLog(tx, {
      userId: actor.userId,
      action: 'ORDER_CREATE',
      entity: 'Order',
      entityId: createdOrder.id,
      details: { invoiceNo, payableAmount: payableAmount.toString(), retailerId: input.retailerId },
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
        : { srId: actor.userId };

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

const getOrderById = async (actor: RequestActor, orderId: string) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
      retailer: true,
      branch: { select: { id: true, name: true, code: true } },
      sr: { select: { id: true, name: true, email: true } },
      payments: true,
    },
  });
  if (!order) {
    throw new AppError(httpStatus.NOT_FOUND, 'Order not found');
  }

  // Same scoping rule as the list endpoint: a manager is confined to their
  // branch and an SR to their own orders, so one can't read another's by id.
  assertOrderAccess(actor, order);

  return order;
};

const updateOrderStatus = async (
  actor: RequestActor,
  orderId: string,
  status: OrderStatus,
  ipAddress?: string | null,
) => {
  if (actor.role !== Role.SUPER_ADMIN && actor.role !== Role.BRANCH_MANAGER) {
    throw new AppError(httpStatus.FORBIDDEN, 'You cannot change order status');
  }
  const { updated, notify } = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        payments: true,
        sr: { select: { name: true, email: true } },
        retailer: { select: { shopName: true } },
      },
    });
    if (!order) throw new AppError(httpStatus.NOT_FOUND, 'Order not found');
    assertOrderAccess(actor, order);
    if (!ORDER_STATUS_TRANSITIONS[order.status].includes(status)) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Cannot transition order from ${order.status} to ${status}`,
      );
    }
    if (status === OrderStatus.CANCELLED) {
      // A reserved/in-flight payment must be reconciled before cancellation.
      if (
        Number(order.paidAmount) > 0 ||
        order.payments.some((p) => p.status !== PaymentStatus.FAILED)
      ) {
        throw new AppError(
          httpStatus.CONFLICT,
          'Cannot cancel an order with a successful or pending payment',
        );
      }
      await tx.retailer.update({
        where: { id: order.retailerId },
        data: { dueBalance: { decrement: order.payableAmount } },
      });
      for (const item of order.items) {
        await tx.branchInventory.upsert({
          where: { branchId_productId: { branchId: order.branchId, productId: item.productId } },
          update: { stock: { increment: item.quantity } },
          create: { branchId: order.branchId, productId: item.productId, stock: item.quantity },
        });
      }
    }
    const updated = await tx.order.update({ where: { id: orderId }, data: { status } });
    await createAuditLog(tx, {
      userId: actor.userId,
      action: 'ORDER_STATUS_CHANGE',
      entity: 'Order',
      entityId: orderId,
      details: { from: order.status, to: status },
      ipAddress,
    });
    // Null rather than a throw when the relations are absent. This runs inside
    // the transaction, so anything that can raise here would roll back a
    // legitimate status change — a notification must never be able to undo the
    // operation it is only reporting on. No data simply means no email.
    return {
      updated,
      notify:
        order.sr?.email && order.retailer
          ? {
              srName: order.sr.name,
              srEmail: order.sr.email,
              shopName: order.retailer.shopName,
              invoiceNo: order.invoiceNo,
              previousStatus: order.status,
              payableAmount: order.payableAmount,
              dueDate: order.dueDate,
            }
          : null,
    };
  });

  // After the commit, never inside it. The SR did not make this change — a
  // manager or admin did — and an order moving to APPROVED, DISPATCHED or
  // CANCELLED is something they have to act on, so they are told rather than
  // left to discover it by polling. Failure-tolerant: the status change has
  // already happened, and a mail server problem must not report it as failed.
  if (notify) {
    const actorName = await prisma.user
      .findUnique({ where: { id: actor.userId }, select: { name: true } })
      .then((u) => u?.name ?? 'A manager')
      .catch(() => 'A manager');

    await sendEmailSafely({
      to: notify.srEmail,
      subject: `Order ${notify.invoiceNo} is now ${status}`,
      template: 'order-status-changed',
      data: {
        srName: notify.srName,
        actorName,
        invoiceNo: notify.invoiceNo,
        shopName: notify.shopName,
        previousStatus: notify.previousStatus,
        newStatus: status,
        isCancelled: status === OrderStatus.CANCELLED,
        payableAmount: money(notify.payableAmount),
        dueDate: new Date(notify.dueDate).toDateString(),
      },
    });
  }

  return updated;
};

const getOrderInvoice = async (actor: RequestActor, orderId: string) => {
  // Reuses the read path rather than re-querying, so the invoice inherits the
  // same role scoping and 404 behaviour — a manager cannot download another
  // branch's invoice, an SR cannot download another SR's.
  const order = await getOrderById(actor, orderId);

  // Rendered outside any transaction: PDF generation is CPU work measured in
  // tens of milliseconds, and holding a database transaction across it would
  // keep row locks for no reason.
  const pdf = await buildInvoicePdf(order);

  return { pdf, invoiceNo: order.invoiceNo };
};

const money = (value: Prisma.Decimal | number) =>
  Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Emails the invoice PDF to the retailer.
 *
 * Both the render and the send happen outside any transaction, on purpose:
 * SMTP is a multi-second network call, and holding order rows locked across it
 * would turn a slow mail server into database contention.
 */
const emailOrderInvoice = async (actor: RequestActor, orderId: string) => {
  const order = await getOrderById(actor, orderId);

  if (!order.retailer.email) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `${order.retailer.shopName} has no email address on file. Add one to the retailer first, or download the PDF instead.`,
    );
  }

  const pdf = await buildInvoicePdf(order);
  const balanceDue = Number(order.payableAmount) - Number(order.paidAmount);

  // Not sendEmailSafely: the caller explicitly asked to send this, so a
  // failure is the outcome of their request, not a side effect of another one.
  await sendEmail({
    to: order.retailer.email,
    subject: `Invoice ${order.invoiceNo} from ${order.branch.name}`,
    template: 'order-invoice',
    data: {
      invoiceNo: order.invoiceNo,
      ownerName: order.retailer.ownerName,
      shopName: order.retailer.shopName,
      branchName: order.branch.name,
      payableAmount: money(order.payableAmount),
      paidAmount: money(order.paidAmount),
      balanceDue: money(balanceDue),
      dueDate: order.dueDate.toDateString(),
    },
    attachments: [{ filename: `${order.invoiceNo}.pdf`, content: pdf }],
  });

  return { message: `Invoice ${order.invoiceNo} sent to ${order.retailer.email}` };
};

export const OrderService = {
  createOrder,
  getOrders,
  getOrderById,
  updateOrderStatus,
  getOrderInvoice,
  emailOrderInvoice,
};
