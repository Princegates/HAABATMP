import { ConflictException } from '@nestjs/common';
import { Q } from './db.service';

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The official record that blocks a delete, among these enrolments. */
async function officialRecord(q: Q, enrolmentIds: string[]) {
  if (!enrolmentIds.length) return [];
  const r = await q.one<{ certificates: number; results: number; payments: number }>(
    `select (select count(*) from certificates where enrollment_id = any($1))::int as certificates,
            (select count(*) from results where enrollment_id = any($1) and finalised)::int as results,
            (select count(*) from payments p join invoices i on i.id = p.invoice_id where i.enrollment_id = any($1))::int as payments`, [enrolmentIds]);
  return [r!.certificates && plural(r!.certificates, 'certificate'), r!.results && plural(r!.results, 'finalised result'), r!.payments && plural(r!.payments, 'recorded payment')].filter(Boolean) as string[];
}

/** Removes enrolments and what hangs off them. Refuses when official records exist. */
export async function removeEnrolments(q: Q, ids: string[], who: string) {
  const official = await officialRecord(q, ids);
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

/** Removes a programme with its registrations, sessions and assessments. Refuses when certificates or other official records exist. Returns the enrolment ids removed. */
export async function removeProgramme(q: Q, p: { id: string; code: string }): Promise<string[]> {
  const enrolments = (await q.query<{ id: string }>('select id from enrollments where programme_id = $1', [p.id])).map((e) => e.id);
  await removeEnrolments(q, enrolments, p.code);
  const certs = await q.one<{ n: number }>('select count(*)::int n from certificates where programme_id = $1', [p.id]);
  if (certs && certs.n) throw new ConflictException(`${p.code} cannot be deleted because of ${plural(certs.n, 'certificate')}. Certificates are the official record and are never deleted.`);
  await q.query('delete from exam_attempts where assessment_id in (select id from assessments where programme_id = $1)', [p.id]);
  await q.query('delete from assessments where programme_id = $1', [p.id]);
  await q.query('delete from invoices where programme_id = $1', [p.id]);
  await q.query('delete from programmes where id = $1', [p.id]); // sessions and their attendance go with it
  return enrolments;
}
