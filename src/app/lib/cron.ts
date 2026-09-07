import { OrderStatus, PaymentStatus } from '../../generated/prisma/client.js';
import cron from 'node-cron';
import { prisma } from './prisma.js';

// A reporting default, not a business rule: per-product reorder levels belong
// in the schema if they ever become real. The inventory endpoint takes its
// threshold from the caller instead (?lowStock=).
const LOW_STOCK_THRESHOLD = 10;

// A sample size for the log — the counts above each list are the true totals.
const SAMPLE_SIZE = 20;

// Guards against a slow run overlapping the next tick. Sound here because the
// scheduler is in-process and single-threaded; a multi-instance deployment
// would need a Redis lock so only one instance reports.
let isRunning = false;

const money = (value: number) => `BDT ${value.toFixed(2)}`;

/**
 * Reports orders past their due date and inventory running low.
 *
 * Deliberately read-only. `dueDate` is already a stored fact, so "overdue" is a
 * query rather than a flag to maintain, and writing a derived status back would
 * be one more denormalised field to keep in step. When notifications are added,
 * this is where they hook in.
 */
const reportOverdueAndLowStock = async () => {
  if (isRunning) {
    console.warn('[cron] previous report still running, skipping this tick');
    return;
  }
  isRunning = true;

  try {
    const overdueWhere = {
      dueDate: { lt: new Date() },
      paymentStatus: { not: PaymentStatus.PAID },
      status: { not: OrderStatus.CANCELLED },
    };

    const [overdueCount, overdueSample] = await Promise.all([
      prisma.order.count({ where: overdueWhere }),
      prisma.order.findMany({
        where: overdueWhere,
        select: {
          invoiceNo: true,
          dueDate: true,
          payableAmount: true,
          paidAmount: true,
          branch: { select: { code: true } },
          retailer: { select: { shopName: true } },
        },
        orderBy: { dueDate: 'asc' },
        take: SAMPLE_SIZE,
      }),
    ]);

    if (overdueCount > 0) {
      console.warn(`[cron] ${overdueCount} overdue order(s), oldest first:`);
      for (const order of overdueSample) {
        const outstanding = Number(order.payableAmount) - Number(order.paidAmount);
        console.warn(
          `  ${order.invoiceNo}  ${order.branch.code}  ${order.retailer.shopName}  ` +
            `${money(outstanding)} outstanding, due ${order.dueDate.toISOString().slice(0, 10)}`,
        );
      }
      if (overdueCount > overdueSample.length) {
        console.warn(`  ... and ${overdueCount - overdueSample.length} more`);
      }
    }

    const lowStockWhere = {
      stock: { lte: LOW_STOCK_THRESHOLD },
      product: { deletedAt: null },
      branch: { deletedAt: null },
    };

    const [lowStockCount, lowStockSample] = await Promise.all([
      prisma.branchInventory.count({ where: lowStockWhere }),
      prisma.branchInventory.findMany({
        where: lowStockWhere,
        select: {
          stock: true,
          product: { select: { name: true, sku: true, unit: true } },
          branch: { select: { code: true } },
        },
        orderBy: { stock: 'asc' },
        take: SAMPLE_SIZE,
      }),
    ]);

    if (lowStockCount > 0) {
      console.warn(`[cron] ${lowStockCount} product(s) at or below ${LOW_STOCK_THRESHOLD} units:`);
      for (const row of lowStockSample) {
        console.warn(
          `  ${row.branch.code}  ${row.product.sku}  ${row.product.name}  ` +
            `${row.stock} ${row.product.unit} left`,
        );
      }
      if (lowStockCount > lowStockSample.length) {
        console.warn(`  ... and ${lowStockCount - lowStockSample.length} more`);
      }
    }
  } catch (error) {
    // Swallowed on purpose: a failed report must never take the process down.
    console.error('[cron] overdue / low-stock report failed:', error);
  } finally {
    isRunning = false;
  }
};

/**
 * Registers the schedule. Synchronous — `cron.schedule` only records the job,
 * so there is nothing here to await.
 */
export const startScheduledJobs = () => {
  // Hourly on the hour. Due dates move on a scale of days, so anything more
  // frequent is noise in the logs and load on the database for no gain.
  cron.schedule('0 * * * *', reportOverdueAndLowStock);
  console.log('Scheduled jobs registered: hourly overdue and low-stock report.');
};
