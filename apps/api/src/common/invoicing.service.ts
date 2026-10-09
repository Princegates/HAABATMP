import { Injectable } from '@nestjs/common';
import { Q } from './db.service';
import { NumberingService } from './numbering.service';
import { SettingsService } from './settings.service';
import { round2 } from './util';

@Injectable()
export class InvoicingService {
  constructor(private readonly numbers: NumberingService, private readonly settings: SettingsService) {}

  /** Creates the invoice for a programme place. Billed to the sponsoring organisation when there is one. */
  async createForEnrollment(q: Q, e: { id: string; trainee_id: string; sponsor_organization_id: string | null }, createdBy: string | null) {
    const p = await q.one<any>(
      `select p.id, p.code, p.fee, p.currency, c.title from enrollments en join programmes p on p.id = en.programme_id
         join courses c on c.id = p.course_id where en.id = $1`, [e.id]);
    if (!p || !(p.fee > 0)) return null;
    const existing = await q.one('select id from invoices where enrollment_id = $1 and status <> $2', [e.id, 'cancelled']);
    if (existing) return existing;
    const fin = await this.settings.finance(q);
    const taxRate = Number(fin.tax_rate ?? 0);
    const subtotal = round2(p.fee);
    const tax = round2(subtotal * taxRate / 100);
    const total = round2(subtotal + tax);
    const due = new Date(Date.now() + (fin.invoice_due_days ?? 14) * 86400000).toISOString().slice(0, 10);
    const number = await this.numbers.invoice(q);
    const inv = await q.one<any>(
      `insert into invoices (number, organization_id, trainee_id, programme_id, enrollment_id, due_date, currency, subtotal, tax_rate, tax_amount, total, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [number, e.sponsor_organization_id, e.sponsor_organization_id ? null : e.trainee_id, p.id, e.id, due, p.currency, subtotal, taxRate, tax, total, createdBy]);
    await q.query('insert into invoice_items (invoice_id, description, quantity, unit_price) values ($1,$2,1,$3)', [inv.id, `${p.title} (${p.code})`, subtotal]);
    return inv;
  }

  /** Recomputes paid amount and status from the payments. The single place invoice status is decided. */
  async recompute(q: Q, invoiceId: string) {
    const inv = await q.one<any>('select * from invoices where id = $1 for update', [invoiceId]);
    if (!inv || inv.status === 'cancelled') return inv;
    const sums = await q.one<{ paid: number; refunded: number }>(
      `select coalesce(sum(amount) filter (where status = 'paid'), 0) as paid,
              coalesce(sum(amount) filter (where status = 'refunded'), 0) as refunded from payments where invoice_id = $1`, [invoiceId]);
    const paid = round2(sums!.paid);
    let status = 'pending';
    if (paid >= inv.total && inv.total > 0) status = 'paid';
    else if (paid > 0) status = 'partially_paid';
    else if (sums!.refunded > 0) status = 'refunded';
    return q.one('update invoices set amount_paid = $2, status = $3 where id = $1 returning *', [invoiceId, paid, status]);
  }
}
