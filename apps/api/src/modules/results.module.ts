import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Module, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Actor, AuthUser } from '../common/auth.types';
import { AuditService } from '../common/audit.service';
import { attendanceStats } from '../common/attendance';
import { CertificatesService } from '../common/certificates.service';
import { Db, Q } from '../common/db.service';
import { ActorCtx, CurrentUser, Require } from '../common/decorators';
import { NotifyService } from '../common/notify.service';
import { decideResult } from '../common/result-rules';
import { isStaff, seesAllClients } from '../common/scope';
import { SettingsService } from '../common/settings.service';
import { pageQuery, parse, uuid } from '../common/validation';

const STATUS = ['pass', 'fail', 'pending', 'absent', 'disqualified'] as const;

@Controller()
export class ResultsController {
  constructor(
    private readonly db: Db, private readonly audit: AuditService, private readonly certs: CertificatesService,
    private readonly notify: NotifyService, private readonly settings: SettingsService,
  ) {}

  @Get('results')
  @Require('results:read')
  async list(@CurrentUser() u: AuthUser, @Query() query: unknown) {
    const f = parse(pageQuery.extend({ programme_id: uuid.optional(), trainee_id: uuid.optional(), organization_id: uuid.optional(), status: z.enum(STATUS).optional(), finalised: z.enum(['true', 'false']).optional() }), query);
    const params: any[] = [];
    const where: string[] = [];
    const add = (sql: string, v: any) => { params.push(v); where.push(sql.replace(/\?/g, `$${params.length}`)); };
    if (u.role === 'trainee') { add('e.trainee_id = ?', u.id); where.push('r.released'); }
    else if (u.role === 'org_admin') { add('t.organization_id = ?', u.organizationId); where.push('r.released'); }
    else if (u.role === 'instructor') add(`(p.lead_instructor_id = ? or exists (select 1 from sessions s where s.programme_id = p.id and s.instructor_id = ?))`, u.id);
    if (f.programme_id) add('e.programme_id = ?', f.programme_id);
    if (f.trainee_id && u.role !== 'trainee') add('e.trainee_id = ?', f.trainee_id);
    if (f.organization_id && seesAllClients(u)) add('t.organization_id = ?', f.organization_id);
    if (f.status) add('r.status = ?', f.status);
    if (f.finalised) add('r.finalised = ?', f.finalised === 'true');
    if (f.q) add('(t.full_name ilike ?)', `%${f.q}%`);
    const w = where.length ? `where ${where.join(' and ')}` : '';
    const data = await this.db.query(
      `select r.*, e.trainee_id, e.programme_id, t.full_name as trainee_name, o.name as organization_name, p.code as programme_code, p.title as programme_title,
              c.title as course_title, c.pass_mark, ce.number as certificate_number, ce.id as certificate_id
         from results r join enrollments e on e.id = r.enrollment_id join users t on t.id = e.trainee_id join programmes p on p.id = e.programme_id
         join courses c on c.id = p.course_id left join organizations o on o.id = t.organization_id
         left join certificates ce on ce.enrollment_id = e.id and ce.status = 'valid'
         ${w} order by p.start_date desc, t.full_name limit ${f.limit} offset ${f.offset}`, params);
    const total = (await this.db.one<{ n: number }>(`select count(*) n from results r join enrollments e on e.id = r.enrollment_id join users t on t.id = e.trainee_id join programmes p on p.id = e.programme_id ${w}`, params))!.n;
    return { data, total };
  }

  /** Recalculates every result in a programme that has not been finalised. */
  @Post('programmes/:id/results/compute')
  @Require('results:finalise', 'attempts:mark')
  async computeAll(@CurrentUser() u: AuthUser, @Param('id') id: string, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    await this.assertProgrammeAccess(u, id);
    return this.db.tx(async (q) => {
      const es = await q.query<{ id: string }>(`select id from enrollments where programme_id = $1 and status in ('confirmed','completed')`, [id]);
      const out: Record<string, number> = {};
      for (const e of es) {
        const r = await this.compute(q, e.id);
        if (r) out[r.status] = (out[r.status] ?? 0) + 1;
      }
      await this.audit.log(q, actor, 'results.compute', 'programme', id, null, out);
      return { computed: es.length, by_status: out };
    });
  }

  @Post('results/:id/finalise')
  @Require('results:finalise')
  async finalise(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const { remarks } = parse(z.object({ remarks: z.string().trim().max(1000).optional() }), body ?? {});
    return this.db.tx((q) => this.finaliseOne(q, u, actor, id, remarks));
  }

  @Post('programmes/:id/results/finalise-all')
  @Require('results:finalise')
  async finaliseAll(@CurrentUser() u: AuthUser, @Param('id') id: string, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const rows = await this.db.query<{ id: string }>(
      `select r.id from results r join enrollments e on e.id = r.enrollment_id where e.programme_id = $1 and not r.finalised and r.status <> 'pending'`, [id]);
    let finalised = 0;
    const blocked: { id: string; reason: string }[] = [];
    for (const r of rows) {
      try { await this.db.tx((q) => this.finaliseOne(q, u, actor, r.id)); finalised++; }
      catch (e: any) { blocked.push({ id: r.id, reason: e.response?.message ?? e.message }); }
    }
    return { finalised, blocked };
  }

  /** Changes a finalised result. Needs a reason and, with maker-checker on, a different administrator from the one who finalised it. */
  @Post('results/:id/override')
  @Require('results:override')
  async override(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const d = parse(z.object({ status: z.enum(STATUS), final_score: z.number().min(0).max(100).optional(), reason: z.string().trim().min(10).max(1000) }), body);
    return this.db.tx(async (q) => {
      const r = await q.one<any>('select * from results where id = $1 for update', [id]);
      if (!r) throw new NotFoundException();
      if (!r.finalised) throw new ConflictException('This result is not finalised yet. Recompute it instead.');
      if (d.status === 'pending') throw new BadRequestException('A finalised result cannot go back to pending');
      const t = await this.settings.training(q);
      if (t.enforce_maker_checker && r.finalised_by === u.id && u.role !== 'super_admin') {
        throw new ForbiddenException('A different administrator must approve a change to a result you finalised');
      }
      const after = await q.one<any>('update results set status = $2, final_score = coalesce($3, final_score) where id = $1 returning *', [id, d.status, d.final_score ?? null]);
      await q.query(
        `insert into result_changes (result_id, old_status, new_status, old_score, new_score, reason, changed_by) values ($1,$2,$3,$4,$5,$6,$7)`,
        [id, r.status, after.status, r.final_score, after.final_score, d.reason, u.id]);
      const en = await q.one<any>('select id, trainee_id from enrollments where id = $1', [r.enrollment_id]);
      if (r.status === 'pass' && d.status !== 'pass') {
        const live = await q.one<any>(`select id from certificates where enrollment_id = $1 and status = 'valid'`, [en.id]);
        if (live) await this.certs.revoke(q, live.id, actor, `Result changed to ${d.status}: ${d.reason}`);
      } else if (r.status !== 'pass' && d.status === 'pass') {
        await this.certs.issue(q, en.id, actor);
      }
      await this.audit.log(q, actor, 'result.override', 'result', id, { status: r.status, final_score: r.final_score }, { status: after.status, final_score: after.final_score, reason: d.reason });
      return after;
    });
  }

  /** Makes finalised results visible to trainees and their client administrators, and tells the trainees. */
  @Post('programmes/:id/results/release')
  @Require('results:finalise')
  async release(@Param('id') id: string, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    return this.db.tx(async (q) => {
      const rows = await q.query<any>(
        `update results r set released = true from enrollments e join programmes p on p.id = e.programme_id
          where e.id = r.enrollment_id and e.programme_id = $1 and r.finalised and not r.released
          returning r.id, r.status, e.trainee_id, e.id as enrollment_id, p.title`, [id]);
      for (const r of rows) {
        const cert = r.status === 'pass' ? await q.one<any>(`select number from certificates where enrollment_id = $1 and status = 'valid'`, [r.enrollment_id]) : null;
        await this.notify.notify({
          userId: r.trainee_id, kind: 'result.released', subject: `Your result: ${r.title}`,
          body: r.status === 'pass'
            ? `Congratulations, you passed "${r.title}". Your certificate ${cert?.number ?? ''} is available in the platform.`
            : `Your result for "${r.title}" is available in the platform. Contact your training administrator if you have questions.`,
        }, q);
      }
      await this.audit.log(q, actor, 'results.release', 'programme', id, null, { released: rows.length });
      return { released: rows.length };
    });
  }

  @Get('results/:id/changes')
  @Require('results:read')
  async changes(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    parse(uuid, id);
    if (!isStaff(u) && u.role !== 'auditor') throw new ForbiddenException();
    return this.db.query(
      `select c.*, x.full_name as changed_by_name from result_changes c join users x on x.id = c.changed_by where c.result_id = $1 order by c.changed_at desc`, [id]);
  }

  // ------------------------------------------------------------ internals

  private async assertProgrammeAccess(u: AuthUser, programmeId: string) {
    if (isStaff(u)) return;
    const ok = u.role === 'instructor' && (await this.db.one(
      `select 1 from programmes p where p.id = $1 and (p.lead_instructor_id = $2 or exists (select 1 from sessions s where s.programme_id = p.id and s.instructor_id = $2))`, [programmeId, u.id]));
    if (!ok) throw new NotFoundException();
  }

  private async finaliseOne(q: Q, u: AuthUser, actor: Actor, resultId: string, remarks?: string) {
    const r = await q.one<any>(
      `select r.*, e.id as enrollment_id, e.trainee_id, e.programme_id, p.end_date, p.status as pstatus
         from results r join enrollments e on e.id = r.enrollment_id join programmes p on p.id = e.programme_id where r.id = $1 for update of r`, [resultId]);
    if (!r) throw new NotFoundException();
    if (r.finalised) throw new ConflictException('Already finalised');
    // always finalise from fresh evidence, never from a stale computed row
    const fresh = await this.compute(q, r.enrollment_id);
    if (!fresh || fresh.status === 'pending') throw new ConflictException('This result is still pending: the programme has not ended or marking is incomplete');

    const t = await this.settings.training(q);
    if (t.enforce_maker_checker) {
      const marked = await q.one(
        `select 1 from exam_attempts x join assessments a on a.id = x.assessment_id
          where x.trainee_id = $1 and a.programme_id = $2 and (x.marked_by = $3 or exists (select 1 from attempt_answers aa where aa.attempt_id = x.id and aa.marked_by = $3)) limit 1`,
        [r.trainee_id, r.programme_id, u.id]);
      if (marked) throw new ForbiddenException('You marked this trainee\'s work, so another administrator must finalise the result');
    }

    const after = await q.one<any>(
      `update results set finalised = true, finalised_by = $2, finalised_at = now(), remarks = $3 where id = $1 returning *`, [resultId, u.id, remarks ?? null]);
    if (after.status === 'pass') await this.certs.issue(q, r.enrollment_id, actor);
    await this.audit.log(q, actor, 'result.finalise', 'result', resultId, { status: r.status }, { status: after.status, final_score: after.final_score, attendance_pct: after.attendance_pct });
    return after;
  }

  /** Evidence gathering around the pure decision rule. Skips finalised results. */
  private async compute(q: Q, enrollmentId: string) {
    const e = await q.one<any>(
      `select e.id, e.trainee_id, e.programme_id, e.status, p.status as pstatus, p.end_date, c.min_attendance_pct
         from enrollments e join programmes p on p.id = e.programme_id join courses c on c.id = p.course_id where e.id = $1`, [enrollmentId]);
    if (!e || !['confirmed', 'completed'].includes(e.status)) return null;
    await q.query('insert into results (enrollment_id) values ($1) on conflict do nothing', [enrollmentId]);
    const existing = await q.one<any>('select * from results where enrollment_id = $1 for update', [enrollmentId]);
    if (existing.finalised) return existing;

    const assessments = await q.query<any>(
      `select a.pass_mark,
              (select max(x.percentage) from exam_attempts x where x.assessment_id = a.id and x.trainee_id = $2 and x.status = 'marked') as best,
              (select count(*) from exam_attempts x where x.assessment_id = a.id and x.trainee_id = $2) as attempts
         from assessments a where a.programme_id = $1 and a.status in ('published','closed') and a.kind in ('exam','practical')`, [e.programme_id, e.trainee_id]);
    const att = (await attendanceStats(q, e.programme_id, e.trainee_id))[0];
    const ended = e.pstatus === 'completed' || e.end_date < new Date().toISOString().slice(0, 10);
    const decision = decideResult({
      assessments: assessments.map((a) => ({ pass_mark: a.pass_mark, best: a.best, attempts: a.attempts })),
      attendancePct: att?.attendance_pct ?? null, minAttendancePct: e.min_attendance_pct, programmeEnded: ended,
    });
    return q.one<any>('update results set status = $2, final_score = $3, attendance_pct = $4 where id = $1 returning *', [existing.id, decision.status, decision.score, att?.attendance_pct ?? null]);
  }
}

@Module({ controllers: [ResultsController] })
export class ResultsModule {}
