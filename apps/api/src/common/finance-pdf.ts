import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';

const INK = '#0a0c0f';
const MUTED = '#5a6470';
const GOLD = '#b8966e';

interface Header { issuer: string; address: string; email: string; phone: string; registration: string; headerText: string; footerText: string; logoPath?: string; showLogo: boolean }

function begin(title: string, h: Header) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: title, Author: h.issuer } });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  let y = 50;
  if (h.showLogo && h.logoPath && existsSync(h.logoPath)) {
    try { doc.image(h.logoPath, 50, 44, { fit: [110, 56] }); y = 108; } catch { /* text fallback below */ }
  }
  if (y === 50) { doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(h.issuer.toUpperCase(), 50, 50, { characterSpacing: 1.5 }); y = 68; }
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
  const lines = [h.address, [h.email, h.phone].filter(Boolean).join('  |  '), h.registration ? `Reg. ${h.registration}` : '', h.headerText].filter(Boolean);
  for (const l of lines) { doc.text(l, 50, y, { width: 300 }); y = doc.y + 1; }
  return { doc, done, y: y + 12 };
}

function money(n: number, cur: string) { return `${cur} ${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function date(iso: string | null) { return iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : ''; }

export interface InvoiceView {
  header: Header; number: string; status: string; issueDate: string; dueDate: string | null; billTo: string; billToDetail: string;
  purchaseOrder: string | null; currency: string; items: { description: string; quantity: number; unit_price: number }[];
  subtotal: number; taxRate: number; tax: number; total: number; paid: number; instructions: string[]; notes: string | null;
}

export async function renderInvoice(v: InvoiceView): Promise<Buffer> {
  const { doc, done, y: y0 } = begin(`Invoice ${v.number}`, v.header);
  doc.font('Helvetica-Bold').fontSize(22).fillColor(INK).text('INVOICE', 380, 50, { width: 165, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(v.number, 380, 78, { width: 165, align: 'right' }).text(v.status.replace('_', ' ').toUpperCase(), 380, 92, { width: 165, align: 'right', characterSpacing: 1 });
  let y = Math.max(y0, 120);
  doc.moveTo(50, y).lineTo(545, y).lineWidth(1.2).strokeColor(GOLD).stroke();
  y += 14;
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('BILL TO', 50, y, { characterSpacing: 1 }).text('DATES', 380, y, { characterSpacing: 1 });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(v.billTo, 50, y + 12, { width: 300 });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(v.billToDetail, 50, doc.y, { width: 300 });
  doc.font('Helvetica').fontSize(9).fillColor(INK).text(`Issued ${date(v.issueDate)}`, 380, y + 12).text(v.dueDate ? `Due ${date(v.dueDate)}` : '', 380, y + 25);
  if (v.purchaseOrder) doc.text(`PO ${v.purchaseOrder}`, 380, y + 38);
  y = Math.max(doc.y, y + 60) + 14;

  doc.rect(50, y, 495, 20).fill('#f1eee8');
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text('DESCRIPTION', 58, y + 6).text('QTY', 360, y + 6, { width: 40, align: 'right' }).text('UNIT PRICE', 400, y + 6, { width: 70, align: 'right' }).text('AMOUNT', 470, y + 6, { width: 67, align: 'right' });
  y += 26;
  doc.font('Helvetica').fontSize(10).fillColor(INK);
  for (const it of v.items) {
    doc.text(it.description, 58, y, { width: 290 });
    const rowH = Math.max(doc.y - y, 14);
    doc.text(String(it.quantity), 360, y, { width: 40, align: 'right' }).text(money(it.unit_price, v.currency), 400, y, { width: 70, align: 'right' }).text(money(it.quantity * it.unit_price, v.currency), 470, y, { width: 67, align: 'right' });
    y += rowH + 6;
    doc.moveTo(50, y - 2).lineTo(545, y - 2).lineWidth(0.4).strokeColor('#e3ded4').stroke();
  }
  y += 8;
  const row = (label: string, value: string, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 10).fillColor(INK).text(label, 340, y, { width: 120, align: 'right' }).text(value, 460, y, { width: 77, align: 'right' });
    y += bold ? 20 : 16;
  };
  row('Subtotal', money(v.subtotal, v.currency));
  if (v.taxRate > 0) row(`Tax (${v.taxRate}%)`, money(v.tax, v.currency));
  row('Total', money(v.total, v.currency), true);
  if (v.paid > 0) { row('Paid', money(v.paid, v.currency)); row('Balance due', money(Math.max(v.total - v.paid, 0), v.currency), true); }

  if (v.instructions.length) {
    y += 14;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('HOW TO PAY', 50, y, { characterSpacing: 1 });
    doc.font('Helvetica').fontSize(9).fillColor(INK);
    y = doc.y + 4;
    for (const l of v.instructions) { doc.text(l, 50, y, { width: 495 }); y = doc.y + 3; }
  }
  if (v.notes) { y += 8; doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(v.notes, 50, y, { width: 495 }); }
  if (v.header.footerText) doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(v.header.footerText, 50, 780, { width: 495, align: 'center' });
  doc.end();
  return done;
}

export interface ReceiptView {
  header: Header; receiptNumber: string; invoiceNumber: string; receivedAt: string; payer: string; method: string; reference: string | null;
  currency: string; amount: number; invoiceTotal: number; balance: number; status: string;
}

export async function renderReceipt(v: ReceiptView): Promise<Buffer> {
  const { doc, done, y: y0 } = begin(`Receipt ${v.receiptNumber}`, v.header);
  doc.font('Helvetica-Bold').fontSize(22).fillColor(INK).text('RECEIPT', 380, 50, { width: 165, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(v.receiptNumber, 380, 78, { width: 165, align: 'right' });
  let y = Math.max(y0, 120);
  doc.moveTo(50, y).lineTo(545, y).lineWidth(1.2).strokeColor(GOLD).stroke();
  y += 20;
  const kv = (k: string, val: string) => { doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(k.toUpperCase(), 50, y, { characterSpacing: 1 }); doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(val, 200, y - 2, { width: 340 }); y += 24; };
  kv('Received from', v.payer); kv('Date', date(v.receivedAt)); kv('Against invoice', v.invoiceNumber);
  kv('Payment method', v.method.replace('_', ' ')); if (v.reference) kv('Reference', v.reference);
  y += 6;
  doc.rect(50, y, 495, 44).fill('#f5efe6');
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('AMOUNT RECEIVED', 64, y + 8, { characterSpacing: 1 });
  doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text(money(v.amount, v.currency), 64, y + 20);
  y += 62;
  doc.font('Helvetica').fontSize(10).fillColor(INK).text(`Invoice total ${money(v.invoiceTotal, v.currency)}   |   Balance after this payment ${money(Math.max(v.balance, 0), v.currency)}`, 50, y);
  if (v.status !== 'paid') doc.font('Helvetica-Bold').fontSize(11).fillColor('#9b2c2c').text(`This payment is ${v.status.toUpperCase()}.`, 50, y + 24);
  if (v.header.footerText) doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(v.header.footerText, 50, 780, { width: 495, align: 'center' });
  doc.end();
  return done;
}
