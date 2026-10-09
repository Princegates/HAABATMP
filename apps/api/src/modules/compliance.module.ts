import { Body, Controller, Delete, Get, Module, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Actor, AuthUser } from '../common/auth.types';
import { AuditService } from '../common/audit.service';
import { Db } from '../common/db.service';
import { ActorCtx, CurrentUser, Require } from '../common/decorators';
import { seesAllClients } from '../common/scope';
import { SettingsService } from '../common/settings.service';
import { pageQuery, parse, uuid } from '../common/validation';

/**
 * Who is missing or lapsing on required training. A requirement says "these people must hold a live certificate for this course".
 * The same query feeds the compliance screen, the compliance report and the dashboards.
 */
export function gapsSql(opts: { orgParam?: string; courseParam?: string; soonParam: string }) {
  return `
    with live as (
      select distinct on (ce.trainee_id, ce.course_id) ce.* from certificates ce where ce.status = 'valid' order by ce.trainee_id, ce.course_id, ce.expires_at desc nulls first
    ), gaps as (
      select u.id as trainee_id, u.full_name, u.organization_id, o.name as organization_name, tp.aviation_role,
             c.id as course_id, c.code as course_code, c.title as course_title, r.grace_days, l.number as certificate_number, l.expires_at,
             case when l.id is null then 'missing'
                  when l.expires_at is null then null
                  when l.expires_at + r.grace_days < current_date then 'expired'
                  when l.expires_at < current_date then 'in_grace'
                  when l.expires_at <= current_date + ${opts.soonParam}::int then 'expiring_soon' end as issue
        from compliance_requirements r
        join courses c on c.id = r.course_id
        join users u on u.role = 'trainee' and u.status <> 'suspended' and (r.organization_id is null or r.organization_id = u.organization_id)
        left join trainee_profiles tp on tp.user_id = u.id
        left join organizations o on o.id = u.organization_id
        left join live l on l.trainee_id = u.id and l.course_id = r.course_id
       where (r.aviation_role is null or lower(r.aviation_role) = lower(coalesce(tp.aviation_role, '')))
         ${opts.orgParam ? `and u.organization_id = ${opts.orgParam}` : ''} ${opts.courseParam ? `and c.id = ${opts.courseParam}` : ''}
    ) select * from gaps where issue is not null`;
}

@Controller('compliance')
export class ComplianceController {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly settings: SettingsService) {}

  @Get('overview')
  @Require('compliance:read')
  async overview(@CurrentUser() u: AuthUser, @Query('organization_id') organizationId?: string) {
    const org = this.orgScope(u, organizationId);
    const t = await this.settings.training();
    const params: any[] = [t.certificate_expiring_soon_days];
    if (org) params.push(org);
    const rows = await this.db.query<{ issue: string; n: number }>(`select issue, count(*) n from (${gapsSql({ soonParam: '$1', orgParam: org ? '$2' : undefined })}) g group by issue`, params);
    const by = Object.fromEntries(rows.map((r) => [r.issue, r.n]));
    const orgClause = org ? 'and t.organization_id = $1' : '';
    const oparams = org ? [org] : [];
    const extra = await this.db.one<any>(
      `select (select count(*) from results r join enrollments e on e.id = r.enrollment_id join users t on t.id = e.trainee_id where r.finalised and r.status = 'fail' ${orgClause}) as failed_assessments,
              (select count(*) from results r join enrollments e on e.id = r.enrollment_id join programmes p on p.id = e.programme_id join courses c on c.id = p.course_id join users t on t.id = e.trainee_id
                where r.finalised and r.attendance_pct is not null and r.attendance_pct < c.min_attendance_pct ${orgClause}) as attendance_deficiencies`, oparams);
    return { missing: by.missing ?? 0, expired: by.expired ?? 0, in_grace: by.in_grace ?? 0, expiring_soon: by.expiring_soon ?? 0, ...extra };
  }

  @Get('gaps')
  @Require('compliance:read')
  async gaps(@CurrentUser() u: AuthUser, @Query() query: unknown) {
    const f = parse(pageQuery.extend({ organization_id: uuid.optional(), course_id: uuid.optional(), issue: z.enum(['missing', 'expired', 'in_grace', 'expiring_soon']).optional() }), query);
    const org = this.orgScope(u, f.organization_id);
    const t = await this.settings.training();
    const params: any[] = [t.certificate_expiring_soon_days];
    let orgP: string | undefined; let courseP: string | undefined;
    if (org) { params.push(org); orgP = `$${params.length}`; }
    if (f.course_id) { params.push(f.course_id); courseP = `$${params.length}`; }
    let outer = '';
    if (f.issue) { params.push(f.issue); outer += ` where issue = $${params.length}`; }
    const sql = `select * from (${gapsSql({ soonParam: '$1', orgParam: orgP, courseParam: courseP })}) g ${outer}`;
    const data = await this.db.query(`${sql} order by case issue when 'missing' then 0 when 'expired' then 1 when 'in_grace' then 2 else 3 end, expires_at nulls first, full_name limit ${f.limit} offset ${f.offset}`, params);
    return { data };
  }

  @Get('requirements')
  @Require('compliance:read')
  requirements() {
    return this.db.query(
      `select r.*, c.code as course_code, c.title as course_title, o.name as organization_name from compliance_requirements r join courses c on c.id = r.course_id
         left join organizations o on o.id = r.organization_id order by c.code`);
  }

  @Post('requirements')
  @Require('compliance:write')
  async addRequirement(@Body() body: unknown, @ActorCtx() actor: Actor) {
    const d = parse(z.object({ course_id: uuid, organization_id: uuid.nullish(), aviation_role: z.string().trim().max(200).nullish(), grace_days: z.number().int().min(0).max(365).default(0) }), body);
    return this.db.tx(async (q) => {
      const row = await q.one('insert into compliance_requirements (course_id, organization_id, aviation_role, grace_days) values ($1,$2,$3,$4) returning *', [d.course_id, d.organization_id ?? null, d.aviation_role || null, d.grace_days]);
      await this.audit.log(q, actor, 'compliance_requirement.create', 'compliance_requirement', row.id, null, row);
      return row;
    });
  }

  @Delete('requirements/:id')
  @Require('compliance:write')
  async removeRequirement(@Param('id') id: string, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    return this.db.tx(async (q) => {
      const row = await q.one('delete from compliance_requirements where id = $1 returning *', [id]);
      if (!row) throw new NotFoundException();
      await this.audit.log(q, actor, 'compliance_requirement.delete', 'compliance_requirement', id, row, null);
      return { ok: true };
    });
  }

  /** Client administrators are pinned to their own organisation whatever they ask for. */
  private orgScope(u: AuthUser, requested?: string): string | undefined {
    if (!seesAllClients(u)) return u.organizationId ?? undefined;
    return requested || undefined;
  }
}

@Module({ controllers: [ComplianceController] })
export class ComplianceModule {}
