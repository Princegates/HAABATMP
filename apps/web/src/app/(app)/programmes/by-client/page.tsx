'use client';
import Link from 'next/link';
import { Fragment, useMemo, useState } from 'react';
import { useApi } from '@/lib/api';
import { Badge, Card, Empty, ErrorNote, Loading, PageHead } from '@/components/ui';
import { date, label } from '@/lib/format';

/** Programmes and their courses grouped by client: reserved for them, or with their trainees registered. */
export default function ByClientPage() {
  const { data, error } = useApi<{ data: any[] }>('/programmes/by-client');
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return data?.data ?? [];
    return (data?.data ?? []).filter((g) => g.name.toLowerCase().includes(t) || g.courses.some((c: any) => `${c.code} ${c.title}`.toLowerCase().includes(t)));
  }, [data, q]);
  return (
    <>
      <PageHead title="Training" accent="by client" subtitle="Each client with the courses and programmes they train on. A programme shared by several clients is listed under each." />
      <div className="row" style={{ marginBottom: 12, gap: 8 }}>
        <Link className="btn outline sm" href="/programmes">List view</Link><span className="btn sm" aria-current="page">By client</span>
        <input type="search" placeholder="Search client or course" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search client or course" style={{ maxWidth: 280 }} />
      </div>
      <ErrorNote error={error} />
      {!data && !error && <Loading />}
      {data && !groups.length && <Empty title="Nothing to show" >No programmes match.</Empty>}
      <div className="stack">
        {groups.map((g) => (
          <Card key={g.organization_id ?? 'none'} title={<>{g.organization_id ? <Link href={`/clients/${g.organization_id}`}>{g.name}</Link> : g.name}{g.type && <span className="muted" style={{ fontWeight: 400 }}> · {label(g.type)}</span>}</>}
            actions={<span className="muted">{g.courses.length} course{g.courses.length === 1 ? '' : 's'} · {g.programme_count} programme{g.programme_count === 1 ? '' : 's'}</span>} flush>
            <table className="table" style={{ tableLayout: 'fixed' }}><colgroup><col style={{ width: '26%' }} /><col style={{ width: '30%' }} /><col style={{ width: '16%' }} /><col style={{ width: '12%' }} /><col style={{ width: '16%' }} /></colgroup><tbody>
              {g.courses.map((c: any) => (
                <Fragment key={c.id}>
                  <tr><td colSpan={5} style={{ background: 'var(--surface-2, #f6f7f9)' }}><Link href={`/courses/${c.id}`}><span className="mono">{c.code}</span> · <b style={{ fontWeight: 600 }}>{c.title}</b></Link></td></tr>
                  {c.programmes.map((p: any) => (
                    <tr key={`${c.id}-${p.id}`}>
                      <td><Link href={`/programmes/${p.id}`} className="mono">{p.code}</Link></td>
                      <td>{date(p.start_date)}{p.end_date !== p.start_date ? ` to ${date(p.end_date)}` : ''}</td>
                      <td className="num">{g.organization_id ? `${p.trainees} trainee${p.trainees === 1 ? '' : 's'}` : ''}</td>
                      <td>{p.reserved ? <span className="muted">Reserved</span> : ''}</td>
                      <td><Badge value={p.status} /></td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody></table>
          </Card>
        ))}
      </div>
    </>
  );
}
