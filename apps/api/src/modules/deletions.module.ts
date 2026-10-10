import { BadRequestException, ConflictException, Controller, Delete, Inject, Module, NotFoundException, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { ENV, Env } from '../config';
import { Actor, AuthUser } from '../common/auth.types';
import { AuditService } from '../common/audit.service';
import { Db, Q } from '../common/db.service';
import { ActorCtx, CurrentUser, Require } from '../common/decorators';
import { serviceHeaders } from '../common/supabase';
import { parse, uuid } from '../common/validation';

/**
 * Super Administrator deletions.
 *
 * Anything that was added can be deleted, together with the records that only exist because of it (a trainee's
 * registrations, attendance and unpaid invoices; a programme's sessions and assessments). The one thing that is never
 * deleted is the official record: issued certificates, finalised results and recorded payments. They are the evidence
 * HAAB is audited on. A delete that would remove them is refused, and the message says what to do instead
 * (revoke the certificate, refund the payment, suspend the person). Every delete is written to the audit log with a copy
 * of what was removed. Only `settings:write` holders (Super Administrators) reach these routes.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

@Controller()
export class DeletionsController {
  constructor(private readonly db: Db, private readonly audit: AuditService, @Inject(ENV) private readonly env: Env) {}

  // ---------------------------------------------------------------- shared

  /** The official record that blocks a delete, among these enrolments. */
  private async officialRecord(q: Q, enrolmentIds: string[]) {
    if (!enrolmentIds.length) return [];
    const r = await q.one<{ certificates: number; results: number; payments: number }>(
      `select (select count(*) from certificates where enrollment_id = any($1))::int as certificates,
              (select count(*) from results where enrollment_id = any($1) and finalised)::int as results,
              (select count(*) from payments p join invoices i on i.id = p.invoice_id where i.enrollment_id = any($1))::int as payments`, [enrolmentIds]);
    return [r!.certificates && plural(r!.certificates, 'certificate'), r!.results && plural(r!.results, 'finalised result'), r!.payments && plural(r!.payments, 'recorded payment')].filter(Boolean) as string[];
  }

  /** Removes enrolments and what hangs off them. Refuses when official records exist. */
  private async removeEnrolments(q: Q, ids: string[], who: string) {
    const official = await this.officialRecord(q, ids);
    if (official.length) {
      throw new ConflictException(`${who} cannot be deleted because of ${official.join(', ')}. These are the official record and are never deleted. Revoke the certificate or refund the payment, or suspend or cancel instead.`);
    }
    if (!ids.length) return;
    await q.query(
      `delete from attendance a using enrollments e, sessions s
        where e.id = any($1) and s.programme_id = e.programme_id and a.session_id = s.id and a.trainee_id = e.trainee_id`, [ids]);
    await q.query(
      `delete from exam_attempts x using enrollments e, assessments a
        where e.id = any($1) and a.programme_id = e.programme_id and x.assessment_id = a.id and x.trainee_id = e.trainee_id`, [ids]);
    await q.query('delete from results where enrollment_id = any($1)', [ids]);
    await q.query('delete from invoices where enrollment_id = any($1)', [ids]);
    await q.query('delete from enrollments where id = any($1)', [ids]);
  }

  private async removeUser(q: Q, id: string, actor: Actor, me: AuthUser): Promise<{ row: any; authUserId: string | null }> {
    const row = await q.one<any>('select * from users where id = $1 for update', [id]);
    if (!row) throw new NotFoundException();
    const name = row.full_name;
    if (id === me.id) throw new BadRequestException('You cannot delete your own account');
    if (row.role === 'super_admin') {
      const others = await q.one<{ n: number }>(`select count(*)::int n from users where role = 'super_admin' and status <> 'suspended' and id <> $1`, [id]);
      if (!others || others.n < 1) throw new BadRequestException('There must always be at least one active super administrator');
    }
    // sign-offs by this person: the official record, so they stay
    const signed = await q.one<{ certificates: number; results: number; changes: number; payments: number; own: number; trainee_certs: number; trainee_payments: number }>(
      `select (select count(*) from certificates where issued_by = $1 or revoked_by = $1)::int as certificates,
              (select count(*) from results where finalised_by = $1)::int as results,
              (select count(*) from result_changes where changed_by = $1)::int as changes,
              (select count(*) from payments where recorded_by = $1)::int as payments,
              0 as own,
              (select count(*) from certificates where trainee_id = $1)::int as trainee_certs,
              (select count(*) from payments p join invoices i on i.id = p.invoice_id where i.trainee_id = $1)::int as trainee_payments`, [id]);
    const blocked = [
      signed!.certificates && `${plural(signed!.certificates, 'certificate')} they issued or revoked`,
      signed!.results && `${plural(signed!.results, 'result')} they finalised`,
      signed!.changes && `${plural(signed!.changes, 'result change')} they made`,
      signed!.payments && `${plural(signed!.payments, 'payment')} they recorded`,
      signed!.trainee_certs && plural(signed!.trainee_certs, 'certificate'),
      signed!.trainee_payments && plural(signed!.trainee_payments, 'recorded payment'),
    ].filter(Boolean);
    if (blocked.length) {
      throw new ConflictException(`${name} cannot be deleted because of ${blocked.join(', ')}. These are the official record and are never deleted. Suspend the account instead: they can no longer sign in and the history stays.`);
    }
    const led = await q.query<{ code: string }>(`select code from programmes where lead_instructor_id = $1 and status in ('ongoing','completed') order by code`, [id]);
    if (led.length) throw new ConflictException(`${name} leads ${led.map((p) => p.code).join(', ')}. Delete those programmes first, or suspend the account instead.`);
    const taught = await q.one<{ n: number }>(`select count(*)::int n from sessions where instructor_id = $1 and ends_at < now()`, [id]);
    if (taught && taught.n) throw new ConflictException(`${name} has taught ${plural(taught.n, 'session')} already. Suspend the account instead so that record stays.`);
    const docs = await q.one<{ n: number }>('select count(*)::int n from documents where owner_user_id = $1', [id]);
    if (docs && docs.n) throw new ConflictException(`${name} owns ${plural(docs.n, 'document')}. Delete those in Documents first.`);

    // as a trainee
    const enrolments = (await q.query<{ id: string }>('select id from enrollments where trainee_id = $1', [id])).map((e) => e.id);
    await this.removeEnrolments(q, enrolments, name);
    await q.query('delete from exam_attempts where trainee_id = $1', [id]);
    await q.query('delete from attendance where trainee_id = $1', [id]);
    await q.query('delete from invoices where trainee_id = $1', [id]);
    // as staff: they stay named in the audit log, so the records they touched just lose the pointer
    await q.query('update sessions set instructor_id = null where instructor_id = $1', [id]);
    await q.query('update programmes set lead_instructor_id = null where lead_instructor_id = $1', [id]);
    await q.query('delete from course_instructors where instructor_id = $1', [id]);
    for (const [t, c] of [['assessments', 'created_by'], ['courses', 'created_by'], ['programmes', 'created_by'], ['questions', 'created_by'], ['users', 'created_by'],
      ['attendance', 'marked_by'], ['exam_attempts', 'marked_by'], ['attempt_answers', 'marked_by'], ['invoices', 'created_by'], ['enrollments', 'confirmed_by'],
      ['enrollments', 'registered_by'], ['documents', 'uploaded_by'], ['integrations', 'updated_by'], ['settings', 'updated_by'], ['registration_requests', 'decided_by'],
      ['registration_requests', 'user_id']]) {
      await q.query(`update ${t} set ${c} = null where ${c} = $1`, [id]);
    }
    await q.query('delete from users where id = $1', [id]);
    await this.audit.log(q, actor, 'user.delete', 'user', id, { email: row.email, full_name: row.full_name, role: row.role, organization_id: row.organization_id }, null);
    return { row, authUserId: row.auth_user_id };
  }

  /** The sign-in is removed from Supabase too, after the database change is safely committed. */
  private async removeSignIn(authUserId: string | null) {
    if (this.env.AUTH_MODE !== 'supabase' || !authUserId) return;
    try {
      await fetch(`${this.env.SUPABASE_URL}/auth/v1/admin/users/${authUserId}`, { method: 'DELETE', headers: serviceHeaders(this.env.SUPABASE_SERVICE_ROLE_KEY) });
    } catch { /* the person can no longer reach any data: the platform account is gone */ }
  }

  // ---------------------------------------------------------------- endpoints

  @Delete('users/:id')
  @Require('settings:write')
  async deleteUser(@CurrentUser() me: AuthUser, @Param('id') id: string, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const r = await this.db.tx((q) => this.removeUser(q, id, actor, me));
    await this.removeSignIn(r.authUserId);
    return { ok: true, deleted: r.row.full_name };
  }

  @Delete('organizations/:id')
  @Require('settings:write')
  async deleteOrganisation(@CurrentUser() me: AuthUser, @Param('id') id: string, @Query() query: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const { with_people } = parse(z.object({ with_people: z.enum(['true']).optional() }), query);
    const authIds: (string | null)[] = [];
    const out = await this.db.tx(async (q) => {
      const org = await q.one<any>('select * from organizations where id = $1 for update', [id]);
      if (!org) throw new NotFoundException();
      const people = await q.query<{ id: string; full_name: string }>('select id, full_name from users where organization_id = $1 order by full_name', [id]);
      if (people.length && !with_people) {
        throw new ConflictException(`${org.name} still has ${plural(people.length, 'person', 'people')}. Delete them first, or delete the client together with its people.`);
      }
      const progs = await q.query<{ code: string }>('select code from programmes where organization_id = $1 order by code', [id]);
      if (progs.length) throw new ConflictException(`${org.name} has programmes reserved for it (${progs.map((p) => p.code).join(', ')}). Delete those programmes first.`);
      const docs = await q.one<{ n: number }>('select count(*)::int n from documents where organization_id = $1', [id]);
      if (docs && docs.n) throw new ConflictException(`${org.name} has ${plural(docs.n, 'document')}. Delete those in Documents first.`);
      const paid = await q.one<{ n: number }>('select count(*)::int n from payments p join invoices i on i.id = p.invoice_id where i.organization_id = $1', [id]);
      if (paid && paid.n) throw new ConflictException(`${org.name} has ${plural(paid.n, 'recorded payment')}. Payments are the official record and are never deleted. Mark the client inactive instead.`);
      for (const p of people) authIds.push((await this.removeUser(q, p.id, actor, me)).authUserId);
      await q.query('delete from invoices where organization_id = $1', [id]);
      await q.query('delete from compliance_requirements where organization_id = $1', [id]);
      await q.query('update certificates set template_id = null where template_id in (select id from certificate_templates where organization_id = $1)', [id]);
      await q.query('delete from certificate_templates where organization_id = $1', [id]);
      await q.query('update enrollments set sponsor_organization_id = null where sponsor_organization_id = $1', [id]);
      await q.query('delete from organizations where id = $1', [id]);
      await this.audit.log(q, actor, 'organization.delete', 'organization', id, { ...org, people_deleted: people.map((p) => p.full_name) }, null);
      return { ok: true, deleted: org.name, people_deleted: people.length };
    });
    for (const a of authIds) await this.removeSignIn(a);
    return out;
  }

  @Delete('programmes/:id')
  @Require('settings:write')
  async deleteProgramme(@Param('id') id: string, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    return this.db.tx(async (q) => {
      const p = await q.one<any>('select * from programmes where id = $1 for update', [id]);
      if (!p) throw new NotFoundException();
      const enrolments = (await q.query<{ id: string }>('select id from enrollments where programme_id = $1', [id])).map((e) => e.id);
      await this.removeEnrolments(q, enrolments, p.code);
      const certs = await q.one<{ n: number }>('select count(*)::int n from certificates where programme_id = $1', [id]);
      if (certs && certs.n) throw new ConflictException(`${p.code} cannot be deleted because of ${plural(certs.n, 'certificate')}. Certificates are the official record and are never deleted.`);
      // assessments set for this programme go with it, with any attempts
      await q.query('delete from exam_attempts where assessment_id in (select id from assessments where programme_id = $1)', [id]);
      await q.query('delete from assessments where programme_id = $1', [id]);
      await q.query('delete from invoices where programme_id = $1', [id]);
      await q.query('delete from programmes where id = $1', [id]); // sessions and their attendance go with it
      await this.audit.log(q, actor, 'programme.delete', 'programme', id, { ...p, registrations_deleted: enrolments.length }, null);
      return { ok: true, deleted: p.code };
    });
  }

  @Delete('enrollments/:id')
  @Require('settings:write')
  async deleteEnrolment(@Param('id') id: string, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    return this.db.tx(async (q) => {
      const e = await q.one<any>('select * from enrollments where id = $1 for update', [id]);
      if (!e) throw new NotFoundException();
      await this.removeEnrolments(q, [id], 'This registration');
      await this.audit.log(q, actor, 'enrollment.delete', 'enrollment', id, e, null);
      return { ok: true };
    });
  }

  @Delete('classrooms/:id')
  @Require('settings:write')
  async deleteClassroom(@Param('id') id: string, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    return this.db.tx(async (q) => {
      const row = await q.one<any>('select * from classrooms where id = $1 for update', [id]);
      if (!row) throw new NotFoundException();
      await q.query('update sessions set classroom_id = null where classroom_id = $1', [id]);
      await q.query('update programmes set classroom_id = null where classroom_id = $1', [id]);
      await q.query('delete from classrooms where id = $1', [id]);
      await this.audit.log(q, actor, 'classroom.delete', 'classroom', id, row, null);
      return { ok: true, deleted: row.name };
    });
  }

  @Delete('assessments/:id')
  @Require('settings:write')
  async deleteAssessment(@Param('id') id: string, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    return this.db.tx(async (q) => {
      const a = await q.one<any>('select * from assessments where id = $1 for update', [id]);
      if (!a) throw new NotFoundException();
      if (a.programme_id) {
        const final = await q.one<{ n: number }>('select count(*)::int n from results r join enrollments e on e.id = r.enrollment_id where e.programme_id = $1 and r.finalised', [a.programme_id]);
        if (final && final.n) throw new ConflictException(`"${a.title}" cannot be deleted because ${plural(final.n, 'result')} on its programme have been finalised from it. Close it instead.`);
      }
      const attempts = await q.one<{ n: number }>('select count(*)::int n from exam_attempts where assessment_id = $1', [id]);
      await q.query('delete from exam_attempts where assessment_id = $1', [id]);
      await q.query('delete from assessments where id = $1', [id]);
      await this.audit.log(q, actor, 'assessment.delete', 'assessment', id, { ...a, attempts_deleted: attempts?.n ?? 0 }, null);
      return { ok: true, deleted: a.title };
    });
  }

  @Delete('questions/:id')
  @Require('settings:write')
  async deleteQuestion(@Param('id') id: string, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    return this.db.tx(async (q) => {
      const row = await q.one<any>('select * from questions where id = $1 for update', [id]);
      if (!row) throw new NotFoundException();
      const asked = await q.one<{ n: number }>('select count(*)::int n from attempt_answers where question_id = $1', [id]);
      if (asked && asked.n) throw new ConflictException('This question has been answered in an exam, so deleting it would change past marks. Retire it instead.');
      await q.query('delete from assessment_questions where question_id = $1', [id]);
      await q.query('delete from questions where id = $1', [id]);
      await this.audit.log(q, actor, 'question.delete', 'question', id, row, null);
      return { ok: true };
    });
  }

  @Delete('certificate-templates/:id')
  @Require('settings:write')
  async deleteTemplate(@Param('id') id: string, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    return this.db.tx(async (q) => {
      const row = await q.one<any>('select * from certificate_templates where id = $1 for update', [id]);
      if (!row) throw new NotFoundException();
      if (row.is_default) throw new ConflictException('This is the default template. Make another template the default first.');
      await q.query('update certificates set template_id = null where template_id = $1', [id]);
      await q.query('delete from certificate_templates where id = $1', [id]);
      await this.audit.log(q, actor, 'certificate_template.delete', 'certificate_template', id, row, null);
      return { ok: true };
    });
  }
}

@Module({ controllers: [DeletionsController] })
export class DeletionsModule {}
