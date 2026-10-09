import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { existsSync } from 'node:fs';

export interface CertificateView {
  heading: string;
  holder: string;
  courseTitle: string;
  courseCode: string;
  trainingDates: string;
  trainingHours: number;
  number: string;
  issuedAt: string;
  expiresAt: string | null;
  signatoryName: string | null;
  signatoryTitle: string | null;
  footerText: string | null;
  accent: string;
  issuer: string;
  verifyUrl: string;
  logoPath?: string;
}

const INK = '#0a0c0f';
const MUTED = '#5a6470';

/** Printed output is always the day theme on white. Built-in PDF fonts keep the file small and dependency-free. */
export async function renderCertificate(v: CertificateView): Promise<Buffer> {
  const qr = await QRCode.toBuffer(v.verifyUrl, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: `Certificate ${v.number}`, Author: v.issuer } });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const W = doc.page.width;
  const H = doc.page.height;
  // frame
  doc.lineWidth(2).strokeColor(v.accent).rect(24, 24, W - 48, H - 48).stroke();
  doc.lineWidth(0.5).strokeColor(v.accent).rect(32, 32, W - 64, H - 64).stroke();

  // brand
  if (v.logoPath && existsSync(v.logoPath)) {
    try { doc.image(v.logoPath, W / 2 - 60, 48, { fit: [120, 70], align: 'center' }); } catch { /* fall back to text */ }
  } else {
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(v.issuer.toUpperCase(), 0, 62, { align: 'center', characterSpacing: 2.5, width: W });
  }

  doc.font('Times-Roman').fontSize(34).fillColor(INK).text(v.heading, 0, 132, { align: 'center', width: W });
  doc.moveTo(W / 2 - 40, 178).lineTo(W / 2 + 40, 178).lineWidth(1.5).strokeColor(v.accent).stroke();

  doc.font('Helvetica').fontSize(11).fillColor(MUTED).text('THIS IS TO CERTIFY THAT', 0, 196, { align: 'center', width: W, characterSpacing: 2 });
  doc.font('Times-Italic').fontSize(36).fillColor(INK).text(v.holder, 60, 218, { align: 'center', width: W - 120 });
  doc.font('Helvetica').fontSize(11).fillColor(MUTED).text('HAS SUCCESSFULLY COMPLETED', 0, 274, { align: 'center', width: W, characterSpacing: 2 });
  doc.font('Times-Bold').fontSize(22).fillColor(INK).text(v.courseTitle, 70, 296, { align: 'center', width: W - 140 });
  doc.font('Helvetica').fontSize(10).fillColor(MUTED)
    .text(`${v.courseCode}   |   ${v.trainingDates}   |   ${v.trainingHours} training hours`, 0, 336, { align: 'center', width: W });

  // details, bottom left
  const y = H - 150;
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('CERTIFICATE NUMBER', 70, y, { characterSpacing: 1 });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(v.number, 70, y + 12);
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('ISSUED', 70, y + 36, { characterSpacing: 1 });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(v.issuedAt, 70, y + 48);
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('VALID UNTIL', 190, y + 36, { characterSpacing: 1 });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(v.expiresAt ?? 'No expiry', 190, y + 48);

  // signature, centre
  doc.moveTo(W / 2 - 110, y + 40).lineTo(W / 2 + 110, y + 40).lineWidth(0.8).strokeColor(INK).stroke();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(v.signatoryName ?? '', W / 2 - 110, y + 46, { width: 220, align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(v.signatoryTitle ?? 'Authorised Signatory', W / 2 - 110, y + 60, { width: 220, align: 'center' });

  // verification, bottom right
  doc.image(qr, W - 160, y - 4, { width: 84 });
  doc.font('Helvetica').fontSize(7).fillColor(MUTED).text('Scan to verify this certificate', W - 190, y + 84, { width: 144, align: 'center' });

  if (v.footerText) doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(v.footerText, 60, H - 56, { width: W - 120, align: 'center' });
  doc.end();
  return done;
}
