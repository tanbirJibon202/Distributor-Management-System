import type { Prisma } from '../../generated/prisma/client.js';

// Every payment reservation, settlement and order transition takes this lock
// before reading the order. Gateway calls must remain outside the transaction.
export const lockOrder = async (tx: Prisma.TransactionClient, orderId: string) => {
  await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
};
