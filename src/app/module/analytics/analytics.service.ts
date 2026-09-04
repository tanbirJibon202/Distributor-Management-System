import { OrderStatus, PaymentStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

const LOW_STOCK_THRESHOLD = 20;

const getDashboardStats = async () => {
  const [
    totalUsers,
    totalBranches,
    totalProducts,
    totalRetailers,
    totalOrders,
    ordersByStatus,
    revenue,
    outstandingDue,
    lowStockCount,
    recentOrders,
  ] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.branch.count({ where: { deletedAt: null } }),
    prisma.product.count({ where: { deletedAt: null } }),
    prisma.retailer.count({ where: { deletedAt: null } }),
    prisma.order.count(),
    prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
    // Collected revenue is the sum of what was actually paid, not what was
    // invoiced — orders sit on credit until a payment executes.
    prisma.order.aggregate({ _sum: { paidAmount: true } }),
    prisma.retailer.aggregate({ where: { deletedAt: null }, _sum: { dueBalance: true } }),
    prisma.branchInventory.count({ where: { stock: { lte: LOW_STOCK_THRESHOLD } } }),
    prisma.order.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        invoiceNo: true,
        payableAmount: true,
        status: true,
        paymentStatus: true,
        createdAt: true,
        retailer: { select: { id: true, shopName: true } },
      },
    }),
  ]);

  const statusCounts = Object.fromEntries(
    Object.values(OrderStatus).map((status) => [
      status,
      ordersByStatus.find((row) => row.status === status)?._count._all ?? 0,
    ]),
  );

  const unpaidOrders = await prisma.order.count({
    where: { paymentStatus: { in: [PaymentStatus.UNPAID, PaymentStatus.PARTIALLY_PAID] } },
  });

  return {
    totals: {
      users: totalUsers,
      branches: totalBranches,
      products: totalProducts,
      retailers: totalRetailers,
      orders: totalOrders,
    },
    orders: {
      byStatus: statusCounts,
      unpaid: unpaidOrders,
    },
    money: {
      collectedRevenue: revenue._sum.paidAmount ?? 0,
      outstandingDue: outstandingDue._sum.dueBalance ?? 0,
    },
    inventory: {
      lowStockThreshold: LOW_STOCK_THRESHOLD,
      lowStockItems: lowStockCount,
    },
    recentOrders,
  };
};

export const AnalyticsService = { getDashboardStats };
