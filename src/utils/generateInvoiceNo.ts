import { prisma } from './prisma.js';

// INV-YYYYMMDD-XXXX — retried on the rare collision instead of trusting
// randomness alone, since invoiceNo is a hard unique constraint.
export const generateInvoiceNo = async (): Promise<string> => {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  for (let attempt = 0; attempt < 5; attempt++) {
    const randomPart = Math.floor(1000 + Math.random() * 9000);
    const invoiceNo = `INV-${datePart}-${randomPart}`;

    const existing = await prisma.order.findUnique({ where: { invoiceNo } });
    if (!existing) return invoiceNo;
  }

  throw new Error('Failed to generate a unique invoice number, please retry');
};
