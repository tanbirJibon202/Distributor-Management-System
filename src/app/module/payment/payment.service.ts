import { PaymentMethod, PaymentStatus } from '@prisma/client';
import httpStatus from 'http-status';
import { BkashClient } from '../../lib/bkash.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { createAuditLog } from '../audit/audit.service.js';

const initiatePayment = async (actorId: string, orderId: string) => {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new AppError(httpStatus.NOT_FOUND, 'Order not found');
  }
  if (order.paymentStatus === PaymentStatus.PAID) {
    throw new AppError(httpStatus.BAD_REQUEST, 'This order is already fully paid');
  }

  const remainingAmount = Number(order.payableAmount) - Number(order.paidAmount);
  if (remainingAmount <= 0) {
    throw new AppError(httpStatus.BAD_REQUEST, 'There is no outstanding amount on this order');
  }

  const bkashPayment = await BkashClient.createPayment({
    amount: remainingAmount,
    merchantInvoiceNumber: order.invoiceNo,
  });

  await prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        orderId: order.id,
        gatewayPaymentId: bkashPayment.paymentID,
        amount: remainingAmount,
        provider: PaymentMethod.BKASH,
        status: PaymentStatus.UNPAID,
      },
    });

    await createAuditLog(tx, {
      userId: actorId,
      action: 'PAYMENT_INITIATE',
      entity: 'Order',
      entityId: order.id,
      details: { paymentID: bkashPayment.paymentID, amount: remainingAmount },
    });
  });

  return { bkashURL: bkashPayment.bkashURL };
};

const getPaymentById = async (id: string) => {
  const payment = await prisma.payment.findUnique({
    where: { id },
    include: {
      order: {
        select: {
          id: true,
          invoiceNo: true,
          payableAmount: true,
          paidAmount: true,
          paymentStatus: true,
          status: true,
        },
      },
    },
  });
  if (!payment) {
    throw new AppError(httpStatus.NOT_FOUND, 'Payment not found');
  }
  return payment;
};

const handleCallback = async (paymentID: string, status: string) => {
  const payment = await prisma.payment.findFirst({
    where: { gatewayPaymentId: paymentID },
    include: { order: true },
  });
  if (!payment) {
    throw new AppError(httpStatus.NOT_FOUND, 'Payment not found for this paymentID');
  }

  // Idempotency guard — bKash can fire the callback more than once, and the
  // order may already have been settled by an earlier callback.
  if (payment.status === PaymentStatus.PAID) {
    return { message: 'Payment already processed' };
  }

  if (status !== 'success') {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.FAILED },
    });
    return { message: `Payment ${status}` };
  }

  // The callback alone is never trusted — bKash has no signed webhook, so
  // the server-side execute call is the only way to confirm a real payment.
  const executed = await BkashClient.executePayment(paymentID);

  if (executed.transactionStatus !== 'Completed' || !executed.trxID) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.FAILED },
    });
    throw new AppError(httpStatus.BAD_REQUEST, 'bKash did not confirm this payment as completed');
  }

  const executedAmount = Number(executed.amount);
  if (executedAmount !== Number(payment.amount)) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.FAILED },
    });
    throw new AppError(
      httpStatus.BAD_REQUEST,
      'Executed amount does not match the initiated payment amount',
    );
  }

  const order = payment.order;
  const newPaidAmount = Number(order.paidAmount) + executedAmount;
  const newPaymentStatus =
    newPaidAmount >= Number(order.payableAmount)
      ? PaymentStatus.PAID
      : PaymentStatus.PARTIALLY_PAID;

  const result = await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: { transactionId: executed.trxID, status: PaymentStatus.PAID },
    });

    const updatedOrder = await tx.order.update({
      where: { id: order.id },
      data: {
        paidAmount: newPaidAmount,
        paymentStatus: newPaymentStatus,
        paymentMethod: PaymentMethod.BKASH,
      },
    });

    await tx.retailer.update({
      where: { id: order.retailerId },
      data: { dueBalance: { decrement: executedAmount } },
    });

    await createAuditLog(tx, {
      userId: order.srId,
      action: 'PAYMENT_SUCCESS',
      entity: 'Order',
      entityId: order.id,
      details: { trxID: executed.trxID, amount: executedAmount },
    });

    return updatedOrder;
  });

  return { message: 'Payment completed successfully', order: result };
};

export const PaymentService = { initiatePayment, getPaymentById, handleCallback };
