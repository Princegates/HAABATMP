import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

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
  /** Course category, e.g. "Safety Management Systems". */
  category?: string | null;
  programmeCode?: string | null;
  location?: string | null;
  /** Set only when the programme was run for one client organisation. */
  partner?: string | null;
  modules?: string[];
  moreModules?: number;
  passMark?: number | null;
  minAttendance?: number | null;
}

/** The Barlow subset has no accented or composite glyphs, so sans-serif text is reduced to plain Latin. */
const plain = (t: string | null | undefined) => (t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim();

const NAVY = '#0f2747';
const NAVY_2 = '#1b3f73';
const GREEN = '#2b7a4b';
const TEXT = '#1d2530';
const MUTED = '#5a6470';

type Fonts = { serifB: string; serifBI: string; serifI: string; sans: string; sansM: string; sansB: string };

/** Cormorant Garamond and Barlow match the HAAB site. If the font packages are missing the built-in PDF fonts are used. */
function registerFonts(doc: PDFKit.PDFDocument): Fonts {
  const fallback: Fonts = { serifB: 'Times-Bold', serifBI: 'Times-BoldItalic', serifI: 'Times-Italic', sans: 'Helvetica', sansM: 'Helvetica', sansB: 'Helvetica-Bold' };
  try {
    const dir = (pkg: string) => path.join(path.dirname(require.resolve(`@fontsource/${pkg}/package.json`)), 'files');
    const cg = dir('cormorant-garamond');
    const bl = dir('barlow');
    const files: Record<string, string> = {
      'CG-B': path.join(cg, 'cormorant-garamond-latin-700-normal.woff'),
      'CG-BI': path.join(cg, 'cormorant-garamond-latin-700-italic.woff'),
      'CG-I': path.join(cg, 'cormorant-garamond-latin-600-italic.woff'),
      'BL-R': path.join(bl, 'barlow-latin-400-normal.woff'),
      'BL-M': path.join(bl, 'barlow-latin-500-normal.woff'),
      'BL-S': path.join(bl, 'barlow-latin-600-normal.woff'),
    };
    if (!Object.values(files).every(existsSync)) return fallback;
    for (const [name, file] of Object.entries(files)) doc.registerFont(name, file);
    return { serifB: 'CG-B', serifBI: 'CG-BI', serifI: 'CG-I', sans: 'BL-R', sansM: 'BL-M', sansB: 'BL-S' };
  } catch {
    return fallback;
  }
}

/** Printed output is always the light theme on white, A4 landscape, one page. */
export async function renderCertificate(v: CertificateView): Promise<Buffer> {
  const qr = await QRCode.toBuffer(v.verifyUrl, { margin: 1, width: 300, errorCorrectionLevel: 'M' });
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: `Certificate ${v.number}`, Author: v.issuer } });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const f = registerFonts(doc);
  const logo = v.logoPath && existsSync(v.logoPath) ? v.logoPath : null;

  const W = doc.page.width;
  const H = doc.page.height;
  const cx = W / 2;
  const L = 14, R = W - 14, T = 14, B = H - 14;

  /** Shrinks the font until the text fits, so long names and titles never overflow. */
  const fit = (text: string, font: string, size: number, max: number, min = 12, opts: PDFKit.Mixins.TextOptions = {}) => {
    let s = size;
    doc.font(font);
    while (s > min && doc.fontSize(s).widthOfString(text, opts) > max) s -= 1;
    return s;
  };
  const centred = (text: string, y: number, font: string, size: number, color: string, opts: PDFKit.Mixins.TextOptions = {}, x = 0, w = W) => {
    doc.font(font).fontSize(size).fillColor(color).text(text, x, y, { width: w, align: 'center', lineBreak: false, ...opts });
  };

  // page border: navy outer, thin accent inner
  doc.lineWidth(3).strokeColor(NAVY).rect(L, T, R - L, B - T).stroke();
  doc.lineWidth(0.6).strokeColor(v.accent).rect(L + 6, T + 6, R - L - 12, B - T - 12).stroke();

  // watermark
  if (logo) {
    try { doc.save().opacity(0.035).image(logo, cx - 150, 190, { fit: [300, 200], align: 'center' }).restore(); } catch { /* optional */ }
  }

  // header band
  const bandTop = T + 6, bandH = 100;
  const grad = doc.linearGradient(L + 6, bandTop, R - 6, bandTop);
  grad.stop(0, NAVY).stop(1, NAVY_2);
  doc.rect(L + 6, bandTop, R - L - 12, bandH).fill(grad);
  doc.lineWidth(1.5).strokeColor(v.accent).moveTo(L + 6, bandTop + bandH).lineTo(R - 6, bandTop + bandH).stroke();

  // logos on white plates, both sides
  const plateW = 116, plateH = 70, plateY = bandTop + (bandH - plateH) / 2;
  for (const x of [L + 22, R - 22 - plateW]) {
    doc.roundedRect(x, plateY, plateW, plateH, 5).fill('#ffffff');
    if (logo) {
      try { doc.image(logo, x + 8, plateY + 6, { fit: [plateW - 16, plateH - 12], align: 'center', valign: 'center' }); } catch { /* plate stays blank */ }
    } else {
      doc.font(f.sansB).fontSize(14).fillColor(NAVY).text('HAAB', x, plateY + plateH / 2 - 8, { width: plateW, align: 'center', lineBreak: false });
    }
  }

  // issuer and sub-lines
  const midX = L + 22 + plateW + 14, midW = R - 22 - plateW - 14 - midX;
  const issuerText = plain(v.issuer).toUpperCase();
  const issuerSize = fit(issuerText, f.sansB, 17, midW, 11, { characterSpacing: 2.6 });
  centred(issuerText, bandTop + 14, f.sansB, issuerSize, '#ffffff', { characterSpacing: 2.6 }, midX, midW);
  let y = bandTop + 14 + issuerSize + 8;
  if (v.partner) {
    const t = `IN PARTNERSHIP WITH  |  ${plain(v.partner).toUpperCase()}`;
    centred(t, y, f.sansM, fit(t, f.sansM, 10.5, midW, 8, { characterSpacing: 2 }), '#e3c9a1', { characterSpacing: 2 }, midX, midW);
    y += 17;
  }
  const sub1 = [plain(v.category), plain(v.programmeCode)].filter(Boolean).join('  |  ').toUpperCase();
  const sub2 = [plain(v.courseCode), plain(v.trainingDates), plain(v.location)].filter(Boolean).join('  |  ').toUpperCase();
  for (const t of [sub1, sub2]) {
    if (!t) continue;
    centred(t, y, f.sans, fit(t, f.sans, 9.5, midW, 7, { characterSpacing: 1.4 }), '#c9d4e6', { characterSpacing: 1.4 }, midX, midW);
    y += 14;
  }

  // title
  centred(v.heading, bandTop + bandH + 14, f.serifB, fit(v.heading, f.serifB, 38, W - 160, 24), NAVY);
  doc.lineWidth(1.5).strokeColor(v.accent).moveTo(cx - 45, 179).lineTo(cx + 45, 179).stroke();

  centred('This is to certify that', 187, f.serifI, 15, MUTED);
  const nameSize = fit(v.holder, f.serifBI, 36, W - 200, 20);
  centred(v.holder, 205, f.serifBI, nameSize, NAVY);
  const nameW = Math.min(doc.font(f.serifBI).fontSize(nameSize).widthOfString(v.holder) + 60, W - 160);
  doc.lineWidth(0.8).strokeColor(NAVY).moveTo(cx - nameW / 2, 205 + nameSize + 6).lineTo(cx + nameW / 2, 205 + nameSize + 6).stroke();

  const afterName = 205 + nameSize + 14;
  centred('has successfully completed', afterName, f.serifI, 14, MUTED);

  // course banner
  const bannerY = afterName + 22, bannerH = 34, bannerX = 80;
  doc.rect(bannerX, bannerY, W - 2 * bannerX, bannerH).fill(NAVY);
  const cs = fit(v.courseTitle, f.serifB, 21, W - 2 * bannerX - 40, 12);
  centred(v.courseTitle, bannerY + (bannerH - cs) / 2 - 1, f.serifB, cs, '#ffffff', {}, bannerX, W - 2 * bannerX);

  // content list
  y = bannerY + bannerH + 14;
  const mods = (v.modules ?? []).map(plain);
  if (mods.length) {
    centred('COMPRISING THE FOLLOWING PROGRAMME CONTENT', y, f.sansB, 9.5, GREEN, { characterSpacing: 2 });
    y += 18;
    const colW = 330, gap = 24, left = cx - colW - gap / 2, right = cx + gap / 2;
    const rows = Math.ceil(mods.length / 2);
    mods.forEach((m, i) => {
      const col = i < rows ? 0 : 1;
      const x = col ? right : left;
      const ry = y + (col ? i - rows : i) * 15;
      doc.lineWidth(1.4).strokeColor(GREEN).moveTo(x, ry + 5).lineTo(x + 3, ry + 8).lineTo(x + 8.5, ry + 1.5).stroke();
      doc.font(f.sans).fontSize(fit(m, f.sans, 10, colW - 16, 8)).fillColor(TEXT).text(m, x + 15, ry, { width: colW - 16, lineBreak: false });
    });
    y += rows * 15;
    if (v.moreModules && v.moreModules > 0) {
      centred(`and ${v.moreModules} more topic${v.moreModules === 1 ? '' : 's'}`, y, f.serifI, 10.5, MUTED);
      y += 14;
    }
  } else {
    centred('PROGRAMME DETAILS', y, f.sansB, 9.5, GREEN, { characterSpacing: 2 });
    y += 18;
    const facts = [`${v.trainingHours} training hours`, v.passMark != null ? `Pass mark ${v.passMark}%` : '', v.minAttendance != null ? `Attendance ${v.minAttendance}% minimum` : ''].filter(Boolean).join('     |     ');
    centred(facts, y, f.sans, 10.5, TEXT);
    y += 16;
  }

  // footnote
  const foot = [
    `Awarded on satisfactory completion of ${v.programmeCode ? `programme ${v.programmeCode}` : 'the programme'}`
      + `${v.passMark != null ? `, pass mark ${v.passMark}%` : ''}${v.minAttendance != null ? `, minimum attendance ${v.minAttendance}%` : ''}, ${v.trainingHours} training hours.`,
    v.footerText,
  ].filter(Boolean).join(' ');
  doc.font(f.serifI).fontSize(9.5).fillColor(MUTED).text(foot, 90, y + 4, { width: W - 180, align: 'center' });

  // footer
  const footTop = B - 6 - 28 - 108;
  doc.lineWidth(0.6).strokeColor('#c8ced6').moveTo(L + 30, footTop).lineTo(R - 30, footTop).stroke();
  const lab = (t: string, x: number, yy: number, w: number, align: 'left' | 'center' | 'right' = 'left') =>
    doc.font(f.sansB).fontSize(8).fillColor(MUTED).text(t, x, yy, { width: w, align, characterSpacing: 1.6, lineBreak: false });
  const val = (t: string, x: number, yy: number, w: number, align: 'left' | 'center' | 'right' = 'left', size = 12) =>
    doc.font(f.sansM).fontSize(size).fillColor(NAVY).text(t, x, yy, { width: w, align, lineBreak: false });

  const lx = L + 40;
  lab('DATE OF ISSUE', lx, footTop + 14, 200);
  val(plain(v.issuedAt), lx, footTop + 27, 200);
  lab(v.expiresAt ? 'VALID UNTIL' : 'VALIDITY', lx, footTop + 56, 200);
  val(plain(v.expiresAt) || 'No expiry', lx, footTop + 69, 200);

  doc.lineWidth(0.9).strokeColor(NAVY).moveTo(cx - 120, footTop + 62).lineTo(cx + 120, footTop + 62).stroke();
  lab('AUTHORISED BY', cx - 120, footTop + 14, 240, 'center');
  val(plain(v.signatoryName), cx - 140, footTop + 68, 280, 'center', 12);
  doc.font(f.sans).fontSize(9.5).fillColor(MUTED).text(plain(v.signatoryTitle) || 'Authorised Signatory', cx - 140, footTop + 84, { width: 280, align: 'center', lineBreak: false });

  const qrSize = 66, rx = R - 40;
  doc.image(qr, rx - qrSize, footTop + 12, { width: qrSize });
  lab('CERTIFICATE NO.', rx - 200, footTop + 22, 126, 'right');
  val(plain(v.number), rx - 230, footTop + 36, 156, 'right', 12);
  doc.font(f.sans).fontSize(8).fillColor(MUTED).text('Scan the code to verify', rx - 230, footTop + 56, { width: 156, align: 'right', lineBreak: false });

  // bottom strip
  const stripH = 28, stripY = B - 6 - stripH;
  doc.rect(L + 6, stripY, R - L - 12, stripH).fill(NAVY);
  const strip = plain(v.issuer).toUpperCase();
  centred(strip, stripY + 10, f.sansM, fit(strip, f.sansM, 8.5, W - 80, 6, { characterSpacing: 1.8 }), '#c9d4e6', { characterSpacing: 1.8 });

  doc.end();
  return done;
}
