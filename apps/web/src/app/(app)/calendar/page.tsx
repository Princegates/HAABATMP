'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useApi, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card, ErrorNote, PageHead } from '@/components/ui';
import { isoDay, time } from '@/lib/format';
import { useClassroomOptions, useInstructorOptions } from '@/lib/options';

const monday = (d: Date) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const w = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - w); return x; };

export default function CalendarPage() {
  const { can } = useAuth();
  const [start, setStart] = useState(() => monday(new Date()));
  const [instructor, setInstructor] = useState('');
  const [room, setRoom] = useState('');
  const instructors = useInstructorOptions(); const rooms = useClassroomOptions();
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setUTCDate(d.getUTCDate() + i); return d; }), [start]);
  const from = days[0].toISOString().slice(0, 10); const to = days[6].toISOString().slice(0, 10);
  const { data, error } = useApi<any[]>(`/schedule${qs({ from, to, instructor_id: instructor, classroom_id: room })}`);
  const shift = (n: number) => setStart((s) => { const d = new Date(s); d.setUTCDate(d.getUTCDate() + n * 7); return d; });
  const today = isoDay();
  const heading = `${days[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} to ${days[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
  return (
    <>
      <PageHead title="Training" accent="calendar" subtitle={heading} actions={<><button className="btn outline" onClick={() => shift(-1)}>Previous week</button><button className="btn outline" onClick={() => setStart(monday(new Date()))}>This week</button><button className="btn outline" onClick={() => shift(1)}>Next week</button></>} />
      {can('programmes:write') && <div className="row wrap" style={{ marginBottom: 16 }}>
        <select aria-label="Instructor" value={instructor} onChange={(e) => setInstructor(e.target.value)} style={{ width: 'auto', minWidth: 200 }}><option value="">All instructors</option>{instructors.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <select aria-label="Classroom" value={room} onChange={(e) => setRoom(e.target.value)} style={{ width: 'auto', minWidth: 200 }}><option value="">All classrooms</option>{rooms.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      </div>}
      <ErrorNote error={error} />
      <div className="week">
        {days.map((d) => {
          const key = d.toISOString().slice(0, 10);
          const events = (data ?? []).filter((e) => e.starts_at.slice(0, 10) === key);
          return (
            <div key={key} className={`col ${key === today ? 'today' : ''}`}>
              <div className="dayname">{d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })}</div>
              {events.map((e) => (
                <div className="event" key={e.id}><b>{e.title}</b>{time(e.starts_at)} to {time(e.ends_at)}<div className="muted">{e.programme_code}{e.instructor_name && ` · ${e.instructor_name}`}{(e.classroom_name || e.location) && ` · ${e.classroom_name ?? e.location}`}</div>
                  <Link href={`/programmes/${e.programme_id}`} style={{ fontSize: 12 }}>Open programme</Link></div>
              ))}
              {!events.length && <span className="muted" style={{ fontSize: 12.5 }}>Nothing scheduled</span>}
            </div>
          );
        })}
      </div>
      {data && data.length === 0 && <Card><div className="muted">No sessions this week.</div></Card>}
    </>
  );
}
