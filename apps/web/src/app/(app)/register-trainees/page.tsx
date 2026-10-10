'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, ApiError, useApi } from '@/lib/api';
import { Badge, Card, ErrorNote, Loading, PageHead } from '@/components/ui';
import { date } from '@/lib/format';

interface Row { row: number; email: string; full_name: string; phone: string | null; aviation_role: string | null; employer: string | null; status: 'new' | 'existing' | 'invalid' | 'duplicate'; notes: string[] }
interface Preview { total: number; new: number; existing: number; skipped: number; rows: Row[]; can_import: boolean }
interface Result { created: number; existing: number; skipped: number; failed: { email: string; reason: string }[]; enrolled?: number; enrol_failed?: { reason: string }[] }

/** Upload an Excel list of trainees: check it, then register them. Optionally put everyone on a programme in the same step. */
export default function RegisterTrainees() {
  const options = useApi<{ organizations: { id: string; name: string }[]; programmes: { id: string; code: string; title: string; start_date: string; end_date: string; organization_id: string | null }[] }>('/trainees/register-options');
  const [org, setOrg] = useState('');
  const [prog, setProg] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (options.error) return <ErrorNote error={options.error} />;
  if (!options.data) return <Loading />;
  const o = options.data;

  async function send(commit: boolean) {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.append('organization_id', org); fd.append('programme_id', prog); fd.append('commit', commit ? 'true' : 'false'); fd.append('file', file);
      const r = await api.upload<any>('/trainees/import-file', fd);
      if (!commit) { setPreview(r); setBusy(false); return; }
      const out: Result = { created: r.created, existing: r.existing, skipped: r.skipped, failed: r.failed };
      if (prog && r.trainee_ids.length) {
        try {
          const e = await api.post<any>(`/programmes/${prog}/enrol`, { trainee_ids: r.trainee_ids });
          out.enrolled = e.enrolled.length; out.enrol_failed = e.failed;
        } catch (err) { out.enrol_failed = [{ reason: (err as ApiError).message }]; }
      }
      setResult(out); setPreview(null);
    } catch (e) { setError((e as ApiError).message); setPreview(null); }
    setBusy(false);
  }
  const reset = () => { setFile(null); setPreview(null); setResult(null); setError(''); };

  if (result) {
    return (
      <>
        <PageHead title="Register" accent="trainees" />
        <Card>
          <div className="stack">
            <div className="alert ok"><b>{result.created} new trainee{result.created === 1 ? '' : 's'} registered.</b> Each one is sent an invitation to set up their sign-in.</div>
            {result.existing > 0 && <div className="alert info">{result.existing} already had an account and were not duplicated.</div>}
            {result.enrolled !== undefined && <div className="alert ok"><b>{result.enrolled} registered on the programme.</b> Their places are pending until HAAB staff confirm them.</div>}
            {!!result.enrol_failed?.length && <div className="alert warn"><b>{result.enrol_failed.length} could not be put on the programme.</b><ul style={{ margin: '6px 0 0 18px' }}>{result.enrol_failed.map((f, i) => <li key={i}>{f.reason}</li>)}</ul></div>}
            {result.skipped > 0 && <div className="alert warn">{result.skipped} row{result.skipped === 1 ? ' was' : 's were'} skipped because of problems or duplicates.</div>}
            {result.failed.length > 0 && <div className="alert danger"><b>{result.failed.length} could not be created.</b><ul style={{ margin: '6px 0 0 18px' }}>{result.failed.map((f) => <li key={f.email}>{f.email}: {f.reason}</li>)}</ul></div>}
            <div className="row"><button className="btn" onClick={reset}>Register another list</button></div>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHead title="Register" accent="trainees" subtitle="Already have a list of trainees? Upload it from Excel and they are registered in one go. Each person is sent an invitation to set up their sign-in." />
      <Card>
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>1. <a href="/templates/trainee-list.xlsx" download>Download the Excel template</a> and fill it in (Full name and Email are required). 2. Choose where the trainees belong. 3. Upload the file and check it. 4. Register.</p>
          <div className="form-grid">
            <div className="field"><label htmlFor="rt-org">Organisation</label>
              <select id="rt-org" value={org} onChange={(e) => { setOrg(e.target.value); setPreview(null); }}><option value="">Individuals (no organisation)</option>{o.organizations.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              <span className="help">The client these trainees work for. Trainees are kept separate by organisation.</span></div>
            <div className="field"><label htmlFor="rt-prog">Also register them on a programme</label>
              <select id="rt-prog" value={prog} onChange={(e) => { setProg(e.target.value); setPreview(null); }}><option value="">No, just create their accounts</option>{o.programmes.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.title} ({date(p.start_date)})</option>)}</select>
              <span className="help">{o.programmes.length ? 'Only programmes you teach are listed.' : 'No programmes you teach are open for registration right now.'}</span></div>
            <div className="field full"><label htmlFor="rt-file">Excel file (.xlsx) or CSV</label>
              <input id="rt-file" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setError(''); }} />
              <span className="help">Up to 5 MB and 500 trainees. Headings: Full name, Email, Phone, Job role, Employer.</span></div>
          </div>
          {error && <div className="alert danger" role="alert">{error}</div>}
          {!preview && <div><button className="btn" disabled={busy || !file} onClick={() => send(false)}>{busy ? 'Reading…' : 'Check file'}</button></div>}
        </div>
      </Card>
      {preview && (
        <div style={{ marginTop: 20 }}>
          <Card title="What will happen" actions={<button className="btn" disabled={busy || !preview.can_import} onClick={() => send(true)}>{busy ? 'Registering…' : `Register ${preview.new + preview.existing} trainee${preview.new + preview.existing === 1 ? '' : 's'}`}</button>}>
            <div className="stack">
              <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <Badge tone="neutral">{preview.total} in the file</Badge><Badge tone="ok">{preview.new} new</Badge>
                {preview.existing > 0 && <Badge tone="info">{preview.existing} already registered</Badge>}
                {preview.skipped > 0 && <Badge tone="danger">{preview.skipped} skipped</Badge>}
              </div>
              {preview.skipped > 0 && <div className="alert warn">Skipped rows are left out. Fix them in your Excel file and upload again, or carry on without them.</div>}
              <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
                <table className="table">
                  <thead><tr><th>Row</th><th>Name</th><th>Email</th><th>Employer</th><th>Result</th></tr></thead>
                  <tbody>{preview.rows.map((r) => (
                    <tr key={r.row}><td>{r.row}</td><td>{r.full_name}</td><td>{r.email}</td><td>{r.employer ?? ''}</td>
                      <td>{r.status === 'new' ? <Badge tone="ok">New</Badge> : r.status === 'existing' ? <Badge tone="info">Already registered</Badge> : <span style={{ color: 'var(--danger)' }}>{r.notes.join('. ')}</span>}</td></tr>))}</tbody>
                </table>
              </div>
            </div>
          </Card>
        </div>
      )}
      <p className="muted" style={{ marginTop: 16, fontSize: 13.5 }}>Looking for someone already registered? See <Link href="/trainees">All trainees</Link>.</p>
    </>
  );
}
