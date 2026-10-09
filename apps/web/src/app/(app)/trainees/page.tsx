'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Column, DataList } from '@/components/datalist';
import { FieldDef, FormModal } from '@/components/form';
import { Badge, Card, Modal, PageHead } from '@/components/ui';
import { useToast } from '@/components/toast';
import { date } from '@/lib/format';
import { useOrgOptions } from '@/lib/options';

interface Summary { organizations: { organization_id: string; name: string; type: string; status: string; trainees: number; invited: number }[]; individuals: number | null }

/** Minimal CSV reader: quoted fields, commas inside quotes, optional header row. */
function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur.trim()); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur.trim()); if (row.some(Boolean)) rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  row.push(cur.trim()); if (row.some(Boolean)) rows.push(row);
  if (rows.length && /email/i.test(rows[0].join(','))) rows.shift();
  return rows.map(([email, full_name, phone, aviation_role, employer]) => ({ email, full_name, phone: phone || null, aviation_role: aviation_role || null, employer: employer || null }));
}

function ImportModal({ orgId, orgName, onClose, onDone }: { orgId: string | null; orgName: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<{ created: any[]; skipped: { email: string; reason: string }[]; warnings: { email: string; warning: string }[] } | null>(null);
  const rows = useMemo(() => parseCsv(text), [text]);
  return (
    <Modal title={`Import trainees into ${orgName}`} size="wide" onClose={onClose} footer={result ? <button className="btn" onClick={() => { onDone(); onClose(); }}>Done</button> : <>
      <button className="btn outline" onClick={onClose}>Cancel</button>
      <button className="btn" disabled={busy || !rows.length || rows.length > 500} onClick={async () => { setBusy(true); setErr(''); try { setResult(await api.post('/users/import', { organization_id: orgId, rows })); } catch (e) { setErr((e as ApiError).message); } setBusy(false); }}>{busy ? 'Importing…' : `Import ${rows.length || ''} trainee${rows.length === 1 ? '' : 's'}`}</button></>}>
      {result ? (
        <div className="stack">
          <div className="alert ok"><b>{result.created.length} added.</b> Each person is sent an invitation to set up their sign-in.</div>
          {result.skipped.length > 0 && <div className="alert warn"><b>{result.skipped.length} skipped.</b><ul style={{ margin: '6px 0 0 18px' }}>{result.skipped.map((s) => <li key={s.email}>{s.email}: {s.reason}</li>)}</ul></div>}
          {result.warnings.length > 0 && <div className="alert info"><b>Please check.</b><ul style={{ margin: '6px 0 0 18px' }}>{result.warnings.map((s) => <li key={s.email}>{s.email}: {s.warning}</li>)}</ul></div>}
        </div>
      ) : (
        <div className="stack">
          <p className="muted">One person per line: <code>email, full name, phone, aviation role, employer</code>. Only the first two are required. Up to 500 at a time. Everyone is added to <b>{orgName}</b>. An email address that already exists is skipped.</p>
          <div className="field"><label htmlFor="csvfile">Choose a CSV file</label><input id="csvfile" type="file" accept=".csv,text/csv,text/plain" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} /></div>
          <div className="field"><label htmlFor="csv">Or paste the list</label><textarea id="csv" value={text} onChange={(e) => setText(e.target.value)} placeholder={'email, full name, phone, aviation role, employer\nama@airport.example, Ama Mensah, , Ramp agent, Airport Co'} style={{ minHeight: 150, fontFamily: 'monospace' }} /></div>
          {rows.length > 0 && <div className="muted">{rows.length} row{rows.length === 1 ? '' : 's'} read. First: {rows[0].full_name} ({rows[0].email}){rows.length > 500 && <b style={{ color: 'var(--danger)' }}> Too many: the limit is 500.</b>}</div>}
          {err && <div className="alert danger">{err}</div>}
        </div>
      )}
    </Modal>
  );
}

function TraineesInner() {
  const { me, can, is } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const clientView = is('org_admin');
  const sel = clientView ? (me.organization?.id ?? 'all') : params.get('org') ?? 'all';
  const summary = useApi<Summary>(clientView ? null : '/users/by-organization');
  const orgs = useOrgOptions(!clientView);
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  useEffect(() => { if (params.get('import') && can('users:write')) setImporting(true); }, [params, can]);

  const total = (summary.data?.organizations.reduce((s, o) => s + o.trainees, 0) ?? 0) + (summary.data?.individuals ?? 0);
  const current = sel === 'all' ? null : sel === 'none' ? { name: 'Individuals' } : summary.data?.organizations.find((o) => o.organization_id === sel) ?? (clientView ? { name: me.organization?.name } : null);
  const title = clientView ? 'Employees' : current?.name ?? 'All trainees';
  const go = (v: string) => router.replace(v === 'all' ? '/trainees' : `/trainees?org=${v}`);

  const columns: Column<any>[] = [
    { key: 'full_name', label: 'Name', render: (u) => <b style={{ fontWeight: 600 }}>{u.full_name}</b>, href: (u) => `/people/${u.id}` },
    { key: 'email', label: 'Email' },
    ...(sel === 'all' && !clientView ? [{ key: 'organization_name', label: 'Organisation', render: (u: any) => u.organization_name ?? <span className="muted">Individual</span> }] : []),
    { key: 'phone', label: 'Phone' }, { key: 'status', label: 'Status', render: (u) => <Badge value={u.status} /> },
    { key: 'last_login_at', label: 'Last sign-in', render: (u) => (u.last_login_at ? date(u.last_login_at) : 'Never') },
  ];
  const fields: FieldDef[] = [
    { name: 'full_name', label: 'Full name', required: true }, { name: 'email', label: 'Email', type: 'email', required: true }, { name: 'phone', label: 'Phone' },
    ...(clientView ? [] : [{ name: 'organization_id', label: 'Organisation', type: 'select' as const, options: orgs, help: 'Leave empty for an individual who is not part of an organisation' }]),
    { name: 'aviation_role', label: 'Aviation role' }, { name: 'employer', label: 'Employer' },
  ];

  return (
    <>
      <PageHead title={title} accent={clientView || sel !== 'all' ? undefined : 'by organisation'}
        subtitle={clientView ? 'The people at your organisation who train with HAAB.' : sel === 'all' ? 'Every trainee, grouped by the organisation they belong to. Pick an organisation on the left to work with its people only.' : undefined}
        actions={can('users:write') && <>
          <button className="btn outline" onClick={() => setImporting(true)}>Import list</button>
          <button className="btn" onClick={() => setAdding(true)}>Add trainee</button>
        </>} />
      <div className="trainee-grid" style={{ display: 'grid', gridTemplateColumns: clientView ? '1fr' : '280px minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
        {!clientView && (
          <nav className="card" aria-label="Organisations" style={{ position: 'sticky', top: 76 }}>
            <div className="card-head"><span className="label">Organisations</span><Link href="/clients" className="btn ghost sm">Manage</Link></div>
            {[{ id: 'all', name: 'All trainees', n: total }, ...(summary.data?.organizations.map((o) => ({ id: o.organization_id, name: o.name, n: o.trainees, sub: o.invited ? `${o.invited} not yet signed in` : undefined })) ?? []),
              ...(summary.data?.individuals !== null && summary.data ? [{ id: 'none', name: 'Individuals', n: summary.data.individuals ?? 0, sub: 'No organisation' }] : [])].map((o: any) => (
              <button key={o.id} onClick={() => go(o.id)} aria-current={sel === o.id ? 'true' : undefined}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, width: '100%', padding: '10px 18px', textAlign: 'left', background: sel === o.id ? 'var(--accent-wash)' : 'transparent', border: 0, borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${sel === o.id ? 'var(--accent)' : 'transparent'}`, cursor: 'pointer', color: 'var(--text)' }}>
                <span><span style={{ display: 'block' }}>{o.name}</span>{o.sub && <span className="muted" style={{ fontSize: 12.5 }}>{o.sub}</span>}</span>
                <span className="mono" style={{ fontFamily: 'var(--font-display)', fontSize: 20 }}>{o.n}</span>
              </button>
            ))}
            {summary.data?.organizations.length === 0 && <div className="empty muted">No organisations yet. <Link href="/clients?new=1">Add the first client</Link>.</div>}
          </nav>
        )}
        <DataList path="/users" extra={{ role: 'trainee', organization_id: sel === 'all' ? undefined : sel }} columns={columns} refreshKey={tick} searchPlaceholder="Search name or email"
          filters={[{ name: 'status', label: 'Status', options: ['active', 'invited', 'suspended'].map((s) => ({ value: s, label: s })) }]}
          empty={{ title: sel === 'all' ? 'No trainees yet' : `No trainees in ${current?.name ?? 'this organisation'} yet`, hint: can('users:write') ? 'Add people one at a time or import a list.' : undefined }} />
      </div>
      {adding && <FormModal title={`Add trainee${current?.name && sel !== 'all' ? ` to ${current.name}` : ''}`} fields={fields} initial={{ organization_id: sel === 'all' || sel === 'none' ? '' : sel }} onClose={() => setAdding(false)}
        onSubmit={async (v) => { const { aviation_role, employer, ...base } = v; await api.post('/users', { ...base, role: 'trainee', profile: { aviation_role, employer } }); toast('Trainee added. They will receive an invitation.'); setTick((t) => t + 1); summary.reload(); }} />}
      {importing && <ImportModal orgId={clientView ? me.organization!.id : sel === 'all' || sel === 'none' ? null : sel} orgName={clientView ? me.organization!.name : sel === 'none' || sel === 'all' ? 'no organisation (individuals)' : current?.name ?? 'the organisation'} onClose={() => { setImporting(false); router.replace(sel === 'all' ? '/trainees' : `/trainees?org=${sel}`); }} onDone={() => { setTick((t) => t + 1); summary.reload(); }} />}
      <style>{`@media (max-width: 900px) { .trainee-grid { grid-template-columns: 1fr !important; } .trainee-grid nav { position: static !important; } }`}</style>
    </>
  );
}

export default function TraineesPage() { return <Suspense><TraineesInner /></Suspense>; }
