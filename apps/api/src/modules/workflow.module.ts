import { Controller, Get, Module, NotFoundException, Param } from '@nestjs/common';
import { AuthUser } from '../common/auth.types';
import { Db } from '../common/db.service';
import { CurrentUser, Require } from '../common/decorators';
import { permissionsFor } from '../common/permissions';
import { isStaff, requireOrgScope } from '../common/scope';
import { parse, uuid } from '../common/validation';

/**
 * "What needs doing next". Two read-only views that turn the data we already hold into a short list of next steps:
 * a to-do list for each role's home page, and a close-out checklist for one programme. They change nothing themselves;
 * every action they point to goes through the same endpoints, and the same permissions, as before.
 */

interface Todo { key: string; label: string; count: number; href: string; hint: string; tone: 'warn' | 'info' }

@Controller()
export class WorkflowController {
  constructor(private readonly db: Db) {}

  @Get('dashboard/todo')
  async todo(@CurrentUser() u: AuthUser) {
    const n = async (sql: string, p: any[] = []) => Number((await this.db.one<{ n: number }>(sql, p))?.n ?? 0);
    const items: Todo[] = [];
    const add = (i: Omit<Todo, 'tone' | 'count'> & { tone?: Todo['tone'] }, count: number) => { if (count > 0) items.push({ tone: 'warn', ...i, count }); };
    // attempts with written answers that still need a person
    const unmarkedSql = (scope: string) =>
      `select count(distinct x.id) n from exam_attempts x join assessments a on a.id = x.assessment_id
        where x.status = 'submitted' and exists (select 1 from attempt_answers aa where aa.attempt_id = x.id and aa.needs_manual and aa.marked_by is null) ${scope}`;

    if (isStaff(u)) {
      add({ key: 'requests', label: 'Account requests waiting for a decision', href: '/registrations', hint: 'Approve or reject each one.' },
        await n(`select count(*) n from registration_requests where status = 'pending'`));
      add({ key: 'pending_places', label: 'Places waiting to be confirmed', href: '/enrolments', hint: 'Confirm the place, or wait for payment if that rule is on.' },
        await n(`select count(*) n from enrollments e join programmes p on p.id = e.programme_id where e.status = 'pending' and p.status not in ('cancelled','completed')`));
      add({ key: 'marking', label: 'Attempts waiting to be marked', href: '/marking', hint: 'Written answers need a person.' }, await n(unmarkedSql('')));
      add({ key: 'ended_open', label: 'Programmes that have ended but are not marked completed', href: '/programmes', hint: 'Completing a programme calculates its results.' },
        await n(`select count(*) n from programmes where status in ('open_for_registration','registration_closed','ongoing') and end_date < current_date`));
      add({ key: 'ready', label: 'Results ready to finalise', href: '/results', hint: 'Open the programme: its Results tab has the close-out checklist.' },
        await n(`select count(*) n from results where not finalised and status <> 'pending'`));
      add({ key: 'unreleased', label: 'Finalised results not yet released to trainees', href: '/results', hint: 'Trainees see nothing until you release them.', tone: 'info' },
        await n(`select count(*) n from results where finalised and not released`));
      add({ key: 'draft_soon', label: 'Draft programmes starting within 14 days', href: '/programmes', hint: 'Open registration so people can sign up.' },
        await n(`select count(*) n from programmes where status = 'draft' and start_date <= current_date + 14 and start_date >= current_date`));
      add({ key: 'expiring', label: 'Certificates expiring within 60 days', href: '/certificates', hint: 'Remind the holders or their employers.', tone: 'info' },
        await n(`select count(*) n from certificates where status = 'valid' and expires_at between current_date and current_date + 60`));
    } else if (u.role === 'instructor') {
      const mine = `(p.lead_instructor_id = $1 or exists (select 1 from sessions s where s.programme_id = p.id and s.instructor_id = $1))`;
      add({ key: 'marking', label: 'Attempts waiting for you to mark', href: '/marking', hint: 'Written answers need a person.' },
        await n(unmarkedSql(`and (a.created_by = $1 or exists (select 1 from programmes p where p.id = a.programme_id and ${mine}))`), [u.id]));
      add({ key: 'attendance', label: 'Recent sessions with no attendance recorded', href: '/attendance', hint: 'Attendance counts towards every result.' },
        await n(`select count(*) n from sessions s join programmes p on p.id = s.programme_id
                  where (s.instructor_id = $1 or p.lead_instructor_id = $1) and s.kind in ('class','practical') and s.ends_at < now() and s.ends_at > now() - interval '14 days'
                    and not exists (select 1 from attendance a where a.session_id = s.id)`, [u.id]));
      add({ key: 'today', label: 'Sessions today', href: '/attendance', hint: 'Show the QR code on the screen, or mark the roster.', tone: 'info' },
        await n(`select count(*) n from sessions s join programmes p on p.id = s.programme_id
                  where (s.instructor_id = $1 or p.lead_instructor_id = $1) and s.starts_at::date = current_date`, [u.id]));
      if (permissionsFor({ role: u.role, can_finalise_results: u.canFinalise }).has('results:finalise')) {
        add({ key: 'ready', label: 'Results ready to finalise', href: '/results', hint: 'On programmes you lead or teach.' },
          await n(`select count(*) n from results r join enrollments e on e.id = r.enrollment_id join programmes p on p.id = e.programme_id where not r.finalised and r.status <> 'pending' and ${mine}`, [u.id]));
      }
    } else if (u.role === 'finance_officer') {
      add({ key: 'overdue', label: 'Overdue invoices', href: '/invoices', hint: 'Follow up with the client or trainee.' },
        await n(`select count(*) n from invoices where status in ('pending','partially_paid') and due_date < current_date`));
      add({ key: 'unpaid', label: 'Invoices waiting for payment', href: '/invoices', hint: 'Record payments as they arrive.', tone: 'info' },
        await n(`select count(*) n from invoices where status in ('pending','partially_paid') and due_date >= current_date`));
    } else if (u.role === 'org_admin') {
      const org = requireOrgScope(u);
      add({ key: 'pending_places', label: 'Your staff places waiting for HAAB to confirm', href: '/enrolments', hint: 'HAAB confirms places; nothing for you to do yet.', tone: 'info' },
        await n(`select count(*) n from enrollments e join users t on t.id = e.trainee_id where t.organization_id = $1 and e.status = 'pending'`, [org]));
      add({ key: 'expiring', label: 'Staff certificates expiring within 60 days', href: '/certificates', hint: 'Book them onto a renewal programme.' },
        await n(`select count(*) n from certificates c join users t on t.id = c.trainee_id join results r on r.enrollment_id = c.enrollment_id
                  where t.organization_id = $1 and r.released and c.status = 'valid' and c.expires_at between current_date and current_date + 60`, [org]));
    } else if (u.role === 'trainee') {
      add({ key: 'exams', label: 'Assessments you can take now', href: '/exams', hint: 'Each one is timed, so start when you are ready.' },
        await n(`select count(*) n from assessments a join enrollments e on e.programme_id = a.programme_id and e.trainee_id = $1 and e.status in ('confirmed','completed')
                  where a.status = 'published' and (a.opens_at is null or a.opens_at <= now()) and (a.closes_at is null or a.closes_at > now())
                    and (select count(*) from exam_attempts x where x.assessment_id = a.id and x.trainee_id = $1 and x.status <> 'in_progress') < a.max_attempts`, [u.id]));
      add({ key: 'pending', label: 'Registrations waiting for HAAB to confirm', href: '/enrolments', hint: 'You will be told when your place is confirmed.', tone: 'info' },
        await n(`select count(*) n from enrollments where trainee_id = $1 and status = 'pending'`, [u.id]));
      add({ key: 'expiring', label: 'Certificates expiring within 60 days', href: '/certificates', hint: 'Register for a renewal programme.' },
        await n(`select count(*) n from certificates c join results r on r.enrollment_id = c.enrollment_id where c.trainee_id = $1 and r.released and c.status = 'valid' and c.expires_at between current_date and current_date + 60`, [u.id]));
    }
    return { items };
  }

  /** The close-out checklist for one programme: where it stands and the single next step. */
  @Get('programmes/:id/closeout')
  @Require('results:read')
  async closeout(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    parse(uuid, id);
    const p = await this.db.one<any>('select id, code, title, status, end_date, lead_instructor_id from programmes where id = $1', [id]);
    if (!p) throw new NotFoundException();
    if (!isStaff(u)) {
      const mine = u.role === 'instructor' && (p.lead_instructor_id === u.id || (await this.db.one('select 1 from sessions where programme_id = $1 and instructor_id = $2 limit 1', [id, u.id])));
      if (!mine) throw new NotFoundException();
    }
    const c = await this.db.one<any>(
      `select (select count(*) from enrollments where programme_id = $1 and status in ('confirmed','completed'))::int as trainees,
              (select count(*) from sessions where programme_id = $1 and kind in ('class','practical') and ends_at <= now())::int as held,
              (select count(*) from sessions s where s.programme_id = $1 and s.kind in ('class','practical') and s.ends_at <= now() and exists (select 1 from attendance a where a.session_id = s.id))::int as held_recorded,
              (select count(*) from assessments where programme_id = $1 and status in ('published','closed') and kind in ('exam','practical'))::int as assessments,
              (select count(distinct x.id) from exam_attempts x join assessments a on a.id = x.assessment_id where a.programme_id = $1 and x.status = 'submitted')::int as awaiting_marking,
              (select count(*) from exam_attempts x join assessments a on a.id = x.assessment_id where a.programme_id = $1 and x.status = 'in_progress')::int as in_progress,
              (select count(*) from enrollments e where e.programme_id = $1 and e.status in ('confirmed','completed') and not exists (select 1 from results r where r.enrollment_id = e.id))::int as not_calculated,
              (select count(*) from results r join enrollments e on e.id = r.enrollment_id where e.programme_id = $1 and r.status = 'pass')::int as pass,
              (select count(*) from results r join enrollments e on e.id = r.enrollment_id where e.programme_id = $1 and r.status in ('fail','absent','disqualified'))::int as fail,
              (select count(*) from results r join enrollments e on e.id = r.enrollment_id where e.programme_id = $1 and r.status = 'pending')::int as pending,
              (select count(*) from results r join enrollments e on e.id = r.enrollment_id where e.programme_id = $1 and not r.finalised and r.status <> 'pending')::int as ready,
              (select count(*) from results r join enrollments e on e.id = r.enrollment_id where e.programme_id = $1 and r.finalised and not r.released)::int as unreleased,
              (select count(*) from results r join enrollments e on e.id = r.enrollment_id where e.programme_id = $1 and r.released)::int as released`, [id]);
    const today = new Date().toISOString().slice(0, 10);
    const ended = p.status === 'completed' || String(p.end_date).slice(0, 10) < today;
    type State = 'done' | 'todo' | 'waiting';
    const steps: { key: string; label: string; state: State; detail: string }[] = [];
    steps.push({
      key: 'complete', label: 'Programme completed', state: ended ? 'done' : 'todo',
      detail: ended ? (p.status === 'completed' ? 'Marked completed.' : 'The end date has passed.') : p.status === 'ongoing' ? 'Mark it completed when the training is over. This calculates every result.' : 'Start the programme first, then mark it completed when the training is over.',
    });
    steps.push({
      key: 'attendance', label: 'Attendance recorded', state: c.held === 0 ? 'waiting' : c.held_recorded >= c.held ? 'done' : 'todo',
      detail: c.held === 0 ? 'No class has been held yet, so attendance does not count against anyone.' : `${c.held_recorded} of ${c.held} sessions held have attendance recorded.`,
    });
    steps.push({
      key: 'marking', label: 'Assessments marked', state: c.assessments === 0 ? 'waiting' : c.awaiting_marking === 0 && c.in_progress === 0 ? 'done' : 'todo',
      detail: c.assessments === 0 ? 'No exam is set for this programme.' : c.awaiting_marking > 0 ? `${c.awaiting_marking} attempt${c.awaiting_marking === 1 ? '' : 's'} waiting to be marked.` : c.in_progress > 0 ? `${c.in_progress} attempt${c.in_progress === 1 ? ' is' : 's are'} still in progress.` : 'Everything submitted has been marked.',
    });
    const needCalc = ended && (c.not_calculated > 0 || (c.pending > 0 && c.awaiting_marking === 0 && c.in_progress === 0));
    steps.push({
      key: 'calculate', label: 'Results calculated', state: !ended ? 'waiting' : needCalc ? 'todo' : 'done',
      detail: !ended ? 'Results are worked out once the programme has ended.' : needCalc ? `${c.not_calculated + c.pending} result${c.not_calculated + c.pending === 1 ? '' : 's'} not calculated yet. Select Recalculate results.` : `${c.pass} passed, ${c.fail} did not pass.`,
    });
    steps.push({
      key: 'finalise', label: 'Results finalised', state: c.ready > 0 ? 'todo' : c.trainees > 0 && c.unreleased + c.released >= c.trainees - c.pending ? 'done' : 'waiting',
      detail: c.ready > 0 ? `${c.ready} result${c.ready === 1 ? '' : 's'} ready to finalise. Whoever marked someone's work cannot finalise it.` : c.unreleased + c.released > 0 ? 'Finalised. A pass has its certificate.' : 'Nothing to finalise yet.',
    });
    steps.push({
      key: 'release', label: 'Released to trainees', state: c.unreleased > 0 ? 'todo' : c.released > 0 ? 'done' : 'waiting',
      detail: c.unreleased > 0 ? `${c.unreleased} finalised result${c.unreleased === 1 ? '' : 's'} not yet visible to trainees.` : c.released > 0 ? `${c.released} released. Trainees have been told.` : 'Release after finalising.',
    });
    const next = !ended ? (p.status === 'ongoing' ? 'complete' : 'start')
      : c.awaiting_marking > 0 ? 'mark' : needCalc ? 'recalculate' : c.ready > 0 ? 'finalise' : c.unreleased > 0 ? 'release' : 'done';
    return { programme: { id: p.id, code: p.code, title: p.title, status: p.status }, counts: c, steps, next };
  }
}

@Module({ controllers: [WorkflowController] })
export class WorkflowModule {}
