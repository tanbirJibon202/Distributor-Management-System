import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  Role,
} from '../../../generated/prisma/client.js';
import httpStatus from 'http-status';
import { BkashClient } from '../../lib/bkash.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { assertOrderAccess } from '../../utils/orderAccess.js';
import { lockOrder } from '../../utils/orderLock.js';
import { createAuditLog } from '../audit/audit.service.js';
import type { RequestActor } from '../order/order.interface.js';

const initiatePayment = async (actor: RequestActor, orderId: string) => {
  // Reserve locally before contacting the gateway. All order mutations use the
  // same row lock, including cancellation and callback settlement.
  const reservation = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new AppError(httpStatus.NOT_FOUND, 'Order not found');
    assertOrderAccess(actor, order);
    if (order.status === OrderStatus.CANCELLED) {
      throw new AppError(httpStatus.BAD_REQUEST, 'Cannot pay for a cancelled order');
    }
    const remainingAmount = order.payableAmount.minus(order.paidAmount);
    if (remainingAmount.lte(0)) {
      throw new AppError(httpStatus.BAD_REQUEST, 'There is no outstanding amount on this order');
    }
    const pending = await tx.payment.findFirst({
      where: { orderId, status: { in: [PaymentStatus.UNPAID, PaymentStatus.PARTIALLY_PAID] } },
    });
    if (pending) {
      throw new AppError(
        httpStatus.CONFLICT,
        'A payment is already pending for this order; reconcile it before retrying',
      );
    }
    const payment = await tx.payment.create({
      data: {
        orderId,
        amount: remainingAmount,
        provider: PaymentMethod.BKASH,
        status: PaymentStatus.UNPAID,
      },
    });
    await createAuditLog(tx, {
      userId: actor.userId,
      action: 'PAYMENT_INITIATE',
      entity: 'Order',
      entityId: orderId,
      details: { paymentId: payment.id, amount: remainingAmount.toString() },
    });
    return { payment, invoiceNo: order.invoiceNo };
  });

  let gateway: Awaited<ReturnType<typeof BkashClient.createPayment>>;
  try {
    gateway = await BkashClient.createPayment({
      amount: Number(reservation.payment.amount),
      merchantInvoiceNumber: reservation.invoiceNo,
    });
  } catch (error) {
    // No checkout URL has been exposed, so this reservation cannot be paid
    // through this API. Release it after a failed create call.
    await prisma.$transaction(async (tx) => {
      await lockOrder(tx, orderId);
      await tx.payment.updateMany({
        where: { id: reservation.payment.id, status: PaymentStatus.UNPAID, gatewayPaymentId: null },
        data: { status: PaymentStatus.FAILED },
      });
    });
    throw error;
  }
  // If persisting the gateway id fails, leave the reservation pending for
  // reconciliation; never release a potentially created checkout automatically.
  await prisma.payment.update({
    where: { id: reservation.payment.id },
    data: { gatewayPaymentId: gateway.paymentID },
  });
  return {
    paymentId: reservation.payment.id,
    paymentID: gateway.paymentID,
    bkashURL: gateway.bkashURL,
  };
};

const getPaymentById = async (actor: RequestActor, id: string) => {
  const payment = await prisma.payment.findUnique({
    where: { id },
    include: {
      order: {
        select: {
          id: true,
          branchId: true,
          srId: true,
          invoiceNo: true,
          payableAmount: true,
          paidAmount: true,
          paymentStatus: true,
          status: true,
        },
      },
    },
  });
  if (!payment) throw new AppError(httpStatus.NOT_FOUND, 'Payment not found');
  assertOrderAccess(actor, payment.order);
  return payment;
};

const handleCallback = async (paymentID: string, status: string) => {
  const payment = await prisma.payment.findFirst({ where: { gatewayPaymentId: paymentID } });
  if (!payment) throw new AppError(httpStatus.NOT_FOUND, 'Payment not found for this paymentID');
  if (payment.status === PaymentStatus.PAID) return { message: 'Payment already processed' };

  // A browser callback is only a hint. Query on cancel/failure too, so a
  // forged callback cannot release an active checkout or downgrade a payment.
  let verified: Awaited<ReturnType<typeof BkashClient.queryPayment>>;
  if (status === 'success') {
    try {
      verified = await BkashClient.executePayment(paymentID);
    } catch {
      verified = await BkashClient.queryPayment(paymentID);
    }
    if (verified.transactionStatus !== 'Completed') {
      verified = await BkashClient.queryPayment(paymentID);
    }
  } else {
    verified = await BkashClient.queryPayment(paymentID);
  }
  if (verified.paymentID !== paymentID) {
    throw new AppError(httpStatus.BAD_GATEWAY, 'Gateway returned a different payment ID');
  }

  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, payment.orderId);
    const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (current.status === PaymentStatus.PAID) return { message: 'Payment already processed' };
    const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId } });
    if (verified.transactionStatus !== 'Completed') {
      if (!['Cancelled', 'Failed', 'Expired'].includes(verified.transactionStatus ?? '')) {
        throw new AppError(
          httpStatus.CONFLICT,
          'Payment is not final at the gateway; retry reconciliation',
        );
      }
      await tx.payment.update({
        where: { id: current.id },
        data: { status: PaymentStatus.FAILED },
      });
      await createAuditLog(tx, {
        userId: order.srId,
        action: 'PAYMENT_FAILED',
        entity: 'Order',
        entityId: order.id,
        details: { paymentID, gatewayStatus: verified.transactionStatus },
      });
      return { message: `Payment ${verified.transactionStatus}` };
    }
    if (!verified.trxID || !verified.amount || !/^\d+(\.\d{1,2})?$/.test(verified.amount)) {
      throw new AppError(httpStatus.BAD_GATEWAY, 'Invalid gateway settlement response');
    }
    const amount = new Prisma.Decimal(verified.amount);
    if (!amount.eq(current.amount)) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        'Executed amount does not match the initiated payment amount',
      );
    }
    if (
      order.status === OrderStatus.CANCELLED ||
      amount.gt(order.payableAmount.minus(order.paidAmount))
    ) {
      throw new AppError(
        httpStatus.CONFLICT,
        'Payment requires reconciliation: order cancelled or amount exceeds outstanding balance',
      );
    }
    const claimed = await tx.payment.updateMany({
      where: { id: current.id, status: { not: PaymentStatus.PAID } },
      data: { transactionId: verified.trxID, status: PaymentStatus.PAID },
    });
    if (!claimed.count) return { message: 'Payment already processed' };
    const paidAmount = order.paidAmount.plus(amount);
    const updatedOrder = await tx.order.update({
      where: { id: order.id },
      data: {
        paidAmount,
        paymentMethod: PaymentMethod.BKASH,
        paymentStatus: paidAmount.eq(order.payableAmount)
          ? PaymentStatus.PAID
          : PaymentStatus.PARTIALLY_PAID,
      },
    });
    await tx.retailer.update({
      where: { id: order.retailerId },
      data: { dueBalance: { decrement: amount } },
    });
    await createAuditLog(tx, {
      userId: order.srId,
      action: 'PAYMENT_SUCCESS',
      entity: 'Order',
      entityId: order.id,
      details: { trxID: verified.trxID, amount: amount.toString() },
    });
    return { message: 'Payment completed successfully', order: updatedOrder };
  });
};

/**
 * Reverses a settled payment and puts the money back on the retailer's account.
 *
 * Deliberately its own endpoint rather than a side effect of cancelling an
 * order: moving money back to a customer is a decision someone makes, not
 * something that should happen quietly because a status changed. It is
 * restricted to a super admin or the branch's own manager, and audited.
 */
const refundPayment = async (
  actor: RequestActor,
  paymentId: string,
  reason: string,
  ipAddress?: string | null,
) => {
  if (actor.role !== Role.SUPER_ADMIN && actor.role !== Role.BRANCH_MANAGER) {
    throw new AppError(httpStatus.FORBIDDEN, 'You cannot refund payments');
  }

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { order: { select: { id: true, branchId: true, srId: true, invoiceNo: true } } },
  });
  if (!payment) throw new AppError(httpStatus.NOT_FOUND, 'Payment not found');
  assertOrderAccess(actor, payment.order);

  if (payment.status === PaymentStatus.REFUNDED) {
    throw new AppError(httpStatus.CONFLICT, 'This payment has already been refunded');
  }
  // Only settled money can be returned. bKash identifies the movement by its
  // trxID, which only exists once execute confirmed the payment.
  if (payment.status !== PaymentStatus.PAID || !payment.transactionId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      'Only a settled payment can be refunded; this one never completed',
    );
  }
  if (!payment.gatewayPaymentId) {
    throw new AppError(httpStatus.BAD_REQUEST, 'This payment has no gateway reference to refund');
  }

  // The gateway call happens before the transaction, never inside it: it is a
  // multi-second network round trip, and holding order rows locked across it
  // would turn a slow gateway into database contention. If bKash refuses, this
  // throws and nothing local has changed.
  const gateway = await BkashClient.refundPayment({
    paymentID: payment.gatewayPaymentId,
    trxID: payment.transactionId,
    amount: Number(payment.amount),
    reason,
    sku: payment.order.invoiceNo,
  });

  if (!gateway.refundTrxID) {
    throw new AppError(httpStatus.BAD_GATEWAY, 'bKash did not confirm the refund');
  }

  const refunded = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, payment.orderId);

    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.REFUNDED,
        refundTrxId: gateway.refundTrxID,
        refundAmount: payment.amount,
        refundReason: reason,
        refundedAt: new Date(),
        gatewayResponse: gateway as unknown as Prisma.InputJsonValue,
      },
    });

    // The order owes the money again, so both running totals move back: what
    // the order has been paid, and what the shop owes overall.
    const order = await tx.order.update({
      where: { id: payment.orderId },
      data: {
        paidAmount: { decrement: payment.amount },
        paymentStatus: PaymentStatus.UNPAID,
      },
    });
    await tx.order.update({
      where: { id: payment.orderId },
      data: {
        paymentStatus:
          Number(order.paidAmount) > 0 ? PaymentStatus.PARTIALLY_PAID : PaymentStatus.UNPAID,
      },
    });
    await tx.retailer.update({
      where: { id: order.retailerId },
      data: { dueBalance: { increment: payment.amount } },
    });

    await createAuditLog(tx, {
      userId: actor.userId,
      action: 'PAYMENT_REFUND',
      entity: 'Payment',
      entityId: payment.id,
      details: {
        invoiceNo: payment.order.invoiceNo,
        amount: String(payment.amount),
        refundTrxId: gateway.refundTrxID,
        reason,
      },
      ipAddress,
    });

    return updated;
  });

  return refunded;
};

export const PaymentService = {
  initiatePayment,
  getPaymentById,
  handleCallback,
  refundPayment,
};
