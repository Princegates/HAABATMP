import { Q } from './db.service';

export interface AttendanceStat {
  trainee_id: string;
  counted_sessions: number;
  present: number;
  late: number;
  excused: number;
  absent: number;
  attendance_pct: number | null;
}

/**
 * Attendance percentage = (present + late) / (sessions that have ended, minus excused ones).
 * Exam sessions are not counted. Unmarked sessions that have ended count as absent.
 */
export async function attendanceStats(q: Q, programmeId: string, traineeId?: string): Promise<AttendanceStat[]> {
  return q.query<AttendanceStat>(
    `with ended as (
       select id from sessions where programme_id = $1 and kind in ('class','practical') and ends_at <= now()
     )
     select e.trainee_id,
            (select count(*) from ended) as counted_sessions,
            count(a.*) filter (where a.status = 'present') as present,
            count(a.*) filter (where a.status = 'late') as late,
            count(a.*) filter (where a.status = 'excused') as excused,
            (select count(*) from ended) - count(a.*) filter (where a.status in ('present','late','excused')) as absent,
            case when (select count(*) from ended) - count(a.*) filter (where a.status = 'excused') <= 0 then null
                 else round(100.0 * count(a.*) filter (where a.status in ('present','late'))
                      / ((select count(*) from ended) - count(a.*) filter (where a.status = 'excused')), 2) end as attendance_pct
       from enrollments e
       left join attendance a on a.trainee_id = e.trainee_id and a.session_id in (select id from ended)
      where e.programme_id = $1 and e.status in ('confirmed','completed') and ($2::uuid is null or e.trainee_id = $2)
      group by e.trainee_id`, [programmeId, traineeId ?? null]);
}
