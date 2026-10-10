import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Module, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Actor, AuthUser } from '../common/auth.types';
import { AuditService } from '../common/audit.service';
import { Db, Q } from '../common/db.service';
import { ActorCtx, CurrentUser, Require } from '../common/decorators';
import { InvoicingService } from '../common/invoicing.service';
import { NotifyService } from '../common/notify.service';
import { SettingsService } from '../common/settings.service';
import { isStaff, seesAllClients } from '../common/scope';
import { pageQuery, parse, uuid } from '../common/validation';

const STATUSES = ['pending', 'confirmed', 'waitlisted', 'cancelled', 'completed', 'no_show'] as const;
const listQuery = pageQuery.extend({
  programme_id: uuid.optional(), trainee_id: uuid.optional(), organization_id: uuid.optional(), status: z.enum(STATUSES).optional(),
});

@Controller()
export class EnrollmentsController {
  constructor(
    private readonly db: Db, private readonly audit: AuditService, private readonly notify: NotifyService,
    private readonly invoicing: InvoicingService, private readonly settings: SettingsService,
  ) {}

  @Get('enrollments')
  @Require('enrollments:read')
  async list(@CurrentUser() u: AuthUser, @Query() query: unknown) {
    const f = parse(listQuery, query);
    const params: any[] = [];
    const where: string[] = [];
    const add = (sql: string, v: any) => { params.push(v); where.push(sql.replace(/\?/g, `$${params.length}`)); };
    if (u.role === 'trainee') add('e.trainee_id = ?', u.id);
    else if (u.role === 'org_admin') add('t.organization_id = ?', u.organizationId);
    else if (u.role === 'instructor') add(`(p.lead_instructor_id = ? or exists (select 1 from sessions s where s.programme_id = p.id and s.instructor_id = ?))`, u.id);
    if (f.programme_id) add('e.programme_id = ?', f.programme_id);
    if (f.trainee_id) add('e.trainee_id = ?', f.trainee_id);
    if (f.status) add('e.status = ?', f.status);
    if (f.organization_id && seesAllClients(u)) add('t.organization_id = ?', f.organization_id);
    if (f.q) add('(t.full_name ilike ? or t.email ilike ?)', `%${f.q}%`);
    const w = where.length ? `where ${where.join(' and ')}` : '';
    const data = await this.db.query(
      `select e.*, t.full_name as trainee_name, t.email as trainee_email, t.organization_id as trainee_organization_id, o.name as organization_name,
              p.code as programme_code, p.title as programme_title, p.start_date, p.end_date, p.fee, p.currency,
              i.status as invoice_status, i.id as invoice_id
         from enrollments e join users t on t.id = e.trainee_id join programmes p on p.id = e.programme_id
         left join organizations o on o.id = t.organization_id
         left join invoices i on i.enrollment_id = e.id and i.status <> 'cancelled'
         ${w} order by e.created_at desc limit ${f.limit} offset ${f.offset}`, params);
    const total = (await this.db.one<{ n: number }>(`select count(*) n from enrollments e join users t on t.id = e.trainee_id join programmes p on p.id = e.programme_id ${w}`, params))!.n;
    return { data, total };
  }

  @Post('enrollments')
  @Require('enrollments:write', 'courses:read')
  async register(@CurrentUser() u: AuthUser, @Body() body: unknown, @ActorCtx() actor: Actor) {
    const d = parse(z.object({ programme_id: uuid, trainee_id: uuid.optional() }), body);
    if (!['trainee', 'org_admin', 'super_admin', 'training_admin'].includes(u.role)) throw new ForbiddenException();
    const traineeId = u.role === 'trainee' ? u.id : d.trainee_id;
    if (!traineeId) throw new BadRequestException('Choose a trainee');
    if (u.role === 'trainee' && d.trainee_id && d.trainee_id !== u.id) throw new ForbiddenException('You can only register yourself');
    return this.db.tx((q) => this.enrol(q, u, actor, d.programme_id, traineeId));
  }

  /** Registers several trainees at once. Each succeeds or fails on its own; the response says which. */
  @Post('programmes/:id/enrol')
  @Require('enrollments:write', 'trainees:register')
  async enrolMany(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const { trainee_ids } = parse(z.object({ trainee_ids: z.array(uuid).min(1).max(200) }), body);
    if (u.role === 'trainee') throw new ForbiddenException();
    const enrolled: any[] = [];
    const failed: { trainee_id: string; reason: string }[] = [];
    for (const tid of new Set(trainee_ids)) {
      try { enrolled.push(await this.db.tx((q) => this.enrol(q, u, actor, id, tid))); }
      catch (e: any) { failed.push({ trainee_id: tid, reason: e.response?.message ?? e.message ?? 'failed' }); }
    }
    return { enrolled, failed };
  }

  @Post('enrollments/:id/confirm')
  @Require('enrollments:write')
  async confirm(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    if (!isStaff(u)) throw new ForbiddenException('Only training administrators confirm places');
    const { override_reason } = parse(z.object({ override_reason: z.string().trim().min(5).max(500).optional() }), body ?? {});
    return this.db.tx(async (q) => {
      const e = await q.one<any>(
        `select e.*, p.capacity, p.fee, p.title, p.code, p.status as programme_status
           from enrollments e join programmes p on p.id = e.programme_id where e.id = $1 for update of e`, [id]);
      if (!e) throw new NotFoundException();
      if (e.status === 'confirmed') return e;
      if (e.status !== 'pending') throw new ConflictException(`A ${e.status} registration cannot be confirmed`);
      if (['cancelled', 'completed', 'draft'].includes(e.programme_status)) throw new ConflictException('This programme is not accepting confirmations');

      const taken = await q.one<{ n: number }>(`select count(*) n from enrollments where programme_id = $1 and status = 'confirmed'`, [e.programme_id]);
      if (taken!.n >= e.capacity) throw new ConflictException('The programme is full');

      const fin = await this.settings.finance(q);
      if (fin.require_payment_before_confirmation && e.fee > 0 && !e.sponsor_organization_id) {
        const paid = await q.one(`select 1 from invoices where enrollment_id = $1 and status = 'paid'`, [id]);
        if (!paid && !override_reason) throw new ConflictException({ statusCode: 409, message: 'Payment has not been received. Give an override reason to confirm anyway.', code: 'PAYMENT_REQUIRED' });
      }
      const after = await q.one<any>(
        `update enrollments set status = 'confirmed', confirmed_by = $2, confirmed_at = now() where id = $1 returning *`, [id, u.id]);
      await q.query(`insert into results (enrollment_id) values ($1) on conflict do nothing`, [id]);
      await this.audit.log(q, actor, 'enrollment.confirm', 'enrollment', id, { status: e.status }, { status: 'confirmed', override_reason });
      await this.notify.notify({ userId: e.trainee_id, kind: 'enrollment.confirmed', subject: `Your place is confirmed: ${e.title}`,
        body: `Your place on "${e.title}" (${e.code}) is confirmed. Log in to see the schedule and learning materials.` }, q);
      return after;
    });
  }

  @Post('enrollments/:id/cancel')
  @Require('enrollments:read')
  async cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(500) }), body);
    return this.db.tx(async (q) => {
      const e = await q.one<any>(
        `select e.*, t.organization_id as trainee_org, p.title, p.code, p.start_date from enrollments e
           join users t on t.id = e.trainee_id join programmes p on p.id = e.programme_id where e.id = $1 for update of e`, [id]);
      if (!e) throw new NotFoundException();
      const mine = u.role === 'trainee' ? e.trainee_id === u.id : u.role === 'org_admin' ? e.trainee_org === u.organizationId : isStaff(u);
      if (!mine) throw new NotFoundException();
      if (['cancelled', 'completed'].includes(e.status)) throw new ConflictException(`This registration is already ${e.status}`);
      if (u.role !== 'super_admin' && u.role !== 'training_admin' && e.start_date <= new Date().toISOString().slice(0, 10)) {
        throw new ConflictException('The programme has started. Ask a training administrator to cancel.');
      }
      const wasHolding = e.status === 'confirmed' || e.status === 'pending';
      const after = await q.one('update enrollments set status = $2, cancel_reason = $3 where id = $1 returning *', [id, 'cancelled', reason]);
      // an unpaid invoice is cancelled; a paid one is left for Finance to refund deliberately
      await q.query(`update invoices set status = 'cancelled' where enrollment_id = $1 and status = 'pending' and amount_paid = 0`, [id]);
      await this.audit.log(q, actor, 'enrollment.cancel', 'enrollment', id, { status: e.status }, { status: 'cancelled', reason });
      if (wasHolding) await this.promoteWaitlist(q, e.programme_id, actor);
      return after;
    });
  }

  // ------------------------------------------------------------ internals

  private async enrol(q: Q, u: AuthUser, actor: Actor, programmeId: string, traineeId: string) {
    const p = await q.one<any>(
      `select p.*, c.title as course_title, c.status as course_status from programmes p join courses c on c.id = p.course_id where p.id = $1 for update of p`, [programmeId]);
    if (!p) throw new NotFoundException('Programme not found');
    const t = await q.one<any>('select id, full_name, role, status, organization_id from users where id = $1', [traineeId]);
    if (!t || t.role !== 'trainee') throw new BadRequestException('That person is not a trainee');
    if (t.status === 'suspended') throw new BadRequestException(`${t.full_name} is suspended`);

    // an instructor may register people, but only on a programme they teach
    if (u.role === 'instructor' && p.lead_instructor_id !== u.id && !(await q.one('select 1 from sessions where programme_id = $1 and instructor_id = $2 limit 1', [programmeId, u.id]))) {
      throw new ForbiddenException('You can only register trainees on programmes you teach');
    }
    const staff = isStaff(u) || u.role === 'instructor';
    if (u.role === 'org_admin' && t.organization_id !== u.organizationId) throw new NotFoundException('Trainee not found');
    if (p.organization_id && t.organization_id !== p.organization_id && !isStaff(u)) throw new ForbiddenException('This programme is reserved for another organisation');
    if (staff ? !['open_for_registration', 'registration_closed', 'ongoing'].includes(p.status) : p.status !== 'open_for_registration') {
      throw new ConflictException('Registration is not open for this programme');
    }
    const today = new Date().toISOString().slice(0, 10);
    if (!staff && p.registration_deadline && today > p.registration_deadline) throw new ConflictException('The registration deadline has passed');

    // prerequisites: each must be held as a live certificate
    const missing = await q.query<{ code: string; title: string }>(
      `select c.code, c.title from course_prerequisites pr join courses c on c.id = pr.prerequisite_id
        where pr.course_id = $1 and not exists (
          select 1 from certificates ce where ce.trainee_id = $2 and ce.course_id = pr.prerequisite_id and ce.status = 'valid'
             and (ce.expires_at is null or ce.expires_at >= current_date))`, [p.course_id, traineeId]);
    if (missing.length) throw new ConflictException(`Prerequisites not met: ${missing.map((m) => m.code).join(', ')}`);

    const existing = await q.one<any>('select * from enrollments where programme_id = $1 and trainee_id = $2 for update', [programmeId, traineeId]);
    if (existing && existing.status !== 'cancelled') throw new ConflictException('Already registered for this programme');

    const held = await q.one<{ n: number }>(`select count(*) n from enrollments where programme_id = $1 and status in ('confirmed','pending')`, [programmeId]);
    const status = held!.n >= p.capacity ? 'waitlisted' : 'pending';
    const sponsor = u.role === 'org_admin' ? u.organizationId : (p.organization_id ?? null);

    const row = existing
      ? await q.one<any>(`update enrollments set status=$2, cancel_reason=null, sponsor_organization_id=$3, registered_by=$4, confirmed_at=null, confirmed_by=null, created_at=now() where id=$1 returning *`, [existing.id, status, sponsor, u.id])
      : await q.one<any>(`insert into enrollments (programme_id, trainee_id, status, sponsor_organization_id, registered_by) values ($1,$2,$3,$4,$5) returning *`, [programmeId, traineeId, status, sponsor, u.id]);
    if (status === 'pending') await this.invoicing.createForEnrollment(q, row, u.id);
    await this.audit.log(q, actor, 'enrollment.register', 'enrollment', row.id, null, row);
    await this.notify.notify({ userId: traineeId, kind: 'enrollment.registered',
      subject: status === 'waitlisted' ? `Waitlisted: ${p.title}` : `Registration received: ${p.title}`,
      body: status === 'waitlisted'
        ? `"${p.title}" is full, so you are on the waiting list. We will tell you if a place opens.`
        : `We have received your registration for "${p.title}" (${p.code}). You will be told when your place is confirmed.` }, q);
    return row;
  }

  private async promoteWaitlist(q: Q, programmeId: string, actor: Actor) {
    const p = await q.one<any>('select capacity, title from programmes where id = $1', [programmeId]);
    const held = await q.one<{ n: number }>(`select count(*) n from enrollments where programme_id = $1 and status in ('confirmed','pending')`, [programmeId]);
    if (!p || held!.n >= p.capacity) return;
    const next = await q.one<any>(`select * from enrollments where programme_id = $1 and status = 'waitlisted' order by created_at limit 1 for update skip locked`, [programmeId]);
    if (!next) return;
    const row = await q.one<any>(`update enrollments set status = 'pending' where id = $1 returning *`, [next.id]);
    await this.invoicing.createForEnrollment(q, row, null);
    await this.audit.log(q, actor, 'enrollment.waitlist_promoted', 'enrollment', next.id, { status: 'waitlisted' }, { status: 'pending' });
    await this.notify.notify({ userId: next.trainee_id, kind: 'enrollment.promoted', subject: `A place has opened: ${p.title}`,
      body: `A place has opened on "${p.title}". Your registration is now pending confirmation.` }, q);
  }
}

@Module({ controllers: [EnrollmentsController] })
export class EnrollmentsModule {}
