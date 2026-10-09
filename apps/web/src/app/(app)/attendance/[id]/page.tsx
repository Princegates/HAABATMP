'use client';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api, ApiError, useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/toast';
import { Badge, Card, ErrorNote, Loading, PageHead } from '@/components/ui';
import { dateTime, time } from '@/lib/format';

const STATUSES = ['present', 'late', 'absent', 'excused'];

function QrPanel({ id }: { id: string }) {
  const [src, setSrc] = useState('');
  const [left, setLeft] = useState(0);
  const [err, setErr] = useState('');
  const [big, setBig] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ token: string; expires_in: number }>(`/sessions/${id}/qr`);
      // a link, so a phone's own camera app opens the check-in page directly
      setSrc(await QRCode.toDataURL(`${window.location.origin}/checkin?t=${encodeURIComponent(r.token)}`, { margin: 1, width: 480, errorCorrectionLevel: 'M' }));
      setLeft(r.expires_in); setErr('');
      timer.current = setTimeout(refresh, Math.max(3, r.expires_in - 3) * 1000);
    } catch (e) { setErr((e as ApiError).message); timer.current = setTimeout(refresh, 15000); }
  }, [id]);
  useEffect(() => { refresh(); return () => clearTimeout(timer.current); }, [refresh]);
  useEffect(() => { const t = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000); return () => clearInterval(t); }, []);
  return (
    <Card title="Check-in code">
      {err ? <div className="alert danger">{err}</div> : (
        <div className="stack tight" style={{ alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {src ? <img src={src} alt="Check-in QR code" width={big ? 420 : 200} height={big ? 420 : 200} style={{ background: '#fff', padding: 8, imageRendering: 'pixelated' }} /> : <Loading />}
          <div className="muted" style={{ fontSize: 13, textAlign: 'center' }}>Changes every 30 seconds, so a photo of it is no use for long. Trainees scan it with their phone.</div>
          <div className="row"><span className="badge neutral mono">{left}s</span><button className="btn outline sm" onClick={() => setBig((b) => !b)}>{big ? 'Smaller' : 'Show larger'}</button></div>
        </div>
      )}
    </Card>
  );
}

export default function RosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useApi<{ session: any; roster: any[] }>(`/sessions/${id}/attendance`);
  const [marks, setMarks] = useState<Record<string, { status: string; note: string }>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setMarks(Object.fromEntries(data.roster.filter((r) => r.status).map((r) => [r.trainee_id, { status: r.status, note: r.note ?? '' }]))); }, [data]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const { session: s, roster } = data;
  const write = can('attendance:write');
  const set = (tid: string, patch: Partial<{ status: string; note: string }>) => setMarks((m) => ({ ...m, [tid]: { status: m[tid]?.status ?? 'present', note: m[tid]?.note ?? '', ...patch } }));
  const unmarked = roster.filter((r) => !marks[r.trainee_id]);
  async function save() {
    setBusy(true);
    try { await api.put(`/sessions/${id}/attendance`, { records: Object.entries(marks).map(([trainee_id, m]) => ({ trainee_id, status: m.status, note: m.note || null })) }); toast('Attendance saved'); reload(); }
    catch (e) { toast((e as ApiError).message, 'error'); }
    setBusy(false);
  }
  const present = Object.values(marks).filter((m) => m.status === 'present' || m.status === 'late').length;
  return (
    <>
      <PageHead title={s.title} crumbs={[{ label: 'Attendance', href: '/attendance' }, { label: s.programme_code }]} subtitle={<>{s.programme_title} · {dateTime(s.starts_at)} to {time(s.ends_at)}</>}
        actions={write && <><button className="btn outline" onClick={() => setMarks(Object.fromEntries(roster.map((r) => [r.trainee_id, { status: 'present', note: marks[r.trainee_id]?.note ?? '' }])))}>Mark everyone present</button><button className="btn" disabled={busy || Object.keys(marks).length === 0} onClick={save}>{busy ? 'Saving…' : 'Save attendance'}</button></>} />
      <div className="grid" style={{ gridTemplateColumns: write ? 'minmax(0, 1fr) 280px' : '1fr', alignItems: 'start' }}>
        <Card title={`Roster (${present} of ${roster.length} here)`} flush>
          {roster.length === 0 ? <div className="empty muted">Nobody is confirmed on this programme yet.</div> : (
            <table className="table"><thead><tr><th>Trainee</th><th>Organisation</th><th>Status</th><th>Note</th><th>How</th></tr></thead><tbody>{roster.map((r) => {
              const m = marks[r.trainee_id];
              return (
                <tr key={r.trainee_id}><td><b style={{ fontWeight: 600 }}>{r.full_name}</b></td><td className="muted">{r.organization_name ?? 'Individual'}</td>
                  <td>{write ? <select aria-label={`Status for ${r.full_name}`} value={m?.status ?? ''} onChange={(e) => set(r.trainee_id, { status: e.target.value })} style={{ width: 130 }}><option value="" disabled>Not marked</option>{STATUSES.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}</select> : r.status ? <Badge value={r.status} /> : <span className="muted">Not marked</span>}</td>
                  <td>{write ? <input type="text" aria-label={`Note for ${r.full_name}`} value={m?.note ?? ''} onChange={(e) => set(r.trainee_id, { note: e.target.value })} disabled={!m} /> : r.note}</td>
                  <td className="muted">{r.method === 'qr' ? 'Scanned' : r.method === 'manual' ? 'Marked by instructor' : ''}</td></tr>);
            })}</tbody></table>)}
          {write && unmarked.length > 0 && <div style={{ padding: '12px 20px' }} className="muted">{unmarked.length} not marked yet. Anyone left unmarked counts as absent once the session has ended.</div>}
        </Card>
        {write && <QrPanel id={id} />}
      </div>
    </>
  );
}
