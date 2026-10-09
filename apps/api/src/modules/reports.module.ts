import { BadRequestException, Controller, ForbiddenException, Get, Module, NotFoundException, Param, Query, Res, StreamableFile } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import { Actor, AuthUser } from '../common/auth.types';
import { AuditService } from '../common/audit.service';
import { Db } from '../common/db.service';
import { ActorCtx, CurrentUser, Require } from '../common/decorators';
import { Role } from '../common/permissions';
import { seesAllClients } from '../common/scope';
import { SettingsService } from '../common/settings.service';
import { csvEscape } from '../common/util';
import { isoDate, parse, uuid } from '../common/validation';
import { gapsSql } from './compliance.module';

interface Ctx { u: AuthUser; from?: string; to?: string; programme_id?: string; course_id?: string; org?: string; soonDays: number }
interface Built { sql: string; params: any[] }
interface ReportDef { key: string; title: string; description: string; roles: Role[]; columns: { key: string; label: string }[]; build: (c: Ctx) => Built }

const STAFF: Role[] = ['super_admin', 'training_admin', 'auditor'];

/** Small helper so every report builds its WHERE clause the same safe, parameterised way. */
function w() {
  const params: any[] = [];
  const where: string[] = [];
  return { params, where, add(sql: string, v: any) { params.push(v); where.push(sql.replace(/\?/g, `$${params.length}`)); }, clause: () => (where.length ? `where ${where.join(' and ')}` : '') };
}

const REPORTS: ReportDef[] = [
  {
    key: 'training', title: 'Training summary', description: 'Every programme with numbers enrolled, passed and the pass rate.', roles: [...STAFF, 'instructor', 'org_admin'],
    columns: [{ key: 'code', label: 'Programme' }, { key: 'title', label: 'Title' }, { key: 'course', label: 'Course' }, { key: 'start_date', label: 'Start' }, { key: 'end_date', label: 'End' }, { key: 'status', label: 'Status' }, { key: 'enrolled', label: 'Enrolled' }, { key: 'passed', label: 'Passed' }, { key: 'not_passed', label: 'Not passed' }, { key: 'pass_rate', label: 'Pass rate %' }, { key: 'training_hours', label: 'Hours' }],
    build: (c) => {
      const q = w();
      if (c.from) q.add('p.end_date >= ?', c.from);
      if (c.to) q.add('p.start_date <= ?', c.to);
      if (c.programme_id) q.add('p.id = ?', c.programme_id);
      if (c.course_id) q.add('p.course_id = ?', c.course_id);
      if (c.u.role === 'instructor') q.add(`(p.lead_instructor_id = ? or exists (select 1 from sessions s where s.programme_id = p.id and s.instructor_id = ?))`, c.u.id);
      const org = c.org ? (q.params.push(c.org), `$${q.params.length}`) : null;
      return { params: q.params, sql: `
        select p.code, p.title, co.title as course, p.start_date, p.end_date, p.status,
               count(e.id) filter (where e.status in ('confirmed','completed') ${org ? `and t.organization_id = ${org}` : ''}) as enrolled,
               count(r.id) filter (where r.status = 'pass' and r.finalised ${org ? `and t.organization_id = ${org}` : ''}) as passed,
               count(r.id) filter (where r.status in ('fail','absent','disqualified') and r.finalised ${org ? `and t.organization_id = ${org}` : ''}) as not_passed,
               round(100.0 * count(r.id) filter (where r.status = 'pass' and r.finalised ${org ? `and t.organization_id = ${org}` : ''})
                 / nullif(count(r.id) filter (where r.finalised ${org ? `and t.organization_id = ${org}` : ''}), 0), 1) as pass_rate,
               co.duration_hours as training_hours
          from programmes p join courses co on co.id = p.course_id left join enrollments e on e.programme_id = p.id
          left join users t on t.id = e.trainee_id left join results r on r.enrollment_id = e.id ${q.clause()}
         group by p.id, co.id order by p.start_date desc` };
    },
  },
  {
    key: 'attendance', title: 'Attendance', description: 'Attendance per trainee against the course minimum.', roles: [...STAFF, 'instructor', 'org_admin'],
    columns: [{ key: 'trainee', label: 'Trainee' }, { key: 'organization', label: 'Organisation' }, { key: 'programme', label: 'Programme' }, { key: 'attendance_pct', label: 'Attendance %' }, { key: 'minimum', label: 'Minimum %' }, { key: 'meets_minimum', label: 'Meets minimum' }],
    build: (c) => {
      const q = w();
      q.where.push(`r.attendance_pct is not null`);
      if (c.from) q.add('p.end_date >= ?', c.from);
      if (c.to) q.add('p.start_date <= ?', c.to);
      if (c.programme_id) q.add('p.id = ?', c.programme_id);
      if (c.org) q.add('t.organization_id = ?', c.org);
      if (c.u.role === 'instructor') q.add(`(p.lead_instructor_id = ? or exists (select 1 from sessions s where s.programme_id = p.id and s.instructor_id = ?))`, c.u.id);
      return { params: q.params, sql: `
        select t.full_name as trainee, o.name as organization, p.code as programme, r.attendance_pct, co.min_attendance_pct as minimum,
               case when r.attendance_pct >= co.min_attendance_pct then 'Yes' else 'No' end as meets_minimum
          from results r join enrollments e on e.id = r.enrollment_id join users t on t.id = e.trainee_id join programmes p on p.id = e.programme_id
          join courses co on co.id = p.course_id left join organizations o on o.id = t.organization_id ${q.clause()} order by p.start_date desc, t.full_name` };
    },
  },
  {
    key: 'completion', title: 'Course completion', description: 'Enrolment and completion by course.', roles: [...STAFF, 'org_admin'],
    columns: [{ key: 'course_code', label: 'Code' }, { key: 'course', label: 'Course' }, { key: 'enrolled', label: 'Enrolled' }, { key: 'completed', label: 'Completed' }, { key: 'passed', label: 'Passed' }, { key: 'completion_rate', label: 'Completion %' }],
    build: (c) => {
      const q = w();
      if (c.from) q.add('p.end_date >= ?', c.from);
      if (c.to) q.add('p.start_date <= ?', c.to);
      if (c.course_id) q.add('co.id = ?', c.course_id);
      if (c.org) q.add('t.organization_id = ?', c.org);
      q.where.push(`e.status in ('confirmed','completed')`);
      return { params: q.params, sql: `
        select co.code as course_code, co.title as course, count(e.id) as enrolled,
               count(e.id) filter (where r.finalised) as completed, count(e.id) filter (where r.finalised and r.status = 'pass') as passed,
               round(100.0 * count(e.id) filter (where r.finalised) / nullif(count(e.id), 0), 1) as completion_rate
          from enrollments e join users t on t.id = e.trainee_id join programmes p on p.id = e.programme_id join courses co on co.id = p.course_id
          left join results r on r.enrollment_id = e.id ${q.clause()} group by co.id order by co.title` };
    },
  },
  {
    key: 'performance', title: 'Assessment performance', description: 'Average score and pass rate by assessment.', roles: [...STAFF, 'instructor'],
    columns: [{ key: 'assessment', label: 'Assessment' }, { key: 'programme', label: 'Programme' }, { key: 'attempts', label: 'Marked attempts' }, { key: 'average', label: 'Average %' }, { key: 'pass_mark', label: 'Pass mark %' }, { key: 'pass_rate', label: 'Pass rate %' }],
    build: (c) => {
      const q = w();
      q.where.push(`x.status = 'marked'`);
      if (c.programme_id) q.add('a.programme_id = ?', c.programme_id);
      if (c.course_id) q.add('a.course_id = ?', c.course_id);
      if (c.from) q.add('x.submitted_at >= ?::date', c.from);
      if (c.to) q.add('x.submitted_at < (?::date + 1)', c.to);
      if (c.u.role === 'instructor') q.add(`(a.created_by = ? or exists (select 1 from programmes pp where pp.id = a.programme_id and (pp.lead_instructor_id = ? or exists (select 1 from sessions s where s.programme_id = pp.id and s.instructor_id = ?))))`, c.u.id);
      return { params: q.params, sql: `
        select a.title as assessment, p.code as programme, count(*) as attempts, round(avg(x.percentage), 1) as average, a.pass_mark,
               round(100.0 * count(*) filter (where x.percentage >= a.pass_mark) / count(*), 1) as pass_rate
          from exam_attempts x join assessments a on a.id = x.assessment_id left join programmes p on p.id = a.programme_id ${q.clause()} group by a.id, p.code order by a.title` };
    },
  },
  {
    key: 'instructors', title: 'Instructor activity', description: 'Sessions and hours delivered by each instructor.', roles: STAFF,
    columns: [{ key: 'instructor', label: 'Instructor' }, { key: 'type', label: 'Employment' }, { key: 'sessions', label: 'Sessions' }, { key: 'hours', label: 'Hours' }, { key: 'programmes', label: 'Programmes' }],
    build: (c) => {
      const q = w();
      q.where.push(`s.ends_at <= now()`);
      if (c.from) q.add('s.starts_at >= ?::date', c.from);
      if (c.to) q.add('s.starts_at < (?::date + 1)', c.to);
      return { params: q.params, sql: `
        select u.full_name as instructor, ip.employment_type as type, count(s.id) as sessions, round(sum(extract(epoch from (s.ends_at - s.starts_at)) / 3600)::numeric, 1) as hours,
               count(distinct s.programme_id) as programmes
          from sessions s join users u on u.id = s.instructor_id left join instructor_profiles ip on ip.user_id = u.id ${q.clause()} group by u.id, ip.employment_type order by hours desc` };
    },
  },
  {
    key: 'certificates', title: 'Certificates', description: 'Certificates issued, with their current status.', roles: [...STAFF, 'org_admin'],
    columns: [{ key: 'number', label: 'Number' }, { key: 'trainee', label: 'Holder' }, { key: 'organization', label: 'Organisation' }, { key: 'course', label: 'Course' }, { key: 'issued_at', label: 'Issued' }, { key: 'expires_at', label: 'Expires' }, { key: 'status', label: 'Status' }],
    build: (c) => {
      const q = w();
      q.params.push(c.soonDays);
      if (c.from) q.add('ce.issued_at >= ?', c.from);
      if (c.to) q.add('ce.issued_at <= ?', c.to);
      if (c.course_id) q.add('ce.course_id = ?', c.course_id);
      if (c.org) { q.add('t.organization_id = ?', c.org); q.where.push('r.released'); }
      return { params: q.params, sql: `
        select ce.number, t.full_name as trainee, o.name as organization, co.title as course, ce.issued_at, ce.expires_at,
               case when ce.status = 'revoked' then 'revoked' when ce.expires_at < current_date then 'expired' when ce.expires_at <= current_date + $1::int then 'expiring soon' else 'valid' end as status
          from certificates ce join users t on t.id = ce.trainee_id join courses co on co.id = ce.course_id left join organizations o on o.id = t.organization_id
          join results r on r.enrollment_id = ce.enrollment_id ${q.clause()} order by ce.issued_at desc, ce.number desc` };
    },
  },
  {
    key: 'financial', title: 'Invoices and payments', description: 'Invoices raised in the period and what has been paid.', roles: ['super_admin', 'training_admin', 'finance_officer', 'auditor', 'org_admin'],
    columns: [{ key: 'number', label: 'Invoice' }, { key: 'client', label: 'Client' }, { key: 'programme', label: 'Programme' }, { key: 'issue_date', label: 'Issued' }, { key: 'due_date', label: 'Due' }, { key: 'total', label: 'Total' }, { key: 'amount_paid', label: 'Paid' }, { key: 'balance', label: 'Balance' }, { key: 'status', label: 'Status' }],
    build: (c) => {
      const q = w();
      if (c.from) q.add('i.issue_date >= ?', c.from);
      if (c.to) q.add('i.issue_date <= ?', c.to);
      if (c.programme_id) q.add('i.programme_id = ?', c.programme_id);
      if (c.org) q.add('(i.organization_id = ? or t.organization_id = ?)', c.org);
      return { params: q.params, sql: `
        select i.number, coalesce(o.name, t.full_name) as client, p.code as programme, i.issue_date, i.due_date, i.total, i.amount_paid, (i.total - i.amount_paid) as balance, i.status
          from invoices i left join organizations o on o.id = i.organization_id left join users t on t.id = i.trainee_id left join programmes p on p.id = i.programme_id ${q.clause()} order by i.issue_date desc, i.number desc` };
    },
  },
  {
    key: 'outstanding', title: 'Outstanding balances', description: 'What each client owes, and how much is overdue.', roles: ['super_admin', 'training_admin', 'finance_officer', 'auditor', 'org_admin'],
    columns: [{ key: 'client', label: 'Client' }, { key: 'open_invoices', label: 'Open invoices' }, { key: 'billed', label: 'Billed' }, { key: 'paid', label: 'Paid' }, { key: 'balance', label: 'Balance' }, { key: 'overdue', label: 'Overdue' }],
    build: (c) => {
      const q = w();
      q.where.push(`i.status in ('pending','partially_paid')`);
      if (c.org) q.add('(i.organization_id = ? or t.organization_id = ?)', c.org);
      return { params: q.params, sql: `
        select coalesce(o.name, t.full_name) as client, count(*) as open_invoices, sum(i.total) as billed, sum(i.amount_paid) as paid, sum(i.total - i.amount_paid) as balance,
               coalesce(sum(i.total - i.amount_paid) filter (where i.due_date < current_date), 0) as overdue
          from invoices i left join organizations o on o.id = i.organization_id left join users t on t.id = i.trainee_id ${q.clause()} group by coalesce(o.name, t.full_name) order by balance desc` };
    },
  },
  {
    key: 'compliance', title: 'Compliance gaps', description: 'Required training that is missing, lapsing or expired.', roles: [...STAFF, 'org_admin'],
    columns: [{ key: 'full_name', label: 'Trainee' }, { key: 'organization_name', label: 'Organisation' }, { key: 'course_code', label: 'Course' }, { key: 'issue', label: 'Issue' }, { key: 'certificate_number', label: 'Certificate' }, { key: 'expires_at', label: 'Expires' }],
    build: (c) => {
      const params: any[] = [c.soonDays];
      let orgP: string | undefined; let courseP: string | undefined;
      if (c.org) { params.push(c.org); orgP = `$${params.length}`; }
      if (c.course_id) { params.push(c.course_id); courseP = `$${params.length}`; }
      return { params, sql: `select * from (${gapsSql({ soonParam: '$1', orgParam: orgP, courseParam: courseP })}) g order by organization_name nulls last, full_name` };
    },
  },
];

const filters = z.object({ from: isoDate.optional(), to: isoDate.optional(), programme_id: uuid.optional(), course_id: uuid.optional(), organization_id: uuid.optional(), format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json') });

@Controller('reports')
export class ReportsController {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly settings: SettingsService) {}

  @Get()
  @Require('reports:read')
  list(@CurrentUser() u: AuthUser) {
    return REPORTS.filter((r) => r.roles.includes(u.role)).map(({ key, title, description, columns }) => ({ key, title, description, columns }));
  }

  @Get(':key')
  @Require('reports:read')
  async run(@CurrentUser() u: AuthUser, @Param('key') key: string, @Query() raw: unknown, @Res({ passthrough: true }) res: any, @ActorCtx() actor: Actor) {
    const def = REPORTS.find((r) => r.key === key);
    if (!def) throw new NotFoundException();
    if (!def.roles.includes(u.role)) throw new ForbiddenException('This report is not available to your role');
    const f = parse(filters, raw);
    const t = await this.settings.training();
    // client administrators are pinned to their own organisation whatever they ask for
    const org = seesAllClients(u) ? f.organization_id : u.organizationId ?? undefined;
    const built = def.build({ u, from: f.from, to: f.to, programme_id: f.programme_id, course_id: f.course_id, org, soonDays: t.certificate_expiring_soon_days });
    const rows = await this.db.query<Record<string, any>>(built.sql, built.params);
    if (f.format === 'json') return { key: def.key, title: def.title, columns: def.columns, rows, generated_at: new Date().toISOString() };

    await this.audit.log(null, actor, 'report.export', 'report', key, null, { format: f.format, rows: rows.length, filters: { from: f.from, to: f.to, organization_id: org } });
    const name = `${def.key}-${new Date().toISOString().slice(0, 10)}`;
    if (f.format === 'csv') {
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"` });
      return new StreamableFile(Buffer.from('﻿' + [def.columns.map((c) => csvEscape(c.label)).join(','), ...rows.map((r) => def.columns.map((c) => csvEscape(r[c.key])).join(','))].join('\n'), 'utf8'));
    }
    if (f.format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(def.title.slice(0, 31));
      ws.columns = def.columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 4) }));
      ws.getRow(1).font = { bold: true };
      for (const r of rows) ws.addRow(Object.fromEntries(def.columns.map((c) => [c.key, typeof r[c.key] === 'string' && /^[=+\-@]/.test(r[c.key]) ? `'${r[c.key]}` : r[c.key]])));
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${name}.xlsx"` });
      return new StreamableFile(Buffer.from(await wb.xlsx.writeBuffer()));
    }
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}.pdf"` });
    return new StreamableFile(await this.pdf(def, rows));
  }

  private pdf(def: ReportDef, rows: Record<string, any>[]): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#0a0c0f').text(def.title);
    doc.font('Helvetica').fontSize(8).fillColor('#5a6470').text(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`).moveDown(0.8);
    const width = doc.page.width - 72;
    const colW = width / def.columns.length;
    const head = () => {
      const y = doc.y;
      doc.rect(36, y, width, 18).fill('#f1eee8');
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0a0c0f');
      def.columns.forEach((c, i) => doc.text(c.label, 40 + i * colW, y + 5, { width: colW - 6, lineBreak: false }));
      doc.y = y + 22;
    };
    head();
    doc.font('Helvetica').fontSize(7.5).fillColor('#0a0c0f');
    for (const r of rows) {
      if (doc.y > doc.page.height - 50) { doc.addPage(); head(); doc.font('Helvetica').fontSize(7.5).fillColor('#0a0c0f'); }
      const y = doc.y;
      def.columns.forEach((c, i) => doc.text(r[c.key] == null ? '' : String(r[c.key]).slice(0, 60), 40 + i * colW, y, { width: colW - 6, lineBreak: false }));
      doc.y = y + 14;
    }
    doc.end();
    return done;
  }
}

@Module({ controllers: [ReportsController] })
export class ReportsModule {}
