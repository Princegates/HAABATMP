import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Header, Inject, Module, NotFoundException, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { z } from 'zod';
import { ENV, Env } from '../config';
import { Actor, AuthUser } from '../common/auth.types';
import { AuditService } from '../common/audit.service';
import { Db, Q } from '../common/db.service';
import { ActorCtx, CurrentUser, Require } from '../common/decorators';
import { renderInvoice, renderReceipt } from '../common/finance-pdf';
import { InvoicingService } from '../common/invoicing.service';
import { NumberingService } from '../common/numbering.service';
import { seesAllClients } from '../common/scope';
import { SettingsService } from '../common/settings.service';
import { round2 } from '../common/util';
import { isoDate, pageQuery, parse, uuid } from '../common/validation';

const STATUSES = ['pending', 'partially_paid', 'paid', 'failed', 'refunded', 'cancelled'] as const;
const METHODS = ['cash', 'bank_transfer', 'mobile_money', 'card', 'cheque', 'other'] as const;

@Controller()
export class FinanceController {
  constructor(
    private readonly db: Db, private readonly audit: AuditService, private readonly numbers: NumberingService, private readonly invoicing: InvoicingService,
    private readonly settings: SettingsService, @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('invoices')
  @Require('invoices:read')
  async list(@CurrentUser() u: AuthUser, @Query() query: unknown) {
    await this.assertTraineeMayUseFinance(u);
    const f = parse(pageQuery.extend({ status: z.enum(STATUSES).optional(), organization_id: uuid.optional(), programme_id: uuid.optional(), overdue: z.enum(['true']).optional() }), query);
    const params: any[] = [];
    const where: string[] = [];
    const add = (sql: string, v: any) => { params.push(v); where.push(sql.replace(/\?/g, `$${params.length}`)); };
    if (u.role === 'trainee') add('i.trainee_id = ?', u.id);
    else if (u.role === 'org_admin') add('(i.organization_id = ? or t.organization_id = ?)', u.organizationId);
    if (f.status) add('i.status = ?', f.status);
    if (f.organization_id && seesAllClients(u)) add('i.organization_id = ?', f.organization_id);
    if (f.programme_id) add('i.programme_id = ?', f.programme_id);
    if (f.overdue) where.push(`i.due_date < current_date and i.status in ('pending','partially_paid')`);
    if (f.q) add('(i.number ilike ? or o.name ilike ? or t.full_name ilike ?)', `%${f.q}%`);
    const w = where.length ? `where ${where.join(' and ')}` : '';
    const from = `from invoices i left join organizations o on o.id = i.organization_id left join users t on t.id = i.trainee_id left join programmes p on p.id = i.programme_id`;
    const data = await this.db.query(
      `select i.*, o.name as organization_name, t.full_name as trainee_name, p.code as programme_code, (i.total - i.amount_paid) as balance,
              (i.due_date < current_date and i.status in ('pending','partially_paid')) as overdue
         ${from} ${w} order by i.issue_date desc, i.number desc limit ${f.limit} offset ${f.offset}`, params);
    const total = (await this.db.one<{ n: number }>(`select count(*) n ${from} ${w}`, params))!.n;
    return { data, total };
  }

  @Get('invoices/:id')
  @Require('invoices:read')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    parse(uuid, id);
    const inv = await this.visible(u, id);
    const [items, payments] = await Promise.all([
      this.db.query('select * from invoice_items where invoice_id = $1 order by description', [id]),
      this.db.query(`select p.*, x.full_name as recorded_by_name from payments p join users x on x.id = p.recorded_by where p.invoice_id = $1 order by p.received_at`, [id]),
    ]);
    const who = await this.db.one<any>(
      `select o.name as organization_name, t.full_name as trainee_name, p.code as programme_code from invoices i left join organizations o on o.id = i.organization_id
         left join users t on t.id = i.trainee_id left join programmes p on p.id = i.programme_id where i.id = $1`, [id]);
    return { ...inv, ...who, items, payments };
  }

  @Post('invoices')
  @Require('invoices:write')
  async create(@CurrentUser() u: AuthUser, @Body() body: unknown, @ActorCtx() actor: Actor) {
    const d = parse(z.object({
      organization_id: uuid.nullish(), trainee_id: uuid.nullish(), programme_id: uuid.nullish(), enrollment_id: uuid.nullish(),
      due_date: isoDate.nullish(), purchase_order: z.string().trim().max(100).nullish(), notes: z.string().trim().max(1000).nullish(),
      tax_rate: z.number().min(0).max(100).optional(),
      items: z.array(z.object({ description: z.string().trim().min(2).max(300), quantity: z.number().positive().max(10000), unit_price: z.number().min(0).max(1e8) })).min(1).max(50),
    }), body);
    if (!d.organization_id && !d.trainee_id) throw new BadRequestException('Choose who to bill: an organisation or a trainee');
    const fin = await this.settings.finance();
    const subtotal = round2(d.items.reduce((s, i) => s + i.quantity * i.unit_price, 0));
    const rate = d.tax_rate ?? fin.tax_rate ?? 0;
    const tax = round2(subtotal * rate / 100);
    return this.db.tx(async (q) => {
      const number = await this.numbers.invoice(q);
      const due = d.due_date ?? new Date(Date.now() + (fin.invoice_due_days ?? 14) * 86400000).toISOString().slice(0, 10);
      const inv = await q.one<any>(
        `insert into invoices (number, organization_id, trainee_id, programme_id, enrollment_id, due_date, currency, subtotal, tax_rate, tax_amount, total, purchase_order, notes, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
        [number, d.organization_id ?? null, d.trainee_id ?? null, d.programme_id ?? null, d.enrollment_id ?? null, due, fin.currency ?? 'GHS', subtotal, rate, tax, round2(subtotal + tax), d.purchase_order ?? null, d.notes ?? null, u.id]);
      for (const it of d.items) await q.query('insert into invoice_items (invoice_id, description, quantity, unit_price) values ($1,$2,$3,$4)', [inv.id, it.description, it.quantity, it.unit_price]);
      await this.audit.log(q, actor, 'invoice.create', 'invoice', inv.id, null, inv);
      return inv;
    });
  }

  @Post('invoices/:id/cancel')
  @Require('invoices:write')
  async cancel(@Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(500) }), body);
    return this.db.tx(async (q) => {
      const inv = await q.one<any>('select * from invoices where id = $1 for update', [id]);
      if (!inv) throw new NotFoundException();
      if (inv.status === 'cancelled') throw new ConflictException('Already cancelled');
      if (inv.amount_paid > 0) throw new ConflictException('Payments have been received. Refund them first.');
      const after = await q.one('update invoices set status = $2, notes = coalesce(notes || E\'\\n\', \'\') || $3 where id = $1 returning *', [id, 'cancelled', `Cancelled: ${reason}`]);
      await this.audit.log(q, actor, 'invoice.cancel', 'invoice', id, { status: inv.status }, { status: 'cancelled', reason });
      return after;
    });
  }

  @Post('invoices/:id/payments')
  @Require('payments:write')
  async pay(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const d = parse(z.object({
      amount: z.number().positive().max(1e9), method: z.enum(METHODS), reference: z.string().trim().max(200).nullish(),
      received_at: z.string().datetime({ offset: true }).optional(), note: z.string().trim().max(500).nullish(),
    }), body);
    const pm = await this.settings.get<{ methods: { key: string; enabled: boolean }[] }>('payment_methods');
    if (!pm.methods.some((m) => m.key === d.method && m.enabled)) throw new BadRequestException('That payment method is switched off');
    return this.db.tx(async (q) => {
      const inv = await q.one<any>('select * from invoices where id = $1 for update', [id]);
      if (!inv) throw new NotFoundException();
      if (['cancelled', 'refunded'].includes(inv.status)) throw new ConflictException(`A ${inv.status} invoice cannot take payments`);
      const balance = round2(inv.total - inv.amount_paid);
      if (d.amount > balance + 0.001) throw new BadRequestException(`That is more than the balance of ${balance.toFixed(2)}`);
      const receipt = await this.numbers.receipt(q);
      const p = await q.one<any>(
        `insert into payments (invoice_id, receipt_number, amount, method, reference, received_at, note, recorded_by) values ($1,$2,$3,$4,$5,coalesce($6::timestamptz, now()),$7,$8) returning *`,
        [id, receipt, d.amount, d.method, d.reference ?? null, d.received_at ?? null, d.note ?? null, u.id]);
      const updated = await this.invoicing.recompute(q, id);
      await this.audit.log(q, actor, 'payment.record', 'payment', p.id, null, { invoice: inv.number, amount: d.amount, method: d.method, receipt });
      return { payment: p, invoice: updated };
    });
  }

  @Post('payments/:id/refund')
  @Require('payments:write')
  async refund(@Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(500) }), body);
    return this.db.tx(async (q) => {
      const p = await q.one<any>('select * from payments where id = $1 for update', [id]);
      if (!p) throw new NotFoundException();
      if (p.status !== 'paid') throw new ConflictException(`A ${p.status} payment cannot be refunded`);
      const after = await q.one('update payments set status = $2, note = coalesce(note || E\'\\n\', \'\') || $3 where id = $1 returning *', [id, 'refunded', `Refunded: ${reason}`]);
      const invoice = await this.invoicing.recompute(q, p.invoice_id);
      await this.audit.log(q, actor, 'payment.refund', 'payment', id, { status: p.status }, { status: 'refunded', reason, amount: p.amount });
      return { payment: after, invoice };
    });
  }

  @Get('invoices/:id/pdf')
  @Require('invoices:read')
  @Header('Content-Type', 'application/pdf')
  @Header('Cache-Control', 'private, no-store')
  async invoicePdf(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res({ passthrough: true }) res: any) {
    parse(uuid, id);
    const inv = await this.visible(u, id);
    const [items, billTo, pm, header] = await Promise.all([
      this.db.query<any>('select * from invoice_items where invoice_id = $1', [id]),
      inv.organization_id ? this.db.one<any>('select name, billing_address, address, billing_email from organizations where id = $1', [inv.organization_id])
                          : this.db.one<any>('select full_name as name, email as billing_email from users where id = $1', [inv.trainee_id]),
      this.settings.get<{ methods: { label: string; enabled: boolean; instructions: string }[] }>('payment_methods'),
      this.header(),
    ]);
    const file = await renderInvoice({
      header, number: inv.number, status: inv.status, issueDate: inv.issue_date, dueDate: inv.due_date, billTo: billTo?.name ?? '',
      billToDetail: [billTo?.billing_address ?? billTo?.address, billTo?.billing_email].filter(Boolean).join('\n'), purchaseOrder: inv.purchase_order,
      currency: inv.currency, items, subtotal: inv.subtotal, taxRate: inv.tax_rate, tax: inv.tax_amount, total: inv.total, paid: inv.amount_paid,
      instructions: pm.methods.filter((m) => m.enabled && m.instructions).map((m) => `${m.label}: ${m.instructions}`), notes: inv.notes,
    });
    res.set('Content-Disposition', `attachment; filename="${inv.number}.pdf"`);
    return new StreamableFile(file);
  }

  @Get('payments/:id/receipt')
  @Require('invoices:read')
  @Header('Content-Type', 'application/pdf')
  @Header('Cache-Control', 'private, no-store')
  async receiptPdf(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res({ passthrough: true }) res: any) {
    parse(uuid, id);
    const p = await this.db.one<any>('select * from payments where id = $1', [id]);
    if (!p) throw new NotFoundException();
    const inv = await this.visible(u, p.invoice_id);
    const payer = inv.organization_id ? (await this.db.one<any>('select name from organizations where id = $1', [inv.organization_id]))?.name : (await this.db.one<any>('select full_name as name from users where id = $1', [inv.trainee_id]))?.name;
    const file = await renderReceipt({
      header: await this.header(), receiptNumber: p.receipt_number, invoiceNumber: inv.number, receivedAt: p.received_at, payer: payer ?? '', method: p.method, reference: p.reference,
      currency: inv.currency, amount: p.amount, invoiceTotal: inv.total, balance: inv.total - inv.amount_paid, status: p.status,
    });
    res.set('Content-Disposition', `attachment; filename="${p.receipt_number}.pdf"`);
    return new StreamableFile(file);
  }

  private async header() {
    const [org, print] = await Promise.all([this.settings.get<any>('organization'), this.settings.get<any>('print')]);
    return { issuer: org.name, address: org.address, email: org.email, phone: org.phone, registration: org.registration_number, headerText: print.header_text, footerText: print.footer_text, logoPath: this.env.LOGO_PATH, showLogo: print.show_logo };
  }

  /** The Super Admin can hide Finance from trainees (System setting > Trainee Access). The platform enforces it, not just the menu. */
  private async assertTraineeMayUseFinance(u: AuthUser) {
    if (u.role !== 'trainee') return;
    const s = await this.settings.get<{ show_finance: boolean }>('trainee_access');
    if (!s.show_finance) throw new ForbiddenException('Invoices are not available to trainees');
  }

  private async visible(u: AuthUser, id: string) {
    await this.assertTraineeMayUseFinance(u);
    const params: any[] = [id];
    let scope = '';
    if (u.role === 'trainee') { params.push(u.id); scope = 'and i.trainee_id = $2'; }
    else if (u.role === 'org_admin') { params.push(u.organizationId); scope = 'and (i.organization_id = $2 or t.organization_id = $2)'; }
    const inv = await this.db.one<any>(`select i.* from invoices i left join users t on t.id = i.trainee_id where i.id = $1 ${scope}`, params);
    if (!inv) throw new NotFoundException();
    return inv;
  }
}

@Module({ controllers: [FinanceController] })
export class FinanceModule {}
