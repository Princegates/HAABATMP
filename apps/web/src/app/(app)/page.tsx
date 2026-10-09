'use client';
import Link from 'next/link';
import { useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { BarChart, HalfDonut, LineChart } from '@/components/charts';
import { Card, ErrorNote, Loading, PageHead, Tile } from '@/components/ui';
import { dateTime } from '@/lib/format';

interface Dash {
  role: string;
  tiles: { key: string; label: string; value: number; total?: number; unit?: string; tone?: string }[];
  charts?: Record<string, any[]>;
  lists?: { upcoming_sessions?: { id: string; title: string; starts_at: string; ends_at: string; programme_code: string; programme_title?: string; classroom?: string; location?: string }[] };
}

function greeting() {
  const h = new Date().getUTCHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function Dashboard() {
  const { me, can, is } = useAuth();
  const { data, error, loading } = useApi<Dash>('/dashboard');
  const first = me.full_name.split(' ')[0];
  const c = data?.charts ?? {};
  const month = (rows?: any[]) => (rows ?? []).map((r) => ({ ...r, value: Number(r.value), collected: Number(r.collected ?? 0), billed: Number(r.billed ?? 0) }));
  const named = (rows?: any[]) => (rows ?? []).map((r) => ({ label: r.label, value: Number(r.value) }));

  return (
    <>
      <PageHead title={`${greeting()},`} accent={first} subtitle={is('trainee') ? 'Your training at a glance.' : is('org_admin') ? `Training for ${me.organization?.name ?? 'your organisation'}.` : 'What is happening across training today.'}
        actions={<>
          {can('programmes:write') && <Link href="/programmes?new=1" className="btn">New programme</Link>}
          {can('courses:write') && <Link href="/courses?new=1" className="btn outline">New course</Link>}
          {is('trainee') && <Link href="/checkin" className="btn">Check in to a class</Link>}
        </>} />
      <ErrorNote error={error} />
      {loading && !data && <Loading />}
      {data && (
        <div className="stack" style={{ gap: 20 }}>
          <div className="grid c4">{data.tiles.map((t) => <Tile key={t.key} name={t.label} value={t.value} total={t.total} unit={t.unit} tone={t.tone} />)}</div>

          {data.lists?.upcoming_sessions && (
            <Card title="Coming up" actions={<Link href="/calendar" className="btn ghost sm">Open calendar</Link>} flush>
              {data.lists.upcoming_sessions.length === 0 ? <div className="empty muted">No sessions scheduled.</div> : (
                <table className="table"><tbody>{data.lists.upcoming_sessions.map((s) => (
                  <tr key={s.id}><td><b style={{ fontWeight: 600 }}>{s.title}</b><div className="muted">{s.programme_title ?? s.programme_code}</div></td><td>{dateTime(s.starts_at)}</td><td className="muted">{s.classroom ?? s.location ?? ''}</td>
                    {can('attendance:write') && <td className="actions"><Link href={`/attendance/${s.id}`} className="btn outline sm">Roster</Link></td>}</tr>
                ))}</tbody></table>
              )}
            </Card>
          )}

          {c.enrollments_by_month && (
            <div className="grid charts">
              <Card title="Registrations, last 12 months"><BarChart data={month(c.enrollments_by_month)} series={[{ key: 'value', label: 'Registrations' }]} /></Card>
              <Card title="Certificates by category"><HalfDonut data={named(c.certificates_by_category)} /></Card>
            </div>
          )}
          {(c.revenue_by_month?.length ?? 0) > 0 && (
            <div className="grid charts">
              <Card title={is('finance_officer') ? 'Billed and collected' : 'Revenue and billing'}><LineChart data={month(c.revenue_by_month)} series={[{ key: 'billed', label: 'Billed' }, { key: 'collected', label: 'Collected' }]} /></Card>
              <Card title={c.invoices_by_status ? 'Invoices by status' : 'Trainees by organisation'}><HalfDonut data={named(c.invoices_by_status ?? c.trainees_by_organization)} /></Card>
            </div>
          )}
          {!c.revenue_by_month?.length && c.trainees_by_organization && <div className="grid c2"><Card title="Trainees by organisation"><HalfDonut data={named(c.trainees_by_organization)} /></Card></div>}
          {c.training_by_course && <div className="grid c2"><Card title="Training by course"><HalfDonut data={named(c.training_by_course)} /></Card></div>}
        </div>
      )}
    </>
  );
}
