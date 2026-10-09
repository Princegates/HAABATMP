'use client';
import Link from 'next/link';
import { useApi, qs } from '@/lib/api';
import { Badge, Card, ErrorNote, Loading, PageHead } from '@/components/ui';
import { isoDay, time } from '@/lib/format';

export default function AttendanceHome() {
  const { data, error } = useApi<any[]>(`/schedule${qs({ from: isoDay(-7), to: isoDay(14) })}`);
  const today = isoDay();
  const byDay = new Map<string, any[]>();
  for (const s of data ?? []) byDay.set(s.starts_at.slice(0, 10), [...(byDay.get(s.starts_at.slice(0, 10)) ?? []), s]);
  return (
    <>
      <PageHead title="Take" accent="attendance" subtitle="Open a session to mark who attended, or show the QR code so trainees check themselves in. Sessions from the last week and the next two are listed." />
      <ErrorNote error={error} />{!data && !error && <Loading />}
      <div className="stack">
        {[...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => (
          <Card key={day} title={<>{new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })} {day === today && <Badge tone="info">Today</Badge>}</>} flush>
            <table className="table"><tbody>{list.map((s) => (
              <tr key={s.id}><td style={{ width: 150 }} className="mono">{time(s.starts_at)} to {time(s.ends_at)}</td><td><b style={{ fontWeight: 600 }}>{s.title}</b><div className="muted">{s.programme_title}</div></td><td className="muted">{s.instructor_name}</td><td className="muted">{s.classroom_name ?? s.location}</td>
                <td className="actions"><Link href={`/attendance/${s.id}`} className="btn outline sm">Open roster</Link></td></tr>))}</tbody></table>
          </Card>
        ))}
        {data && data.length === 0 && <Card><div className="empty muted">No sessions in this period.</div></Card>}
      </div>
    </>
  );
}
