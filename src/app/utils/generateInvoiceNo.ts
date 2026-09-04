import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

type QueryClient = typeof prisma | Prisma.TransactionClient;

// INV-YYYYMMDD-XXXX — retried on the rare collision instead of trusting
// randomness alone, since invoiceNo is a hard unique constraint. Accepts a
// transaction client so the check runs against the same transaction that
// will insert the order, not a separate connection.
export const generateInvoiceNo = async (client: QueryClient = prisma): Promise<string> => {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  for (let attempt = 0; attempt < 5; attempt++) {
    const randomPart = Math.floor(1000 + Math.random() * 9000);
    const invoiceNo = `INV-${datePart}-${randomPart}`;

    const existing = await client.order.findUnique({ where: { invoiceNo } });
    if (!existing) return invoiceNo;
  }

  throw new Error('Failed to generate a unique invoice number, please retry');
};
