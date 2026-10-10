import ExcelJS from 'exceljs';
import { z } from 'zod';

/**
 * Reads a list of trainees from an Excel (.xlsx) or CSV file. Columns are found by their headings, in any order:
 * Full name, Email, Phone, Job role, Employer. Only Full name and Email are required.
 */
export interface SheetRow {
  row: number;          // the row number in the file, so a problem can be pointed to
  email: string;
  full_name: string;
  phone: string | null;
  aviation_role: string | null;
  employer: string | null;
  problems: string[];
}

const HEADINGS: Record<string, string[]> = {
  email: ['email', 'e-mail', 'email address', 'mail'],
  full_name: ['full name', 'fullname', 'name', 'trainee', 'trainee name', 'participant', 'surname and first name'],
  phone: ['phone', 'phone number', 'mobile', 'telephone', 'tel', 'contact'],
  aviation_role: ['job role', 'role', 'job title', 'position', 'designation', 'aviation role', 'rank'],
  employer: ['employer', 'company', 'organisation', 'organization', 'airline', 'airport', 'department'],
};
const MAX_ROWS = 500;
const emailOk = z.string().email().max(200);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z\s-]/g, '').replace(/\s+/g, ' ').trim();
const cellText = (v: ExcelJS.Cell): string => {
  const raw: any = v.value;
  if (raw == null) return '';
  if (typeof raw === 'object') {
    if ('text' in raw && raw.text != null) return String(typeof raw.text === 'object' ? (raw.text as any).richText?.map((r: any) => r.text).join('') ?? '' : raw.text).trim(); // hyperlink (an email typed in Excel)
    if ('result' in raw) return String(raw.result ?? '').trim();
    if ('richText' in raw) return raw.richText.map((r: any) => r.text).join('').trim();
    if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  }
  return String(raw).trim();
};

export async function readTraineeSheet(file: Buffer, filename: string): Promise<SheetRow[]> {
  const wb = new ExcelJS.Workbook();
  try {
    if (/\.csv$/i.test(filename)) {
      const { Readable } = await import('node:stream');
      await wb.csv.read(Readable.from(file));
    } else {
      if (file.length < 4 || file[0] !== 0x50 || file[1] !== 0x4b) throw new Error('not xlsx');
      await wb.xlsx.load(file as any);
    }
  } catch {
    throw new Error('This file could not be read. Save it as an Excel Workbook (.xlsx) or a CSV file and try again. Old .xls files are not supported.');
  }
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 2) throw new Error('The first sheet is empty. Put a heading row (Full name, Email, ...) and then one trainee per row.');

  // find the heading row within the first few rows
  let headerRow = 0; const col: Record<string, number> = {};
  for (let r = 1; r <= Math.min(10, ws.rowCount) && !headerRow; r++) {
    const found: Record<string, number> = {};
    ws.getRow(r).eachCell((c, n) => {
      const t = norm(cellText(c));
      for (const [key, names] of Object.entries(HEADINGS)) if (!(key in found) && names.includes(t)) found[key] = n;
    });
    if (found.email) { headerRow = r; Object.assign(col, found); }
  }
  if (!headerRow) throw new Error('No Email column was found. The first row should have headings such as Full name and Email. Use the template.');
  if (!col.full_name) throw new Error('No Full name column was found. The first row should have headings such as Full name and Email. Use the template.');

  const rows: SheetRow[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const wr = ws.getRow(r);
    const get = (k: string) => (col[k] ? cellText(wr.getCell(col[k])) : '');
    const email = get('email'); const full_name = get('full_name');
    if (!email && !full_name && !get('phone') && !get('employer') && !get('aviation_role')) continue; // blank row
    const problems: string[] = [];
    if (!email) problems.push('Email is missing');
    else if (!emailOk.safeParse(email).success) problems.push(`"${email}" is not a valid email address`);
    if (full_name.length < 2) problems.push('Full name is missing');
    if (full_name.length > 200) problems.push('Full name is too long');
    rows.push({ row: r, email: email.toLowerCase(), full_name, phone: get('phone').slice(0, 50) || null, aviation_role: get('aviation_role').slice(0, 200) || null, employer: get('employer').slice(0, 200) || null, problems });
    if (rows.length > MAX_ROWS) throw new Error(`This file has more than ${MAX_ROWS} trainees. Split it into smaller files.`);
  }
  if (!rows.length) throw new Error('No trainees were found below the heading row.');
  return rows;
}
