import { Controller, Get, Header, Module, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import { Db } from '../common/db.service';
import { Require } from '../common/decorators';
import { csvEscape } from '../common/util';
import { isoDate, pageQuery, parse, uuid } from '../common/validation';

const query = pageQuery.extend({
  actor_id: uuid.optional(), action: z.string().max(100).optional(), entity_type: z.string().max(100).optional(), entity_id: z.string().max(100).optional(),
  from: isoDate.optional(), to: isoDate.optional(),
});

@Controller('audit')
export class AuditController {
  constructor(private readonly db: Db) {}

  @Get()
  @Require('audit:read')
  async list(@Query() raw: unknown) {
    const f = parse(query, raw);
    const { where, params } = this.filter(f);
    const data = await this.db.query(
      `select id, seq, at, actor_id, actor_email, actor_role, action, entity_type, entity_id, ip, before_data, after_data from audit_logs ${where} order by seq desc limit ${f.limit} offset ${f.offset}`, params);
    const total = (await this.db.one<{ n: number }>(`select count(*) n from audit_logs ${where}`, params))!.n;
    return { data, total };
  }

  @Get('export')
  @Require('audit:read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="audit-log.csv"')
  async export(@Query() raw: unknown) {
    const f = parse(query.extend({ limit: z.coerce.number().int().min(1).max(50000).default(10000) }), raw);
    const { where, params } = this.filter(f);
    const rows = await this.db.query<any>(`select seq, at, actor_email, actor_role, action, entity_type, entity_id, ip, before_data, after_data from audit_logs ${where} order by seq desc limit ${f.limit}`, params);
    const head = ['seq', 'at', 'actor', 'role', 'action', 'entity_type', 'entity_id', 'ip', 'before', 'after'];
    return [head.join(','), ...rows.map((r) => [r.seq, r.at.toISOString(), r.actor_email, r.actor_role, r.action, r.entity_type, r.entity_id, r.ip, r.before_data ? JSON.stringify(r.before_data) : '', r.after_data ? JSON.stringify(r.after_data) : ''].map(csvEscape).join(','))].join('\n');
  }

  /** Recomputes the hash chain. Any edited or removed row breaks it at a known position. */
  @Get('verify')
  @Require('audit:read')
  async verify() {
    const r = await this.db.one<any>('select * from audit_verify()');
    return { ok: r.bad_rows === 0 && r.missing_entries === 0, checked: r.checked, first_bad_seq: r.first_bad_seq, bad_rows: r.bad_rows, missing_entries: r.missing_entries, verified_at: new Date().toISOString() };
  }

  private filter(f: z.infer<typeof query>) {
    const params: any[] = [];
    const where: string[] = [];
    const add = (sql: string, v: any) => { params.push(v); where.push(sql.replace(/\?/g, `$${params.length}`)); };
    if (f.actor_id) add('actor_id = ?', f.actor_id);
    if (f.action) add('action ilike ?', `${f.action}%`);
    if (f.entity_type) add('entity_type = ?', f.entity_type);
    if (f.entity_id) add('entity_id = ?', f.entity_id);
    if (f.from) add('at >= ?::date', f.from);
    if (f.to) add(`at < (?::date + 1)`, f.to);
    if (f.q) add(`(actor_email ilike ? or action ilike ?)`, `%${f.q}%`);
    return { where: where.length ? `where ${where.join(' and ')}` : '', params };
  }
}

@Module({ controllers: [AuditController] })
export class AuditModule {}
