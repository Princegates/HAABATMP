import { Db, Q } from './db.service';

/** An instructor teaches a course when they are on its authorised list, or lead or teach a session of a programme of it. */
export async function teachesCourse(db: Db | Q, instructorId: string, courseId: string): Promise<boolean> {
  return !!(await db.one(
    `select 1 where exists (select 1 from course_instructors where course_id = $1 and instructor_id = $2)
         or exists (select 1 from programmes p where p.course_id = $1 and (p.lead_instructor_id = $2
                    or exists (select 1 from sessions s where s.programme_id = p.id and s.instructor_id = $2)))`, [courseId, instructorId]));
}
