'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiError, api, download, qs, useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card, Empty, ErrorNote, Loading, PageHead } from '@/components/ui';
import { useToast } from '@/components/toast';
import { date, isoDay } from '@/lib/format';
import { useOrgOptions } from '@/lib/options';

interface Def { key: string; title: string; description: string; columns: { key: string; label: string }[] }
const cell = (v: any, key: string) => {
  if (v === null || v === undefined) return '';
  if (/(_date|_at|^start|^end|^issue|^due|^expires)/.test(key) && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return date(v);
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('en-GB') : v.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  return String(v).replace(/_/g, ' ');
};

function Inner() {
  const { is } = useAuth();
  const toast = useToast();
  const params = useSearchParams();
  const list = useApi<Def[]>('/reports');
  const seesOrg = is('super_admin', 'training_admin', 'auditor', 'finance_officer');
  const orgs = useOrgOptions(seesOrg);
  const [key, setKey] = useState(params.get('report') ?? '');
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [org, setOrg] = useState('');
  const [result, setResult] = useState<{ rows: any[]; columns: Def['columns']; generated_at: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | undefined>();
  useEffect(() => { if (list.data && !key) setKey(list.data[0]?.key ?? ''); }, [list.data, key]);
  const def = list.data?.find((d) => d.key === key);
  const query = { from, to, organization_id: org };
  async function run() { if (!key) return; setBusy(true); setErr(undefined); try { setResult(await api.get(`/reports/${key}${qs(query)}`)); } catch (e) { setErr(e as ApiError); setResult(null); } setBusy(false); }
  useEffect(() => { setResult(null); if (key) run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [key]);
  const exp = (format: string) => download(`/reports/${key}${qs({ ...query, format })}`, `${key}.${format}`).catch((e: ApiError) => toast(e.message, 'error'));
  return (
    <>
      <PageHead title="Reports" subtitle="Choose a report, narrow it by date or organisation, then read it here or export it. Exports are recorded in the audit log." />
      <div className="grid" style={{ gridTemplateColumns: '260px minmax(0, 1fr)', alignItems: 'start' }}>
        <nav className="card" aria-label="Reports">
          {list.data?.map((d) => <button key={d.key} onClick={() => setKey(d.key)} aria-current={d.key === key ? 'true' : undefined} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '11px 18px', background: d.key === key ? 'var(--accent-wash)' : 'transparent', border: 0, borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${d.key === key ? 'var(--accent)' : 'transparent'}`, cursor: 'pointer', color: 'var(--text)' }}>{d.title}</button>)}
          {!list.data && <Loading />}
        </nav>
        <div className="stack">
          {def && <Card title={def.title}>
            <p className="muted" style={{ marginBottom: 14 }}>{def.description}</p>
            <div className="row wrap">
              {!['compliance', 'outstanding'].includes(key) && <><div className="field"><label htmlFor="from">From</label><input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} max={isoDay()} /></div><div className="field"><label htmlFor="to">To</label><input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div></>}
              {seesOrg && <div className="field"><label htmlFor="org">Organisation</label><select id="org" value={org} onChange={(e) => setOrg(e.target.value)} style={{ minWidth: 220 }}><option value="">All</option>{orgs.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>}
              <div className="field"><label>&nbsp;</label><button className="btn" onClick={run} disabled={busy}>{busy ? 'Running…' : 'Run report'}</button></div>
            </div>
          </Card>}
          <ErrorNote error={err} />
          {result && def && (
            <Card title={`${result.rows.length} row${result.rows.length === 1 ? '' : 's'}`} actions={<><button className="btn outline sm" onClick={() => exp('csv')}>CSV</button><button className="btn outline sm" onClick={() => exp('xlsx')}>Excel</button><button className="btn outline sm" onClick={() => exp('pdf')}>PDF</button></>} flush>
              {result.rows.length === 0 ? <Empty title="Nothing to report">Try a wider date range.</Empty> : (
                <div className="table-wrap"><table className="table"><thead><tr>{def.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{result.rows.map((r, i) => <tr key={i}>{def.columns.map((c) => <td key={c.key} className={/(_date|_at|^start|^end|^issue|^due|^expires)/.test(c.key) ? 'nowrap' : undefined}>{cell(r[c.key], c.key)}</td>)}</tr>)}</tbody></table></div>)}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
export default function ReportsPage() { return <Suspense><Inner /></Suspense>; }
