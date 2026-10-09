'use client';
import { useState } from 'react';
import { ApiError, api, download, useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Column, DataList } from '@/components/datalist';
import { Badge, Card, Modal, PageHead } from '@/components/ui';
import { dateTime } from '@/lib/format';

interface Verify { ok: boolean; checked: number; first_bad_seq: number | null; missing_entries: number; verified_at: string }

export default function AuditPage() {
  const { is } = useAuth();
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [detail, setDetail] = useState<any | null>(null);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [busy, setBusy] = useState(false);
  const columns: Column<any>[] = [
    { key: 'at', label: 'When', render: (a) => <span className="mono nowrap">{dateTime(a.at)}</span> }, { key: 'actor_email', label: 'Who', render: (a) => <span>{a.actor_email ?? <span className="muted">Not signed in</span>}<div className="muted" style={{ fontSize: 12.5 }}>{a.actor_role}</div></span> },
    { key: 'action', label: 'Action', render: (a) => <code style={{ fontSize: 13 }}>{a.action}</code> }, { key: 'entity_type', label: 'Record', render: (a) => <span>{a.entity_type}<div className="muted mono" style={{ fontSize: 12 }}>{a.entity_id?.slice(0, 8)}</div></span> }, { key: 'ip', label: 'From', render: (a) => <span className="mono muted">{a.ip}</span> },
  ];
  return (
    <>
      <PageHead title="Audit" accent="log" subtitle="A permanent record of who did what, when and from where. Entries cannot be edited or deleted, and each one is chained to the one before so tampering shows up."
        actions={<><button className="btn outline" disabled={busy} onClick={async () => { setBusy(true); try { setVerify(await api.get('/audit/verify')); } catch (e) { setVerify(null); } setBusy(false); }}>{busy ? 'Checking…' : 'Verify the chain'}</button>{is('super_admin', 'auditor') && <button className="btn outline" onClick={() => download('/audit/export', 'audit-log.csv').catch((e: ApiError) => alert(e.message))}>Export CSV</button>}</>} />
      {verify && <div className={`alert ${verify.ok ? 'ok' : 'danger'}`} style={{ marginBottom: 16 }} role="status">{verify.ok ? <><b>The audit log is intact.</b> {verify.checked.toLocaleString('en-GB')} entries checked just now. None have been changed or removed.</> : <><b>The audit log has been tampered with.</b> The first broken entry is number {verify.first_bad_seq}{verify.missing_entries ? `, and ${verify.missing_entries} entries are missing` : ''}. Tell your security lead now.</>}</div>}
      <div className="row wrap" style={{ marginBottom: 16 }}><div className="field"><label htmlFor="f">From</label><input id="f" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div><div className="field"><label htmlFor="t">To</label><input id="t" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div></div>
      <DataList path="/audit" columns={columns} pageSize={50} searchPlaceholder="Search who or what" extra={{ from: from || undefined, to: to || undefined }}
        filters={[{ name: 'entity_type', label: 'Record', options: ['user', 'programme', 'enrollment', 'result', 'certificate', 'invoice', 'payment', 'settings', 'integration', 'document', 'session', 'exam_attempt', 'organization', 'course'].map((v) => ({ value: v, label: v })) }]}
        actions={(a) => <button className="btn ghost sm" onClick={() => setDetail(a)}>Details</button>} />
      {detail && <Modal title={detail.action} size="wide" onClose={() => setDetail(null)}><div className="stack"><div className="muted">{dateTime(detail.at)} · {detail.actor_email} · {detail.ip}</div><div className="grid c2"><Card title="Before"><pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12.5 }}>{detail.before_data ? JSON.stringify(detail.before_data, null, 2) : 'None'}</pre></Card><Card title="After"><pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12.5 }}>{detail.after_data ? JSON.stringify(detail.after_data, null, 2) : 'None'}</pre></Card></div><Badge tone="neutral">Entry {detail.seq}</Badge></div></Modal>}
    </>
  );
}
