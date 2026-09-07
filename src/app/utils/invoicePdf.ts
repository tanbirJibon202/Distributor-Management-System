import PDFDocument from 'pdfkit';

// Prisma hands money back as Decimal; every call site in this project already
// narrows it with Number(), so the invoice accepts whatever that produces.
type Numeric = number | string | { toString(): string };

type InvoiceItem = {
  quantity: number;
  unitPrice: Numeric;
  subTotal: Numeric;
  product: { name: string; sku: string; unit: string };
};

export type InvoiceOrder = {
  invoiceNo: string;
  createdAt: Date;
  dueDate: Date;
  status: string;
  paymentStatus: string;
  totalAmount: Numeric;
  discount: Numeric;
  payableAmount: Numeric;
  paidAmount: Numeric;
  items: InvoiceItem[];
  retailer: { shopName: string; ownerName: string; phone: string; address: string };
  branch: { name: string; code: string };
  sr: { name: string; email: string };
};

const money = (value: Numeric) =>
  Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const day = (value: Date) =>
  new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

// Column geometry, shared by the header row and every line so they stay aligned.
const COL = { index: 50, name: 78, qty: 300, unit: 355, sub: 440 };
const RIGHT_EDGE = 545;

/**
 * Renders one order as a PDF invoice and resolves to the finished buffer.
 *
 * Deliberately pure and synchronous over its input: it takes a plain object and
 * touches neither the database nor the network, so it can never be the reason a
 * transaction is held open or a request hangs.
 */
export const buildInvoicePdf = (order: InvoiceOrder): Promise<Buffer> => {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // ---- masthead -----------------------------------------------------------
  doc.fontSize(18).font('Helvetica-Bold').text('DMS Distributor', 50, 50);
  doc.fontSize(9).font('Helvetica').fillColor('#555555');
  doc.text(`${order.branch.name} (${order.branch.code})`, 50, 72);
  doc.fillColor('#000000');

  doc.fontSize(16).font('Helvetica-Bold').text('INVOICE', 0, 50, { align: 'right' });
  doc.fontSize(10).font('Helvetica').text(order.invoiceNo, 0, 72, { align: 'right' });

  doc.moveTo(50, 100).lineTo(RIGHT_EDGE, 100).strokeColor('#cccccc').stroke();

  // ---- parties ------------------------------------------------------------
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#777777').text('BILL TO', 50, 115);
  doc
    .fillColor('#000000')
    .fontSize(11)
    .font('Helvetica-Bold')
    .text(order.retailer.shopName, 50, 128);
  doc.fontSize(9).font('Helvetica');
  doc.text(order.retailer.ownerName, 50, 144);
  doc.text(order.retailer.phone, 50, 157);
  doc.text(order.retailer.address, 50, 170, { width: 220 });

  const metaX = 330;
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#777777').text('DETAILS', metaX, 115);
  doc.fillColor('#000000').fontSize(9).font('Helvetica');
  const meta: [string, string][] = [
    ['Order date', day(order.createdAt)],
    ['Payment due', day(order.dueDate)],
    ['Sales rep', order.sr.name],
    ['Status', `${order.status} / ${order.paymentStatus}`],
  ];
  meta.forEach(([label, value], i) => {
    const y = 128 + i * 14;
    doc.fillColor('#777777').text(label, metaX, y);
    doc.fillColor('#000000').text(value, metaX + 80, y, { width: 135 });
  });

  // ---- line items ---------------------------------------------------------
  let y = 215;
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#777777');
  doc.text('#', COL.index, y);
  doc.text('ITEM', COL.name, y);
  doc.text('QTY', COL.qty, y, { width: 45, align: 'right' });
  doc.text('UNIT PRICE', COL.unit, y, { width: 75, align: 'right' });
  doc.text('SUBTOTAL', COL.sub, y, { width: 105, align: 'right' });
  doc.fillColor('#000000');

  y += 13;
  doc.moveTo(50, y).lineTo(RIGHT_EDGE, y).strokeColor('#000000').stroke();
  y += 10;

  doc.fontSize(9).font('Helvetica');
  order.items.forEach((item, i) => {
    // A long catalogue runs past one page; start a fresh one before the
    // footer margin rather than letting pdfkit silently overflow.
    if (y > 690) {
      doc.addPage();
      y = 60;
    }

    doc.text(String(i + 1), COL.index, y);
    doc.text(item.product.name, COL.name, y, { width: 215 });
    doc
      .fontSize(7)
      .fillColor('#888888')
      .text(item.product.sku, COL.name, y + 11, { width: 215 });
    doc.fontSize(9).fillColor('#000000');
    doc.text(`${item.quantity} ${item.product.unit}`, COL.qty, y, { width: 45, align: 'right' });
    doc.text(money(item.unitPrice), COL.unit, y, { width: 75, align: 'right' });
    doc.text(money(item.subTotal), COL.sub, y, { width: 105, align: 'right' });

    y += 26;
  });

  doc.moveTo(50, y).lineTo(RIGHT_EDGE, y).strokeColor('#cccccc').stroke();
  y += 12;

  // ---- totals -------------------------------------------------------------
  const due = Number(order.payableAmount) - Number(order.paidAmount);
  const totals: [string, string, boolean][] = [
    ['Total', money(order.totalAmount), false],
    ['Discount', `- ${money(order.discount)}`, false],
    ['Payable', money(order.payableAmount), true],
    ['Paid', money(order.paidAmount), false],
    ['Balance due', money(due), true],
  ];

  for (const [label, value, bold] of totals) {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 9);
    doc.text(label, COL.unit - 60, y, { width: 135, align: 'right' });
    doc.text(`BDT ${value}`, COL.sub, y, { width: 105, align: 'right' });
    y += bold ? 17 : 15;
  }

  // ---- footer -------------------------------------------------------------
  doc.fontSize(8).font('Helvetica').fillColor('#888888');
  doc.text(
    `Payment due by ${day(order.dueDate)}. Please quote invoice ${order.invoiceNo} on any payment.`,
    50,
    y + 18,
    { width: RIGHT_EDGE - 50 },
  );

  doc.end();
  return finished;
};
