import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Module, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Actor, AuthUser } from '../common/auth.types';
import { AuditService } from '../common/audit.service';
import { Db, Q } from '../common/db.service';
import { ActorCtx, CurrentUser, Require } from '../common/decorators';
import { NotifyService } from '../common/notify.service';
import { isStaff, seesAllClients } from '../common/scope';
import { isoDate, isoDateTime, pageQuery, parse, uuid } from '../common/validation';

const STATUSES = ['draft', 'open_for_registration', 'registration_closed', 'ongoing', 'completed', 'cancelled'] as const;
const TRANSITIONS: Record<string, string[]> = {
  draft: ['open_for_registration', 'cancelled'],
  open_for_registration: ['registration_closed', 'cancelled'],
  registration_closed: ['open_for_registration', 'ongoing', 'cancelled'],
  ongoing: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

const programmeBody = z.object({
  course_id: uuid,
  title: z.string().trim().min(3).max(200).optional(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{2,29}$/).optional(),
  start_date: isoDate,
  end_date: isoDate,
  location: z.string().trim().max(300).nullish(),
  classroom_id: uuid.nullish(),
  delivery_method: z.enum(['classroom', 'online', 'blended', 'practical']).optional(),
  lead_instructor_id: uuid.nullish(),
  capacity: z.number().int().min(1).max(1000).optional(),
  registration_deadline: isoDate.nullish(),
  fee: z.number().min(0).max(1e8).optional(),
  organization_id: uuid.nullish(),
});
const sessionBody = z.object({
  title: z.string().trim().min(2).max(200),
  kind: z.enum(['class', 'exam', 'practical']).default('class'),
  starts_at: isoDateTime,
  ends_at: isoDateTime,
  instructor_id: uuid.nullish(),
  classroom_id: uuid.nullish(),
  location: z.string().trim().max(300).nullish(),
});
const listQuery = pageQuery.extend({
  status: z.enum(STATUSES).optional(),
  course_id: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  organization_id: uuid.optional(),
});
const scheduleQuery = z.object({
  from: isoDate, to: isoDate,
  instructor_id: uuid.optional(), classroom_id: uuid.optional(), programme_id: uuid.optional(),
});

@Controller()
export class ProgrammesController {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly notify: NotifyService) {}

  // ------------------------------------------------------------ classrooms

  @Get('classrooms')
  @Require('programmes:read')
  classrooms() {
    return this.db.query('select * from classrooms order by name');
  }

  @Post('classrooms')
  @Require('programmes:write')
  async createClassroom(@Body() body: unknown, @ActorCtx() actor: Actor) {
    const d = parse(z.object({ name: z.string().trim().min(2).max(100), location: z.string().trim().max(300).nullish(), capacity: z.number().int().min(1).max(1000) }), body);
    return this.db.tx(async (q) => {
      const row = await q.one('insert into classrooms (name, location, capacity) values ($1,$2,$3) returning *', [d.name, d.location ?? null, d.capacity]);
      await this.audit.log(q, actor, 'classroom.create', 'classroom', row.id, null, row);
      return row;
    });
  }

  @Patch('classrooms/:id')
  @Require('programmes:write')
  async updateClassroom(@Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const d = parse(z.object({ name: z.string().trim().min(2).max(100), location: z.string().trim().max(300).nullable(), capacity: z.number().int().min(1).max(1000), active: z.boolean() }).partial(), body);
    return this.db.tx(async (q) => {
      const before = await q.one<any>('select * from classrooms where id = $1 for update', [id]);
      if (!before) throw new NotFoundException();
      const m = { ...before, ...d };
      const after = await q.one('update classrooms set name=$2, location=$3, capacity=$4, active=$5 where id=$1 returning *', [id, m.name, m.location, m.capacity, m.active]);
      await this.audit.log(q, actor, 'classroom.update', 'classroom', id, before, after);
      return after;
    });
  }

  // ------------------------------------------------------------ programmes

  @Get('programmes')
  @Require('programmes:read')
  async list(@CurrentUser() u: AuthUser, @Query() query: unknown) {
    const f = parse(listQuery, query);
    const params: any[] = [];
    const where: string[] = [];
    const add = (sql: string, v: any) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };

    if (u.role === 'trainee') {
      params.push(u.id, u.organizationId);
      where.push(`((p.status = 'open_for_registration' and (p.organization_id is null or p.organization_id = $${params.length}))
                   or exists (select 1 from enrollments e where e.programme_id = p.id and e.trainee_id = $${params.length - 1}))`);
    } else if (u.role === 'org_admin') {
      add(`(p.organization_id is null or p.organization_id = ?)`, u.organizationId);
      where.push(`p.status <> 'draft'`);
    } else if (u.role === 'instructor') {
      add(`(p.lead_instructor_id = ? or exists (select 1 from sessions s where s.programme_id = p.id and s.instructor_id = ?))`, u.id);
      where[where.length - 1] = where[where.length - 1].replace('?', `$${params.length}`);
    }
    if (f.status) add('p.status = ?', f.status);
    if (f.course_id) add('p.course_id = ?', f.course_id);
    if (f.from) add('p.end_date >= ?', f.from);
    if (f.to) add('p.start_date <= ?', f.to);
    if (f.organization_id && seesAllClients(u)) add('p.organization_id = ?', f.organization_id);
    if (f.q) add(`(p.title ilike ? or p.code ilike ?)`, `%${f.q}%`), (where[where.length - 1] = where[where.length - 1].replace('?', `$${params.length}`));
    const w = where.length ? `where ${where.join(' and ')}` : '';
    const data = await this.db.query(
      `select p.*, c.code as course_code, c.title as course_title, i.full_name as lead_instructor_name, o.name as organization_name,
              (select count(*) from enrollments e where e.programme_id = p.id and e.status in ('confirmed','completed')) as confirmed_count,
              (select count(*) from enrollments e where e.programme_id = p.id and e.status = 'pending') as pending_count,
              (select count(*) from enrollments e where e.programme_id = p.id and e.status = 'waitlisted') as waitlist_count
         from programmes p join courses c on c.id = p.course_id
         left join users i on i.id = p.lead_instructor_id left join organizations o on o.id = p.organization_id
         ${w} order by p.start_date desc, p.code limit ${f.limit} offset ${f.offset}`, params);
    const total = (await this.db.one<{ n: number }>(`select count(*) n from programmes p ${w}`, params))!.n;
    return { data, total };
  }

  @Get('programmes/:id')
  @Require('programmes:read')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    parse(uuid, id);
    const p = await this.visible(u, id);
    const sessions = await this.db.query(
      `select s.id, s.title, s.kind, s.starts_at, s.ends_at, s.location, s.instructor_id, i.full_name as instructor_name,
              s.classroom_id, r.name as classroom_name
         from sessions s left join users i on i.id = s.instructor_id left join classrooms r on r.id = s.classroom_id
        where s.programme_id = $1 order by s.starts_at`, [id]);
    return { ...p, sessions };
  }

  @Post('programmes')
  @Require('programmes:write')
  async create(@CurrentUser() u: AuthUser, @Body() body: unknown, @ActorCtx() actor: Actor) {
    const d = parse(programmeBody, body);
    if (d.end_date < d.start_date) throw new BadRequestException('The end date is before the start date');
    if (d.registration_deadline && d.registration_deadline > d.start_date) throw new BadRequestException('Registration must close on or before the start date');
    return this.db.tx(async (q) => {
      const course = await q.one<any>('select * from courses where id = $1', [d.course_id]);
      if (!course) throw new BadRequestException('Unknown course');
      if (course.status === 'archived') throw new BadRequestException('This course is archived');
      await this.checkResources(q, d.classroom_id ?? null, d.lead_instructor_id ?? null, d.course_id, d.capacity ?? course.capacity);
      if (d.organization_id && !(await q.one('select 1 from organizations where id = $1', [d.organization_id]))) throw new BadRequestException('Unknown organisation');
      const code = d.code ?? (await this.nextCode(q, course.code, d.start_date.slice(0, 4)));
      const row = await q.one(
        `insert into programmes (code, course_id, title, start_date, end_date, location, classroom_id, delivery_method, lead_instructor_id,
            capacity, registration_deadline, fee, currency, organization_id, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
        [code, d.course_id, d.title ?? `${course.title} ${d.start_date.slice(0, 7)}`, d.start_date, d.end_date, d.location ?? null, d.classroom_id ?? null,
          d.delivery_method ?? course.delivery_method, d.lead_instructor_id ?? null, d.capacity ?? course.capacity, d.registration_deadline ?? null,
          d.fee ?? course.fee, course.currency, d.organization_id ?? null, u.id]);
      await this.audit.log(q, actor, 'programme.create', 'programme', row.id, null, row);
      return row;
    });
  }

  @Patch('programmes/:id')
  @Require('programmes:write')
  async update(@Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const d = parse(programmeBody.omit({ course_id: true, code: true }).partial(), body);
    return this.db.tx(async (q) => {
      const before = await q.one<any>('select * from programmes where id = $1 for update', [id]);
      if (!before) throw new NotFoundException();
      if (['completed', 'cancelled'].includes(before.status)) throw new ConflictException(`A ${before.status} programme cannot be edited`);
      const m = { ...before, ...Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v ?? null])) } as any;
      if (m.end_date < m.start_date) throw new BadRequestException('The end date is before the start date');
      if (d.fee !== undefined && d.fee !== before.fee && (await q.one(`select 1 from enrollments where programme_id = $1 and status <> 'cancelled' limit 1`, [id]))) {
        throw new ConflictException('The fee cannot change once trainees have registered');
      }
      if (d.capacity !== undefined) {
        const taken = await q.one<{ n: number }>(`select count(*) n from enrollments where programme_id = $1 and status in ('confirmed','pending')`, [id]);
        if (d.capacity < taken!.n) throw new ConflictException(`${taken!.n} places are already taken`);
      }
      await this.checkResources(q, m.classroom_id, m.lead_instructor_id, before.course_id, m.capacity);
      const after = await q.one(
        `update programmes set title=$2,start_date=$3,end_date=$4,location=$5,classroom_id=$6,delivery_method=$7,lead_instructor_id=$8,
            capacity=$9,registration_deadline=$10,fee=$11,organization_id=$12 where id=$1 returning *`,
        [id, m.title, m.start_date, m.end_date, m.location, m.classroom_id, m.delivery_method, m.lead_instructor_id, m.capacity, m.registration_deadline, m.fee, m.organization_id]);
      await this.audit.log(q, actor, 'programme.update', 'programme', id, before, after);
      return after;
    });
  }

  @Post('programmes/:id/status')
  @Require('programmes:write')
  async setStatus(@Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const { status, reason } = parse(z.object({ status: z.enum(STATUSES), reason: z.string().trim().min(3).max(500).optional() }), body);
    return this.db.tx(async (q) => {
      const p = await q.one<any>('select p.*, c.status as course_status, c.title as course_title from programmes p join courses c on c.id = p.course_id where p.id = $1 for update of p', [id]);
      if (!p) throw new NotFoundException();
      if (!TRANSITIONS[p.status].includes(status)) throw new ConflictException(`A programme cannot move from ${p.status} to ${status}`);
      if (status === 'open_for_registration' && p.course_status !== 'active') throw new ConflictException('The course must be active before registration opens');
      if (status === 'cancelled' && !reason) throw new BadRequestException('Give a reason for cancelling');

      const after = await q.one('update programmes set status = $2 where id = $1 returning *', [id, status]);
      if (status === 'cancelled') {
        const affected = await q.query<any>(
          `update enrollments set status = 'cancelled', cancel_reason = $2 where programme_id = $1 and status in ('pending','confirmed','waitlisted') returning id, trainee_id`,
          [id, `Programme cancelled: ${reason}`]);
        await q.query(`update invoices set status = 'cancelled' where programme_id = $1 and status = 'pending' and amount_paid = 0`, [id]);
        for (const e of affected) {
          await this.notify.notify({ userId: e.trainee_id, kind: 'programme.cancelled', subject: `Cancelled: ${p.title}`,
            body: `The programme "${p.title}" (${p.code}) has been cancelled. Reason: ${reason}\n\nIf you paid, our finance team will contact you.` }, q);
        }
      }
      if (status === 'completed') {
        await q.query(`update enrollments set status = 'completed' where programme_id = $1 and status = 'confirmed'`, [id]);
      }
      await this.audit.log(q, actor, `programme.${status}`, 'programme', id, { status: p.status }, { status, reason });
      return after;
    });
  }

  // ------------------------------------------------------------ sessions

  @Get('programmes/:id/sessions')
  @Require('programmes:read')
  async sessions(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    parse(uuid, id);
    await this.visible(u, id);
    return this.db.query(
      `select s.id, s.title, s.kind, s.starts_at, s.ends_at, s.location, s.instructor_id, i.full_name as instructor_name, s.classroom_id, r.name as classroom_name
         from sessions s left join users i on i.id = s.instructor_id left join classrooms r on r.id = s.classroom_id
        where s.programme_id = $1 order by s.starts_at`, [id]);
  }

  @Post('programmes/:id/sessions')
  @Require('programmes:write')
  async addSession(@Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const d = parse(sessionBody, body);
    return this.db.tx(async (q) => {
      const row = await this.writeSession(q, null, id, d);
      await this.audit.log(q, actor, 'session.create', 'session', row.id, null, row);
      return row;
    });
  }

  @Patch('sessions/:id')
  @Require('programmes:write')
  async updateSession(@Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const d = parse(sessionBody.partial(), body);
    return this.db.tx(async (q) => {
      const before = await q.one<any>('select * from sessions where id = $1 for update', [id]);
      if (!before) throw new NotFoundException();
      const merged = {
        title: d.title ?? before.title, kind: d.kind ?? before.kind,
        starts_at: d.starts_at ?? new Date(before.starts_at).toISOString(), ends_at: d.ends_at ?? new Date(before.ends_at).toISOString(),
        instructor_id: d.instructor_id === undefined ? before.instructor_id : d.instructor_id,
        classroom_id: d.classroom_id === undefined ? before.classroom_id : d.classroom_id,
        location: d.location === undefined ? before.location : d.location,
      };
      const row = await this.writeSession(q, id, before.programme_id, merged);
      await this.audit.log(q, actor, 'session.update', 'session', id, before, row);
      return row;
    });
  }

  @Delete('sessions/:id')
  @Require('programmes:write')
  async deleteSession(@Param('id') id: string, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    return this.db.tx(async (q) => {
      if (await q.one('select 1 from attendance where session_id = $1 limit 1', [id])) throw new ConflictException('Attendance has been recorded for this session, so it cannot be deleted');
      const row = await q.one('delete from sessions where id = $1 returning *', [id]);
      if (!row) throw new NotFoundException();
      await this.audit.log(q, actor, 'session.delete', 'session', id, row, null);
      return { ok: true };
    });
  }

  // ------------------------------------------------------------ calendar

  @Get('schedule')
  @Require('programmes:read')
  async schedule(@CurrentUser() u: AuthUser, @Query() query: unknown) {
    const f = parse(scheduleQuery, query);
    const params: any[] = [f.from, f.to];
    const where = [`s.starts_at >= $1::date`, `s.starts_at < ($2::date + 1)`, `p.status <> 'cancelled'`];
    const add = (sql: string, v: any) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (f.instructor_id) add('s.instructor_id = ?', f.instructor_id);
    if (f.classroom_id) add('s.classroom_id = ?', f.classroom_id);
    if (f.programme_id) add('s.programme_id = ?', f.programme_id);
    if (u.role === 'trainee') add(`exists (select 1 from enrollments e where e.programme_id = p.id and e.trainee_id = ? and e.status in ('confirmed','completed'))`, u.id);
    else if (u.role === 'org_admin') add(`(p.organization_id = ? or exists (select 1 from enrollments e join users t on t.id = e.trainee_id where e.programme_id = p.id and t.organization_id = ?))`, u.organizationId);
    else if (u.role === 'instructor') add(`(s.instructor_id = ? or p.lead_instructor_id = ?)`, u.id);
    // the placeholder replacement above only fills the first '?'; fix the doubled ones
    for (let i = 0; i < where.length; i++) where[i] = where[i].replace(/\?/g, `$${params.length}`);
    return this.db.query(
      `select s.id, s.title, s.kind, s.starts_at, s.ends_at, s.location, s.programme_id, p.code as programme_code, p.title as programme_title,
              s.instructor_id, i.full_name as instructor_name, s.classroom_id, r.name as classroom_name
         from sessions s join programmes p on p.id = s.programme_id
         left join users i on i.id = s.instructor_id left join classrooms r on r.id = s.classroom_id
        where ${where.join(' and ')} order by s.starts_at limit 1000`, params);
  }

  // ------------------------------------------------------------ helpers

  private async visible(u: AuthUser, id: string) {
    const p = await this.db.one<any>(
      `select p.*, c.code as course_code, c.title as course_title, c.pass_mark, c.min_attendance_pct, c.validity_months,
              i.full_name as lead_instructor_name, o.name as organization_name,
              (select count(*) from enrollments e where e.programme_id = p.id and e.status in ('confirmed','completed')) as confirmed_count,
              p.capacity - (select count(*) from enrollments e where e.programme_id = p.id and e.status in ('confirmed','pending','completed')) as seats_left
         from programmes p join courses c on c.id = p.course_id
         left join users i on i.id = p.lead_instructor_id left join organizations o on o.id = p.organization_id where p.id = $1`, [id]);
    if (!p) throw new NotFoundException();
    if (isStaff(u) || u.role === 'auditor' || u.role === 'finance_officer') return p;
    if (u.role === 'trainee') {
      const mine = await this.db.one('select 1 from enrollments where programme_id = $1 and trainee_id = $2', [id, u.id]);
      if (mine || (p.status === 'open_for_registration' && (!p.organization_id || p.organization_id === u.organizationId))) return p;
    } else if (u.role === 'org_admin') {
      if (p.status !== 'draft' && (!p.organization_id || p.organization_id === u.organizationId)) return p;
    } else if (u.role === 'instructor') {
      const mine = p.lead_instructor_id === u.id || (await this.db.one('select 1 from sessions where programme_id = $1 and instructor_id = $2 limit 1', [id, u.id]));
      if (mine) return p;
    }
    throw new NotFoundException();
  }

  private async nextCode(q: Q, courseCode: string, year: string) {
    const n = await q.one<{ n: number }>(`select count(*) n from programmes p join courses c on c.id = p.course_id where c.code = $1 and to_char(p.start_date,'YYYY') = $2`, [courseCode, year]);
    return `${courseCode}-${year}-${String(n!.n + 1).padStart(2, '0')}`;
  }

  private async checkResources(q: Q, classroomId: string | null, instructorId: string | null, courseId: string, capacity: number) {
    if (classroomId) {
      const r = await q.one<any>('select * from classrooms where id = $1', [classroomId]);
      if (!r || !r.active) throw new BadRequestException('That classroom is not available');
      if (r.capacity < capacity) throw new BadRequestException(`${r.name} seats ${r.capacity}, fewer than the programme capacity of ${capacity}`);
    }
    if (instructorId) await this.checkInstructor(q, instructorId, courseId, null);
  }

  /** Instructor must be active, authorised for the course (when an authorised list exists) and in date. */
  private async checkInstructor(q: Q, instructorId: string, courseId: string, onDate: string | null) {
    const i = await q.one<any>(
      `select u.status, p.accreditation_expiry from users u left join instructor_profiles p on p.user_id = u.id where u.id = $1 and u.role = 'instructor'`, [instructorId]);
    if (!i || i.status === 'suspended') throw new BadRequestException('That person is not an active instructor');
    const listed = await q.one<{ n: number }>('select count(*) n from course_instructors where course_id = $1', [courseId]);
    if (listed!.n > 0 && !(await q.one('select 1 from course_instructors where course_id = $1 and instructor_id = $2', [courseId, instructorId]))) {
      throw new BadRequestException('This instructor is not authorised to teach this course');
    }
    if (i.accreditation_expiry && i.accreditation_expiry < (onDate ?? new Date().toISOString().slice(0, 10))) {
      throw new BadRequestException('This instructor\'s accreditation has expired');
    }
  }

  private async writeSession(q: Q, sessionId: string | null, programmeId: string, d: z.infer<typeof sessionBody>) {
    const p = await q.one<any>('select * from programmes where id = $1 for update', [programmeId]);
    if (!p) throw new NotFoundException('Programme not found');
    if (['completed', 'cancelled'].includes(p.status)) throw new ConflictException(`A ${p.status} programme cannot be scheduled`);
    const start = new Date(d.starts_at);
    const end = new Date(d.ends_at);
    if (!(end > start)) throw new BadRequestException('The session must end after it starts');
    const day = start.toISOString().slice(0, 10);
    if (day < p.start_date || end.toISOString().slice(0, 10) > p.end_date) throw new BadRequestException(`Sessions must fall between ${p.start_date} and ${p.end_date}`);

    if (d.instructor_id) await this.checkInstructor(q, d.instructor_id, p.course_id, day);
    if (d.classroom_id) {
      const r = await q.one<any>('select * from classrooms where id = $1', [d.classroom_id]);
      if (!r || !r.active) throw new BadRequestException('That classroom is not available');
    }

    // Name the clash for the user. The database exclusion constraints remain the final guard against races.
    const clashes = await q.query<any>(
      `select s.id, s.title, s.starts_at, s.ends_at, p2.code as programme_code,
              case when s.programme_id = $1 then 'programme'
                   when s.instructor_id is not null and s.instructor_id = $5 then 'instructor'
                   else 'classroom' end as kind
         from sessions s join programmes p2 on p2.id = s.programme_id
        where ($6::uuid is null or s.id <> $6) and tstzrange(s.starts_at, s.ends_at) && tstzrange($2::timestamptz, $3::timestamptz)
          and (s.programme_id = $1 or (s.instructor_id is not null and s.instructor_id = $5) or (s.classroom_id is not null and s.classroom_id = $4))`,
      [programmeId, d.starts_at, d.ends_at, d.classroom_id ?? null, d.instructor_id ?? null, sessionId]);
    if (clashes.length) {
      throw new ConflictException({
        statusCode: 409,
        message: 'This time clashes with an existing booking',
        conflicts: clashes.map((c) => ({ kind: c.kind, session: c.title, programme: c.programme_code, starts_at: c.starts_at, ends_at: c.ends_at })),
      });
    }

    const args = [programmeId, d.title, d.kind, d.starts_at, d.ends_at, d.instructor_id ?? null, d.classroom_id ?? null, d.location ?? null];
    return sessionId
      ? q.one('update sessions set programme_id=$2,title=$3,kind=$4,starts_at=$5,ends_at=$6,instructor_id=$7,classroom_id=$8,location=$9 where id=$1 returning id,programme_id,title,kind,starts_at,ends_at,instructor_id,classroom_id,location', [sessionId, ...args])
      : q.one('insert into sessions (programme_id,title,kind,starts_at,ends_at,instructor_id,classroom_id,location) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id,programme_id,title,kind,starts_at,ends_at,instructor_id,classroom_id,location', args);
  }
}

@Module({ controllers: [ProgrammesController] })
export class ProgrammesModule {}
