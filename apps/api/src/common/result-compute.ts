import { attendanceStats } from './attendance';
import { Q } from './db.service';
import { decideResult } from './result-rules';

/**
 * Works out one trainee's result on a programme from the evidence. A programme counts as ended once its end date has
 * passed OR staff have marked it Completed: completing it settles results even when some session dates have not
 * been reached, so results can be finalised and released. Sessions that were never held are not counted against anyone.
 * A finalised result is returned untouched.
 */
export async function computeResult(q: Q, enrollmentId: string) {
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
