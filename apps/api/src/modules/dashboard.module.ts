import { Body, Controller, Get, Module, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { Public, CurrentUser, Require } from '../common/decorators';
import { AuthUser } from '../common/auth.types';
import { Db } from '../common/db.service';
import { SettingsService } from '../common/settings.service';
import { seesAllClients } from '../common/scope';
import { parse, uuid } from '../common/validation';
import { z } from 'zod';

interface Tile { key: string; label: string; value: number; total?: number; unit?: 'count' | 'money' | 'percent' | 'hours'; tone?: 'ok' | 'warn' | 'danger' }
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly db: Db, private readonly settings: SettingsService) {}

  /** Tiles and charts for the signed-in role. Every number is scoped to what that role may see. */
  @Get()
  async get(@CurrentUser() u: AuthUser) {
    const t = await this.settings.training();
    const soon = t.certificate_expiring_soon_days;
    switch (u.role) {
      case 'instructor': return this.instructor(u);
      case 'trainee': return this.trainee(u, soon);
      case 'org_admin': return this.client(u, soon);
      case 'finance_officer': return this.finance();
      default: return this.admin(u, soon);
    }
  }

  private async admin(u: AuthUser, soon: number) {
    const o = (sql: string, p: any[] = []) => this.db.one<any>(sql, p);
    const showMoney = ['super_admin', 'training_admin', 'auditor'].includes(u.role);
    const [a, b, c, money, byMonth, certByCat, byOrg, revenue] = await Promise.all([
      o(`select (select count(*) from users where role = 'trainee' and status <> 'suspended') as trainees,
                (select count(*) from courses where status = 'active') as courses,
                (select count(*) from courses) as all_courses,
                (select count(*) from programmes where status in ('open_for_registration','registration_closed') and start_date >= current_date) as upcoming,
                (select count(*) from programmes where status = 'ongoing') as ongoing,
                (select count(*) from programmes where status = 'completed' and end_date >= current_date - 365) as completed,
                (select count(*) from programmes where status <> 'cancelled' and status <> 'draft' and end_date >= current_date - 365) as all_recent`),
      o(`select (select count(*) from certificates where issued_at >= current_date - 365) as issued,
                (select count(*) from certificates where status = 'valid' and (expires_at is null or expires_at >= current_date)) as valid,
                (select count(*) from certificates where status = 'valid' and expires_at between current_date and current_date + $1::int) as expiring`, [soon]),
      o(`select count(*) filter (where r.status = 'pass') as passed, count(*) as decided,
                (select coalesce(sum(co.duration_hours), 0) from enrollments e join programmes p on p.id = e.programme_id join courses co on co.id = p.course_id
                  where e.status in ('confirmed','completed') and p.status in ('ongoing','completed')) as hours
           from results r where r.finalised and r.status in ('pass','fail','absent','disqualified')`),
      showMoney ? o(`select coalesce((select sum(amount) from payments where status = 'paid' and received_at >= date_trunc('year', now())), 0) as revenue,
                           coalesce((select sum(total - amount_paid) from invoices where status in ('pending','partially_paid')), 0) as outstanding`) : Promise.resolve(null),
      this.db.query(`select to_char(m, 'YYYY-MM') as month, coalesce(n, 0) as value from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m
                       left join (select date_trunc('month', created_at) as mm, count(*) n from enrollments where status <> 'cancelled' group by 1) x on x.mm = m order by m`),
      this.db.query(`select k.name as label, count(*) as value from certificates c join courses co on co.id = c.course_id join course_categories k on k.id = co.category_id where c.issued_at >= current_date - 365 group by k.name order by value desc limit 8`),
      this.db.query(`select coalesce(o.name, 'Individuals') as label, count(*) as value from users t left join organizations o on o.id = t.organization_id where t.role = 'trainee' and t.status <> 'suspended' group by 1 order by value desc limit 7`),
      showMoney ? this.db.query(`select to_char(m, 'YYYY-MM') as month, coalesce(p.amount, 0) as collected, coalesce(i.billed, 0) as billed
                       from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m
                       left join (select date_trunc('month', received_at) mm, sum(amount) amount from payments where status = 'paid' group by 1) p on p.mm = m
                       left join (select date_trunc('month', issue_date) mm, sum(total) billed from invoices where status <> 'cancelled' group by 1) i on i.mm = m order by m`) : Promise.resolve([]),
    ]);
    const tiles: Tile[] = [
      { key: 'trainees', label: 'Total trainees', value: a.trainees },
      { key: 'courses', label: 'Active courses', value: a.courses, total: a.all_courses },
      { key: 'upcoming', label: 'Upcoming training', value: a.upcoming },
      { key: 'ongoing', label: 'Ongoing training', value: a.ongoing },
      { key: 'completed', label: 'Completed (12 months)', value: a.completed, total: a.all_recent },
      { key: 'certificates_issued', label: 'Certificates issued (12 months)', value: b.issued },
      { key: 'certificates_expiring', label: `Expiring within ${soon} days`, value: b.expiring, total: b.valid, tone: b.expiring ? 'warn' : 'ok' },
      { key: 'pass_rate', label: 'Pass rate', value: pct(c.passed, c.decided), unit: 'percent' },
      { key: 'training_hours', label: 'Training hours delivered', value: Math.round(c.hours), unit: 'hours' },
      ...(money ? [
        { key: 'revenue', label: 'Revenue this year', value: money.revenue, unit: 'money' as const },
        { key: 'outstanding', label: 'Outstanding payments', value: money.outstanding, unit: 'money' as const, tone: money.outstanding > 0 ? ('warn' as const) : ('ok' as const) },
      ] : []),
    ];
    return { role: u.role, tiles, charts: { enrollments_by_month: byMonth, certificates_by_category: certByCat, trainees_by_organization: byOrg, revenue_by_month: revenue } };
  }

  private async instructor(u: AuthUser) {
    const [a, upcoming, performance] = await Promise.all([
      this.db.one<any>(
        `select (select count(*) from course_instructors where instructor_id = $1) as courses,
                (select count(distinct p.id) from programmes p where p.status in ('open_for_registration','registration_closed','ongoing') and (p.lead_instructor_id = $1 or exists (select 1 from sessions s where s.programme_id = p.id and s.instructor_id = $1))) as programmes,
                (select count(*) from sessions where instructor_id = $1 and starts_at between now() and now() + interval '14 days') as upcoming,
                (select count(distinct e.trainee_id) from enrollments e join programmes p on p.id = e.programme_id where e.status = 'confirmed' and (p.lead_instructor_id = $1 or exists (select 1 from sessions s where s.programme_id = p.id and s.instructor_id = $1))) as trainees,
                (select round(avg(r.attendance_pct), 1) from results r join enrollments e on e.id = r.enrollment_id join programmes p on p.id = e.programme_id where r.attendance_pct is not null and (p.lead_instructor_id = $1 or exists (select 1 from sessions s where s.programme_id = p.id and s.instructor_id = $1))) as attendance,
                (select count(*) from assessments a where a.status = 'published' and (a.created_by = $1 or exists (select 1 from programmes p where p.id = a.programme_id and (p.lead_instructor_id = $1 or exists (select 1 from sessions s where s.programme_id = p.id and s.instructor_id = $1))))) as assessments,
                (select count(*) from exam_attempts x join assessments a on a.id = x.assessment_id where x.status = 'submitted' and (a.created_by = $1 or exists (select 1 from programmes p where p.id = a.programme_id and (p.lead_instructor_id = $1 or exists (select 1 from sessions s where s.programme_id = p.id and s.instructor_id = $1))))) as pending_marking`, [u.id]),
      this.db.query(`select s.id, s.title, s.starts_at, s.ends_at, p.code as programme_code, r.name as classroom from sessions s join programmes p on p.id = s.programme_id left join classrooms r on r.id = s.classroom_id
                      where s.instructor_id = $1 and s.starts_at >= now() order by s.starts_at limit 8`, [u.id]),
      this.db.one<any>(`select round(avg(x.percentage), 1) as average from exam_attempts x join assessments a on a.id = x.assessment_id where x.status = 'marked' and a.created_by = $1`, [u.id]),
    ]);
    return {
      role: u.role,
      tiles: [
        { key: 'courses', label: 'Assigned courses', value: a.courses }, { key: 'programmes', label: 'Active programmes', value: a.programmes },
        { key: 'upcoming', label: 'Classes in the next 14 days', value: a.upcoming }, { key: 'trainees', label: 'Trainees', value: a.trainees },
        { key: 'attendance', label: 'Average attendance', value: a.attendance ?? 0, unit: 'percent' }, { key: 'assessments', label: 'Published assessments', value: a.assessments },
        { key: 'pending_marking', label: 'Waiting to be marked', value: a.pending_marking, tone: a.pending_marking ? 'warn' : 'ok' },
        { key: 'performance', label: 'Average trainee score', value: performance?.average ?? 0, unit: 'percent' },
      ] as Tile[],
      lists: { upcoming_sessions: upcoming },
    };
  }

  private async trainee(u: AuthUser, soon: number) {
    const [a, next, certs, learning] = await Promise.all([
      this.db.one<any>(
        `select (select count(*) from enrollments where trainee_id = $1 and status in ('pending','confirmed')) as active,
                (select count(*) from sessions s join enrollments e on e.programme_id = s.programme_id where e.trainee_id = $1 and e.status = 'confirmed' and s.starts_at between now() and now() + interval '14 days') as upcoming,
                (select count(*) from assessments a join enrollments e on e.programme_id = a.programme_id where e.trainee_id = $1 and e.status = 'confirmed' and a.status = 'published' and (a.closes_at is null or a.closes_at > now())
                    and (select count(*) from exam_attempts x where x.assessment_id = a.id and x.trainee_id = $1) < a.max_attempts) as assessments,
                (select count(*) from results r join enrollments e on e.id = r.enrollment_id where e.trainee_id = $1 and r.released) as results,
                (select count(*) from enrollments where trainee_id = $1 and status = 'completed') as history`, [u.id]),
      this.db.query(`select s.id, s.title, s.starts_at, s.ends_at, p.code as programme_code, p.title as programme_title, r.name as classroom, s.location
                       from sessions s join programmes p on p.id = s.programme_id join enrollments e on e.programme_id = s.programme_id and e.trainee_id = $1 and e.status = 'confirmed'
                       left join classrooms r on r.id = s.classroom_id where s.starts_at >= now() order by s.starts_at limit 6`, [u.id]),
      this.db.one<any>(`select count(*) filter (where ce.status = 'valid' and (ce.expires_at is null or ce.expires_at >= current_date)) as valid,
                               count(*) filter (where ce.status = 'valid' and ce.expires_at between current_date and current_date + $2::int) as expiring
                          from certificates ce join results r on r.enrollment_id = ce.enrollment_id and r.released where ce.trainee_id = $1`, [u.id, soon]),
      this.db.one<any>(`select count(l.id) as items, count(mp.material_id) filter (where mp.status = 'completed') as done
                          from enrollments e join programmes p on p.id = e.programme_id join course_modules m on m.course_id = p.course_id join learning_materials l on l.module_id = m.id and l.required
                          left join material_progress mp on mp.material_id = l.id and mp.trainee_id = e.trainee_id where e.trainee_id = $1 and e.status in ('confirmed','completed')`, [u.id]),
    ]);
    return {
      role: u.role,
      tiles: [
        { key: 'active', label: 'My training', value: a.active }, { key: 'upcoming', label: 'Classes in the next 14 days', value: a.upcoming },
        { key: 'progress', label: 'Course progress', value: pct(learning.done, learning.items), unit: 'percent' }, { key: 'assessments', label: 'Assessments to take', value: a.assessments, tone: a.assessments ? 'warn' : 'ok' },
        { key: 'results', label: 'Results', value: a.results }, { key: 'certificates', label: 'Valid certificates', value: certs.valid, total: certs.valid },
        { key: 'expiring', label: `Expiring within ${soon} days`, value: certs.expiring, tone: certs.expiring ? 'warn' : 'ok' }, { key: 'history', label: 'Completed training', value: a.history },
      ] as Tile[],
      lists: { upcoming_sessions: next },
    };
  }

  private async client(u: AuthUser, soon: number) {
    const org = u.organizationId;
    const [a, byCourse] = await Promise.all([
      this.db.one<any>(
        `select (select count(*) from users where organization_id = $1 and role = 'trainee' and status <> 'suspended') as employees,
                (select count(*) from enrollments e join users t on t.id = e.trainee_id where t.organization_id = $1 and e.status in ('pending','confirmed')) as active,
                (select count(*) from results r join enrollments e on e.id = r.enrollment_id join users t on t.id = e.trainee_id where t.organization_id = $1 and r.released and r.status = 'pass') as passed,
                (select count(*) from results r join enrollments e on e.id = r.enrollment_id join users t on t.id = e.trainee_id where t.organization_id = $1 and r.released) as decided,
                (select count(*) from certificates ce join users t on t.id = ce.trainee_id join results r on r.enrollment_id = ce.enrollment_id and r.released where t.organization_id = $1 and ce.status = 'valid' and (ce.expires_at is null or ce.expires_at >= current_date)) as valid,
                (select count(*) from certificates ce join users t on t.id = ce.trainee_id join results r on r.enrollment_id = ce.enrollment_id and r.released where t.organization_id = $1 and ce.status = 'valid' and ce.expires_at between current_date and current_date + $2::int) as expiring,
                (select coalesce(sum(total - amount_paid), 0) from invoices where (organization_id = $1) and status in ('pending','partially_paid')) as outstanding`, [org, soon]),
      this.db.query(`select co.title as label, count(*) as value from enrollments e join users t on t.id = e.trainee_id join programmes p on p.id = e.programme_id join courses co on co.id = p.course_id
                      where t.organization_id = $1 and e.status in ('confirmed','completed') group by co.title order by value desc limit 8`, [org]),
    ]);
    return {
      role: u.role,
      tiles: [
        { key: 'employees', label: 'Employees', value: a.employees }, { key: 'active', label: 'In training now', value: a.active },
        { key: 'passed', label: 'Passed', value: a.passed, total: a.decided }, { key: 'valid', label: 'Valid certificates', value: a.valid },
        { key: 'expiring', label: `Expiring within ${soon} days`, value: a.expiring, tone: a.expiring ? 'warn' : 'ok' }, { key: 'outstanding', label: 'Outstanding balance', value: a.outstanding, unit: 'money', tone: a.outstanding ? 'warn' : 'ok' },
      ] as Tile[],
      charts: { training_by_course: byCourse },
    };
  }

  private async finance() {
    const [a, byMonth, byStatus] = await Promise.all([
      this.db.one<any>(`select coalesce((select sum(amount) from payments where status = 'paid' and received_at >= date_trunc('month', now())), 0) as month_revenue,
                               coalesce((select sum(amount) from payments where status = 'paid' and received_at >= date_trunc('year', now())), 0) as year_revenue,
                               coalesce((select sum(total - amount_paid) from invoices where status in ('pending','partially_paid')), 0) as outstanding,
                               coalesce((select sum(total - amount_paid) from invoices where status in ('pending','partially_paid') and due_date < current_date), 0) as overdue,
                               (select count(*) from invoices where status in ('pending','partially_paid')) as open_invoices`),
      this.db.query(`select to_char(m, 'YYYY-MM') as month, coalesce(p.amount, 0) as collected, coalesce(i.billed, 0) as billed
                       from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m
                       left join (select date_trunc('month', received_at) mm, sum(amount) amount from payments where status = 'paid' group by 1) p on p.mm = m
                       left join (select date_trunc('month', issue_date) mm, sum(total) billed from invoices where status <> 'cancelled' group by 1) i on i.mm = m order by m`),
      this.db.query(`select status as label, count(*) as value from invoices group by status order by value desc`),
    ]);
    return {
      role: 'finance_officer',
      tiles: [
        { key: 'month_revenue', label: 'Collected this month', value: a.month_revenue, unit: 'money' }, { key: 'year_revenue', label: 'Collected this year', value: a.year_revenue, unit: 'money' },
        { key: 'outstanding', label: 'Outstanding', value: a.outstanding, unit: 'money', tone: a.outstanding ? 'warn' : 'ok' }, { key: 'overdue', label: 'Overdue', value: a.overdue, unit: 'money', tone: a.overdue ? 'danger' : 'ok' },
        { key: 'open_invoices', label: 'Open invoices', value: a.open_invoices },
      ] as Tile[],
      charts: { revenue_by_month: byMonth, invoices_by_status: byStatus },
    };
  }
}

@Controller()
export class SearchController {
  constructor(private readonly db: Db) {}

  /** One box, many record types. Each role only searches what it may open. */
  @Get('search')
  async search(@CurrentUser() u: AuthUser, @Query('q') raw?: string) {
    const q = (raw ?? '').trim();
    if (q.length < 2) return { query: q, groups: [] };
    const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
    const groups: { type: string; label: string; items: any[] }[] = [];
    const add = async (type: string, label: string, sql: string, params: any[]) => { const items = await this.db.query(sql, params); if (items.length) groups.push({ type, label, items }); };
    const staff = ['super_admin', 'training_admin', 'auditor'].includes(u.role);

    if (staff || u.role === 'org_admin') {
      const org = seesAllClients(u) ? null : u.organizationId;
      await add('trainee', 'Trainees', `select id, full_name as title, email as subtitle from users where role = 'trainee' and ($2::uuid is null or organization_id = $2) and (full_name ilike $1 or email ilike $1) order by full_name limit 5`, [like, org]);
    }
    if (staff) await add('instructor', 'Instructors', `select id, full_name as title, email as subtitle from users where role = 'instructor' and (full_name ilike $1 or email ilike $1) order by full_name limit 5`, [like]);
    if (staff || ['finance_officer'].includes(u.role)) await add('organization', 'Organisations', `select id, name as title, type as subtitle from organizations where name ilike $1 order by name limit 5`, [like]);
    if (u.role !== 'finance_officer') await add('course', 'Courses', `select id, title, code as subtitle from courses where (status = 'active' or $2) and (title ilike $1 or code ilike $1) order by title limit 5`, [like, staff]);
    if (staff) await add('programme', 'Programmes', `select id, title, code as subtitle from programmes where title ilike $1 or code ilike $1 order by start_date desc limit 5`, [like]);
    if (staff || u.role === 'org_admin') {
      const org = seesAllClients(u) ? null : u.organizationId;
      await add('certificate', 'Certificates', `select ce.id, ce.number as title, t.full_name as subtitle from certificates ce join users t on t.id = ce.trainee_id join results r on r.enrollment_id = ce.enrollment_id
                                                  where ($2::uuid is null or (t.organization_id = $2 and r.released)) and (ce.number ilike $1 or t.full_name ilike $1) order by ce.issued_at desc limit 5`, [like, org]);
    }
    if (['finance_officer', 'super_admin', 'training_admin', 'auditor'].includes(u.role)) await add('invoice', 'Invoices', `select id, number as title, status as subtitle from invoices where number ilike $1 order by issue_date desc limit 5`, [like]);
    return { query: q, groups };
  }
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly db: Db) {}

  @Get('mine')
  async mine(@CurrentUser() u: AuthUser) {
    const [items, unread] = await Promise.all([
      this.db.query(`select id, kind, subject, body, status, created_at from notifications where user_id = $1 and channel = 'in_app' order by created_at desc limit 50`, [u.id]),
      this.db.one<{ n: number }>(`select count(*) n from notifications where user_id = $1 and channel = 'in_app' and status <> 'read'`, [u.id]),
    ]);
    return { items, unread: unread!.n };
  }

  @Post('read-all')
  async readAll(@CurrentUser() u: AuthUser) {
    await this.db.query(`update notifications set status = 'read' where user_id = $1 and channel = 'in_app' and status <> 'read'`, [u.id]);
    return { ok: true };
  }

  @Post(':id/read')
  async read(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    parse(uuid, id);
    const r = await this.db.one(`update notifications set status = 'read' where id = $1 and user_id = $2 returning id`, [id, u.id]);
    if (!r) throw new NotFoundException();
    return { ok: true };
  }
}

@Controller('health')
export class HealthController {
  constructor(private readonly db: Db) {}

  @Public()
  @Get()
  async health() {
    try { await this.db.one('select 1'); return { status: 'ok' }; } catch { return { status: 'degraded', database: 'down' }; }
  }
}

@Module({ controllers: [DashboardController, SearchController, NotificationsController, HealthController] })
export class DashboardModule {}
