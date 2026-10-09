import { Body, Controller, Get, Header, Module, NotFoundException, Param, Patch, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Actor, AuthUser } from '../common/auth.types';
import { AuditService } from '../common/audit.service';
import { CertificatesService, certStatus } from '../common/certificates.service';
import { Db } from '../common/db.service';
import { ActorCtx, CurrentUser, Public, Require } from '../common/decorators';
import { SettingsService } from '../common/settings.service';
import { pageQuery, parse, uuid } from '../common/validation';

const CERT_COLS = `c.id, c.number, c.status as stored_status, c.issued_at, c.expires_at, c.revoked_at, c.revoke_reason, c.renewal_of, c.trainee_id, c.course_id, c.programme_id,
  t.full_name as trainee_name, t.email as trainee_email, o.name as organization_name, co.code as course_code, co.title as course_title, p.code as programme_code`;
const CERT_FROM = `from certificates c join users t on t.id = c.trainee_id join courses co on co.id = c.course_id join programmes p on p.id = c.programme_id
  left join organizations o on o.id = t.organization_id join results r on r.enrollment_id = c.enrollment_id`;

const templateBody = z.object({
  name: z.string().trim().min(2).max(100),
  organization_id: uuid.nullish(),
  heading: z.string().trim().min(3).max(100).default('Certificate of Completion'),
  signatory_name: z.string().trim().max(100).nullish(),
  signatory_title: z.string().trim().max(100).nullish(),
  footer_text: z.string().trim().max(300).nullish(),
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#b8966e'),
});

@Controller()
export class CertificatesController {
  constructor(private readonly db: Db, private readonly certs: CertificatesService, private readonly audit: AuditService, private readonly settings: SettingsService) {}

  // ------------------------------------------------------------ public verification

  /**
   * Anyone holding the QR code can check a certificate. The lookup is by an unguessable token, not the printed number,
   * so certificates cannot be enumerated, and only the minimum needed to confirm validity is shown.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('verify/:token')
  async verify(@Param('token') token: string) {
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) throw new NotFoundException('Certificate not found');
    const c = await this.db.one<any>(
      `select c.number, c.status, c.issued_at, c.expires_at, t.full_name, co.title as course_title, co.code as course_code
         from certificates c join users t on t.id = c.trainee_id join courses co on co.id = c.course_id where c.verification_token = $1`, [token]);
    if (!c) throw new NotFoundException('Certificate not found');
    const t = await this.settings.training();
    const org = await this.settings.get<{ name: string }>('organization');
    return {
      status: certStatus({ status: c.status, expires_at: c.expires_at }, t.certificate_expiring_soon_days),
      holder: c.full_name, course: c.course_title, course_code: c.course_code, certificate_number: c.number,
      issued_at: c.issued_at, expires_at: c.expires_at, issued_by: org.name,
    };
  }

  // ------------------------------------------------------------ certificates

  @Get('certificates')
  @Require('certificates:read')
  async list(@CurrentUser() u: AuthUser, @Query() query: unknown) {
    const f = parse(pageQuery.extend({
      status: z.enum(['valid', 'expiring_soon', 'expired', 'revoked']).optional(), course_id: uuid.optional(), trainee_id: uuid.optional(),
      expiring_within_days: z.coerce.number().int().min(1).max(730).optional(),
    }), query);
    const t = await this.settings.training();
    const params: any[] = [t.certificate_expiring_soon_days];
    const where: string[] = [];
    const add = (sql: string, v: any) => { params.push(v); where.push(sql.replace(/\?/g, `$${params.length}`)); };
    if (u.role === 'trainee') { add('c.trainee_id = ?', u.id); where.push('r.released'); }
    else if (u.role === 'org_admin') { add('t.organization_id = ?', u.organizationId); where.push('r.released'); }
    if (f.course_id) add('c.course_id = ?', f.course_id);
    if (f.trainee_id && u.role !== 'trainee') add('c.trainee_id = ?', f.trainee_id);
    if (f.q) add(`(t.full_name ilike ? or c.number ilike ?)`, `%${f.q}%`);
    if (f.expiring_within_days) { where.push(`c.status = 'valid'`); add(`c.expires_at between current_date and current_date + ?::int`, f.expiring_within_days); }
    const derived = `case when c.status = 'revoked' then 'revoked' when c.expires_at < current_date then 'expired'
                          when c.expires_at <= current_date + $1::int then 'expiring_soon' else 'valid' end`;
    if (f.status) add(`${derived} = ?`, f.status);
    const w = where.length ? `where ${where.join(' and ')}` : '';
    const data = await this.db.query(`select ${CERT_COLS}, ${derived} as status ${CERT_FROM} ${w} order by c.issued_at desc, c.number desc limit ${f.limit} offset ${f.offset}`, params);
    // $1 (the expiring-soon window) is only used by the list's status column, so reference it here to keep the parameter list valid
    const wc = where.length ? `where $1::int is not null and ${where.join(' and ')}` : 'where $1::int is not null';
    const total = (await this.db.one<{ n: number }>(`select count(*) n ${CERT_FROM} ${wc}`, params))!.n;
    return { data, total };
  }

  @Get('certificates/:id')
  @Require('certificates:read')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    parse(uuid, id);
    return this.visible(u, id);
  }

  @Get('certificates/:id/pdf')
  @Require('certificates:read')
  @Header('Content-Type', 'application/pdf')
  @Header('Cache-Control', 'private, no-store')
  async pdf(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res({ passthrough: true }) res: any, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    await this.visible(u, id);
    const { file, number } = await this.certs.pdf(id);
    res.set('Content-Disposition', `attachment; filename="${number}.pdf"`);
    await this.audit.log(null, actor, 'certificate.download', 'certificate', id);
    return new StreamableFile(file);
  }

  @Post('certificates/:id/revoke')
  @Require('certificates:revoke')
  async revoke(@Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(500) }), body);
    return this.db.tx((q) => this.certs.revoke(q, id, actor, reason));
  }

  /** Replaces a certificate (for example a corrected name). The old one is revoked and a new number issued. */
  @Post('certificates/:id/reissue')
  @Require('certificates:revoke', 'certificates:issue')
  async reissue(@Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(500) }), body);
    return this.db.tx(async (q) => {
      const old = await q.one<any>('select enrollment_id from certificates where id = $1', [id]);
      if (!old) throw new NotFoundException();
      await this.certs.revoke(q, id, actor, `Reissued: ${reason}`);
      return this.certs.issue(q, old.enrollment_id, actor);
    });
  }

  // ------------------------------------------------------------ templates

  @Get('certificate-templates')
  @Require('certificates:read')
  templates() {
    return this.db.query('select * from certificate_templates order by is_default desc, name');
  }

  @Post('certificate-templates')
  @Require('certificates:issue')
  async createTemplate(@Body() body: unknown, @ActorCtx() actor: Actor) {
    const d = parse(templateBody, body);
    return this.db.tx(async (q) => {
      const row = await q.one('insert into certificate_templates (name, organization_id, heading, signatory_name, signatory_title, footer_text, accent_color) values ($1,$2,$3,$4,$5,$6,$7) returning *',
        [d.name, d.organization_id ?? null, d.heading, d.signatory_name ?? null, d.signatory_title ?? null, d.footer_text ?? null, d.accent_color]);
      await this.audit.log(q, actor, 'certificate_template.create', 'certificate_template', row.id, null, row);
      return row;
    });
  }

  @Patch('certificate-templates/:id')
  @Require('certificates:issue')
  async updateTemplate(@Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const d = parse(templateBody.partial(), body);
    return this.db.tx(async (q) => {
      const before = await q.one<any>('select * from certificate_templates where id = $1 for update', [id]);
      if (!before) throw new NotFoundException();
      const m = { ...before, ...Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v ?? null])) } as any;
      const after = await q.one('update certificate_templates set name=$2, organization_id=$3, heading=$4, signatory_name=$5, signatory_title=$6, footer_text=$7, accent_color=$8 where id=$1 returning *',
        [id, m.name, m.organization_id, m.heading, m.signatory_name, m.signatory_title, m.footer_text, m.accent_color ?? '#b8966e']);
      await this.audit.log(q, actor, 'certificate_template.update', 'certificate_template', id, before, after);
      return after;
    });
  }

  private async visible(u: AuthUser, id: string) {
    const t = await this.settings.training();
    const params: any[] = [id, t.certificate_expiring_soon_days];
    let scope = '';
    if (u.role === 'trainee') { params.push(u.id); scope = `and c.trainee_id = $3 and r.released`; }
    else if (u.role === 'org_admin') { params.push(u.organizationId); scope = `and t.organization_id = $3 and r.released`; }
    const row = await this.db.one<any>(
      `select ${CERT_COLS}, case when c.status = 'revoked' then 'revoked' when c.expires_at < current_date then 'expired'
              when c.expires_at <= current_date + $2::int then 'expiring_soon' else 'valid' end as status ${CERT_FROM} where c.id = $1 ${scope}`, params);
    if (!row) throw new NotFoundException();
    return row;
  }
}

@Module({ controllers: [CertificatesController] })
export class CertificatesModule {}
