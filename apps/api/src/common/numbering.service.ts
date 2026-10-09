import { Injectable } from '@nestjs/common';
import { Q } from './db.service';

/** Gap-free-per-year sequences. Always call inside the transaction that uses the number. */
@Injectable()
export class NumberingService {
  async invoice(q: Q): Promise<string> {
    const y = new Date().getUTCFullYear();
    const r = await q.one<{ last_value: number }>(
      `insert into invoice_sequences (year, last_value) values ($1, 1)
       on conflict (year) do update set last_value = invoice_sequences.last_value + 1 returning last_value`, [y]);
    return `INV-${y}-${String(r!.last_value).padStart(6, '0')}`;
  }

  async receipt(q: Q): Promise<string> {
    const y = new Date().getUTCFullYear();
    const r = await q.one<{ last_value: number }>(
      `insert into receipt_sequences (year, last_value) values ($1, 1)
       on conflict (year) do update set last_value = receipt_sequences.last_value + 1 returning last_value`, [y]);
    return `RCT-${y}-${String(r!.last_value).padStart(6, '0')}`;
  }

  /** Format from the SRS: ATMP-2026-DGR-000184 (prefix, year, course category, sequence). */
  async certificate(q: Q, categoryCode: string): Promise<string> {
    const y = new Date().getUTCFullYear();
    const r = await q.one<{ last_value: number }>(
      `insert into certificate_sequences (year, category_code, last_value) values ($1, $2, 1)
       on conflict (year, category_code) do update set last_value = certificate_sequences.last_value + 1 returning last_value`, [y, categoryCode]);
    return `ATMP-${y}-${categoryCode}-${String(r!.last_value).padStart(6, '0')}`;
  }
}
