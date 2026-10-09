'use client';
import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Column, DataList } from '@/components/datalist';
import { FormModal } from '@/components/form';
import { ChecklistPicker } from '@/components/picker';
import { useToast } from '@/components/toast';
import { Badge, Card, ConfirmModal, ErrorNote, KV, Loading, Modal, PageHead, Tabs, Tile } from '@/components/ui';
import { date, dateTime, fromLocalInput, label, money, pct, toLocalInput } from '@/lib/format';
import { programmeFields } from '@/lib/programme-fields';
import { useClassroomOptions, useInstructorOptions, useOrgOptions } from '@/lib/options';

const NEXT: Record<string, { to: string; label: string; primary?: boolean }[]> = {
  draft: [{ to: 'open_for_registration', label: 'Open registration', primary: true }],
  open_for_registration: [{ to: 'registration_closed', label: 'Close registration' }],
  registration_closed: [{ to: 'ongoing', label: 'Start programme', primary: true }, { to: 'open_for_registration', label: 'Reopen registration' }],
  ongoing: [{ to: 'completed', label: 'Mark completed', primary: true }],
};

export default function ProgrammePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me, can, is } = useAuth();
  const toast = useToast();
  const prog = useApi<any>(`/programmes/${id}`);
  const instructors = useInstructorOptions(can('programmes:write')); const rooms = useClassroomOptions(); const orgs = useOrgOptions(can('programmes:write'));
  const staff = is('super_admin', 'training_admin');
  const [tab, setTab] = useState('overview');
  const [edit, setEdit] = useState(false);
  const [session, setSession] = useState<'new' | any | null>(null);
  const [cancel, setCancel] = useState(false);
  const [enrolOpen, setEnrolOpen] = useState(false);
  const [tick, setTick] = useState(0);
  if (prog.error) return <ErrorNote error={prog.error} />;
  if (!prog.data) return <Loading />;
  const p = prog.data; const bump = () => { setTick((t) => t + 1); prog.reload(); };
  const done = ['completed', 'cancelled'].includes(p.status);

  async function move(to: string) { try { await api.post(`/programmes/${id}/status`, { status: to }); toast('Updated'); bump(); } catch (e) { toast((e as ApiError).message, 'error'); } }

  const sessionFields = [
    { name: 'title', label: 'Title', required: true, full: true }, { name: 'kind', label: 'Kind', type: 'select' as const, required: true, options: ['class', 'exam', 'practical'].map((v) => ({ value: v, label: label(v) })) },
    { name: 'instructor_id', label: 'Instructor', type: 'select' as const, options: instructors }, { name: 'starts_at', label: 'Starts (UTC)', type: 'datetime' as const, required: true }, { name: 'ends_at', label: 'Ends (UTC)', type: 'datetime' as const, required: true },
    { name: 'classroom_id', label: 'Classroom', type: 'select' as const, options: rooms }, { name: 'location', label: 'Location' },
  ];
  const regs: Column<any>[] = [
    { key: 'trainee_name', label: 'Trainee', render: (e) => <b style={{ fontWeight: 600 }}>{e.trainee_name}</b>, href: (e) => (can('users:read') ? `/people/${e.trainee_id}` : undefined) },
    ...(staff || is('auditor') ? [{ key: 'organization_name', label: 'Organisation', render: (e: any) => e.organization_name ?? <span className="muted">Individual</span> }] : []),
    { key: 'status', label: 'Status', render: (e) => <Badge value={e.status} /> },
    ...(can('invoices:read') && !is('instructor') ? [{ key: 'invoice_status', label: 'Payment', render: (e: any) => (e.invoice_status ? <Badge value={e.invoice_status} /> : <span className="muted">{e.fee > 0 ? '' : 'Free'}</span>) }] : []),
  ];
  const results: Column<any>[] = [
    { key: 'trainee_name', label: 'Trainee' }, ...(staff ? [{ key: 'organization_name', label: 'Organisation', render: (r: any) => r.organization_name ?? '' }] : []),
    { key: 'final_score', label: 'Score', num: true, render: (r) => (r.final_score === null ? '' : pct(r.final_score, 1)) }, { key: 'attendance_pct', label: 'Attendance', num: true, render: (r) => (r.attendance_pct === null ? '' : pct(r.attendance_pct, 0)) },
    { key: 'status', label: 'Result', render: (r) => <Badge value={r.status} /> }, { key: 'finalised', label: 'State', render: (r) => (r.finalised ? <Badge tone={r.released ? 'ok' : 'info'}>{r.released ? 'Released' : 'Final'}</Badge> : <span className="muted">Draft</span>) },
    { key: 'certificate_number', label: 'Certificate', render: (r) => (r.certificate_id ? <Link href={`/certificates/${r.certificate_id}`} className="mono">{r.certificate_number}</Link> : '') },
  ];
  const asms: Column<any>[] = [{ key: 'title', label: 'Assessment', href: (a) => `/assessments/${a.id}` }, { key: 'kind', label: 'Kind', render: (a) => label(a.kind) }, { key: 'question_count', label: 'Questions', num: true }, { key: 'status', label: 'Status', render: (a) => <Badge value={a.status} /> }, { key: 'awaiting_marking', label: 'To mark', num: true }];

  return (
    <>
      <PageHead title={p.title} crumbs={[{ label: 'Programmes', href: '/programmes' }, { label: p.code }]} subtitle={<><span className="mono">{p.code}</span> · {date(p.start_date)}{p.end_date !== p.start_date && ` to ${date(p.end_date)}`} · <Badge value={p.status} />{p.organization_name && <> · Reserved for <b>{p.organization_name}</b></>}</>}
        actions={<>
          {is('trainee') && p.status === 'open_for_registration' && <RegisterSelf id={id} onDone={bump} />}
          {staff && !done && <button className="btn outline" onClick={() => setEdit(true)}>Edit</button>}
          {staff && NEXT[p.status]?.map((n) => <button key={n.to} className={`btn ${n.primary ? '' : 'outline'}`} onClick={() => move(n.to)}>{n.label}</button>)}
          {staff && !done && <button className="btn danger" onClick={() => setCancel(true)}>Cancel programme</button>}
        </>} />
      <div className="grid c4" style={{ marginBottom: 20 }}>
        <Tile name="Confirmed" value={p.confirmed_count} total={p.capacity} /><Tile name="Places left" value={Math.max(0, p.seats_left)} total={p.capacity} tone={p.seats_left <= 0 ? 'warn' : undefined} />
        <Tile name="Pass mark" value={p.pass_mark} unit="percent" /><Tile name="Minimum attendance" value={p.min_attendance_pct} unit="percent" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Overview' }, { key: 'sessions', label: 'Sessions', count: p.sessions.length }, { key: 'regs', label: 'Registrations' }, ...(can('attendance:read') ? [{ key: 'att', label: 'Attendance' }] : []), ...(can('assessments:read') && !is('trainee') ? [{ key: 'asm', label: 'Assessments' }] : []), ...(can('results:read') ? [{ key: 'res', label: 'Results' }] : [])]} />
      {tab === 'overview' && <div className="grid c2"><Card title="Details"><KV items={[['Course', <Link key="c" href={`/courses/${p.course_id}`}>{p.course_code} · {p.course_title}</Link>], ['Lead instructor', p.lead_instructor_name], ['Location', p.location], ['Delivery', label(p.delivery_method)], ['Fee', money(p.fee, p.currency)], ['Registration closes', p.registration_deadline && date(p.registration_deadline)], ['Capacity', p.capacity]]} /></Card>
        <Card title="Rules for this programme"><KV items={[['Pass mark', `${p.pass_mark}%`], ['Minimum attendance', `${p.min_attendance_pct}%`], ['Certificate', p.validity_months ? `Valid for ${p.validity_months} months` : 'Does not expire']]} /></Card></div>}
      {tab === 'sessions' && (
        <Card title="Schedule" actions={staff && !done && <button className="btn sm" onClick={() => setSession('new')}>Add session</button>} flush>
          {p.sessions.length === 0 ? <div className="empty muted">No sessions scheduled yet.</div> : (
            <table className="table"><thead><tr><th>Session</th><th>When</th><th>Instructor</th><th>Room</th><th /></tr></thead><tbody>{p.sessions.map((s: any) => (
              <tr key={s.id}><td><b style={{ fontWeight: 600 }}>{s.title}</b> <Badge tone="neutral">{label(s.kind)}</Badge></td><td>{dateTime(s.starts_at)} to {new Date(s.ends_at).toISOString().slice(11, 16)}</td><td>{s.instructor_name}</td><td>{s.classroom_name ?? s.location}</td>
                <td className="actions">{can('attendance:read') && <Link href={`/attendance/${s.id}`} className="btn outline sm">Roster</Link>} {staff && !done && <button className="btn ghost sm" onClick={() => setSession(s)}>Edit</button>}</td></tr>))}</tbody></table>)}
        </Card>
      )}
      {tab === 'regs' && (
        <div className="stack">
          {(staff || is('org_admin')) && !done && <div><button className="btn" onClick={() => setEnrolOpen(true)}>{is('org_admin') ? 'Register employees' : 'Register trainees'}</button></div>}
          <DataList path="/enrollments" extra={{ programme_id: id }} columns={regs} refreshKey={tick} searchPlaceholder="Search trainee" empty={{ title: 'Nobody registered yet' }}
            actions={(e, reload) => !['cancelled', 'completed'].includes(e.status) && !is('instructor') && !is('finance_officer') && !is('auditor') && (
              <span className="row" style={{ justifyContent: 'flex-end' }}>
                {staff && e.status === 'pending' && <button className="btn outline sm" onClick={async () => { try { await api.post(`/enrollments/${e.id}/confirm`, {}); toast('Place confirmed'); reload(); prog.reload(); } catch (err) { toast((err as ApiError).message, 'error'); } }}>Confirm</button>}
                <CancelButton id={e.id} onDone={() => { reload(); prog.reload(); }} />
              </span>)} />
        </div>
      )}
      {tab === 'att' && <AttendanceSummary id={id} />}
      {tab === 'asm' && <div className="stack">{can('assessments:write') && <div><Link href={`/assessments?new=1&programme=${id}&course=${p.course_id}`} className="btn">New assessment</Link></div>}<DataList path="/assessments" extra={{ programme_id: id }} columns={asms} search={false} empty={{ title: 'No assessments yet' }} /></div>}
      {tab === 'res' && <ResultsTab id={id} columns={results} tick={tick} onChange={bump} />}

      {edit && <FormModal title="Edit programme" size="wide" fields={programmeFields({ courses: [], rooms, instructors, orgs, creating: false })} initial={p} onClose={() => setEdit(false)} onSubmit={async (v) => { await api.patch(`/programmes/${id}`, v); toast('Saved'); bump(); }} />}
      {session && <FormModal title={session === 'new' ? 'Add session' : 'Edit session'} size="wide" fields={sessionFields} initial={session === 'new' ? { kind: 'class', starts_at: '', ends_at: '', instructor_id: p.lead_instructor_id ?? '', classroom_id: p.classroom_id ?? '' } : { ...session, starts_at: toLocalInput(session.starts_at), ends_at: toLocalInput(session.ends_at) }}
        onClose={() => setSession(null)} onSubmit={async (v) => { session === 'new' ? await api.post(`/programmes/${id}/sessions`, v) : await api.patch(`/sessions/${session.id}`, v); toast('Session saved'); bump(); }}>
        <p className="muted" style={{ fontSize: 13 }}>An instructor or classroom cannot be booked twice at the same time. If there is a clash, you will be told what it clashes with.</p></FormModal>}
      {cancel && <ConfirmModal title="Cancel this programme?" message="Every registration is cancelled and the trainees are told. Unpaid invoices are cancelled. This cannot be undone." askReason="Reason for cancelling" danger confirmLabel="Cancel programme" onClose={() => setCancel(false)} onConfirm={async (reason) => { await api.post(`/programmes/${id}/status`, { status: 'cancelled', reason }); toast('Programme cancelled'); bump(); }} />}
      {enrolOpen && <EnrolModal programmeId={id} orgFixed={is('org_admin') ? me.organization?.id : p.organization_id} onClose={() => setEnrolOpen(false)} onDone={bump} />}
    </>
  );
}

function RegisterSelf({ id, onDone }: { id: string; onDone: () => void }) {
  const toast = useToast();
  const mine = useApi<{ data: any[] }>(`/enrollments?programme_id=${id}`);
  const already = mine.data?.data.find((e) => e.status !== 'cancelled');
  if (already) return <Badge value={already.status} />;
  return <button className="btn" onClick={async () => { try { const r = await api.post('/enrollments', { programme_id: id }); toast(r.status === 'waitlisted' ? 'You are on the waiting list' : 'Registration received'); mine.reload(); onDone(); } catch (e) { toast((e as ApiError).message, 'error'); } }}>Register</button>;
}

function CancelButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  return <><button className="btn ghost sm" onClick={() => setOpen(true)}>Cancel</button>{open && <ConfirmModal title="Cancel this registration?" askReason="Reason" danger confirmLabel="Cancel registration" onClose={() => setOpen(false)} onConfirm={async (reason) => { await api.post(`/enrollments/${id}/cancel`, { reason }); toast('Registration cancelled'); onDone(); }} />}</>;
}

function EnrolModal({ programmeId, orgFixed, onClose, onDone }: { programmeId: string; orgFixed?: string | null; onClose: () => void; onDone: () => void }) {
  const { data } = useApi<{ data: any[] }>(`/users?role=trainee&limit=200${orgFixed ? `&organization_id=${orgFixed}` : ''}`);
  const items = useMemo(() => (data?.data ?? []).map((u) => ({ value: u.id, label: u.full_name, sub: u.email, group: u.organization_name ?? 'Individuals' })), [data]);
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ enrolled: any[]; failed: { trainee_id: string; reason: string }[] } | null>(null);
  const toast = useToast();
  const names = useMemo(() => new Map(items.map((i) => [i.value, i.label])), [items]);
  return (
    <Modal title="Register trainees" size="wide" onClose={onClose} footer={result ? <button className="btn" onClick={() => { onDone(); onClose(); }}>Done</button> : <><button className="btn outline" onClick={onClose}>Cancel</button>
      <button className="btn" disabled={!sel.length || busy} onClick={async () => { setBusy(true); try { const r = await api.post(`/programmes/${programmeId}/enrol`, { trainee_ids: sel }); setResult(r); if (!r.failed.length) toast(`${r.enrolled.length} registered`); } catch (e) { toast((e as ApiError).message, 'error'); } setBusy(false); }}>{busy ? 'Registering…' : `Register ${sel.length || ''}`}</button></>}>
      {result ? (
        <div className="stack"><div className="alert ok"><b>{result.enrolled.length} registered.</b> An invoice is raised for each paid place.</div>
          {result.failed.length > 0 && <div className="alert warn"><b>{result.failed.length} could not be registered.</b><ul style={{ margin: '6px 0 0 18px' }}>{result.failed.map((f) => <li key={f.trainee_id}>{names.get(f.trainee_id)}: {f.reason}</li>)}</ul></div>}</div>
      ) : <ChecklistPicker items={items} selected={sel} onChange={setSel} placeholder="Search trainees" />}
    </Modal>
  );
}

function AttendanceSummary({ id }: { id: string }) {
  const { data, error } = useApi<any[]>(`/programmes/${id}/attendance-summary`);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  return <Card flush>{data.length === 0 ? <div className="empty muted">No confirmed trainees yet.</div> : <table className="table"><thead><tr><th>Trainee</th><th className="num">Sessions held</th><th className="num">Present</th><th className="num">Late</th><th className="num">Excused</th><th className="num">Absent</th><th className="num">Attendance</th></tr></thead><tbody>{data.map((r) => <tr key={r.trainee_id}><td>{r.full_name}</td><td className="num">{r.counted_sessions}</td><td className="num">{r.present}</td><td className="num">{r.late}</td><td className="num">{r.excused}</td><td className="num">{r.absent}</td><td className="num">{r.attendance_pct === null ? '' : pct(r.attendance_pct, 0)}</td></tr>)}</tbody></table>}</Card>;
}

function ResultsTab({ id, columns, tick, onChange }: { id: string; columns: Column<any>[]; tick: number; onChange: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState<any | null>(null);
  const run = async (path: string, msg: (r: any) => string) => { setBusy(true); try { const r = await api.post(path); toast(msg(r)); onChange(); } catch (e) { toast((e as ApiError).message, 'error'); } setBusy(false); };
  return (
    <div className="stack">
      <div className="row wrap">
        {(can('results:finalise') || can('attempts:mark')) && <button className="btn outline" disabled={busy} onClick={() => run(`/programmes/${id}/results/compute`, (r) => `${r.computed} results recalculated`)}>Recalculate results</button>}
        {can('results:finalise') && <><button className="btn outline" disabled={busy} onClick={() => run(`/programmes/${id}/results/finalise-all`, (r) => `${r.finalised} finalised${r.blocked.length ? `, ${r.blocked.length} blocked: ${r.blocked[0].reason}` : ''}`)}>Finalise all ready results</button>
          <button className="btn" disabled={busy} onClick={() => run(`/programmes/${id}/results/release`, (r) => `${r.released} released to trainees`)}>Release results</button></>}
      </div>
      <div className="muted" style={{ fontSize: 13.5 }}>Results are worked out from attendance and marked assessments once the programme has ended. Finalising makes a result official and issues the certificate. Whoever marked someone's work cannot finalise it.</div>
      <DataList path="/results" extra={{ programme_id: id }} columns={columns} refreshKey={tick} searchPlaceholder="Search trainee" empty={{ title: 'No results yet', hint: 'Results appear once trainees are confirmed.' }}
        actions={(r, reload) => can('results:finalise') && (<span className="row" style={{ justifyContent: 'flex-end' }}>
          {!r.finalised && r.status !== 'pending' && <button className="btn outline sm" onClick={async () => { try { await api.post(`/results/${r.id}/finalise`, {}); toast('Finalised'); reload(); onChange(); } catch (e) { toast((e as ApiError).message, 'error'); } }}>Finalise</button>}
          {r.finalised && can('results:override') && <button className="btn ghost sm" onClick={() => setOverride(r)}>Change</button>}</span>)} />
      {override && <FormModal title={`Change result for ${override.trainee_name}`} size="narrow" fields={[{ name: 'status', label: 'New result', type: 'select', required: true, options: ['pass', 'fail', 'absent', 'disqualified'].map((v) => ({ value: v, label: label(v) })) }, { name: 'reason', label: 'Reason', type: 'textarea', required: true, full: true, help: 'At least 10 characters. Kept permanently in the audit log. A different administrator from the one who finalised must make the change.' }]} initial={{ status: override.status }}
        onClose={() => setOverride(null)} onSubmit={async (v) => { await api.post(`/results/${override.id}/override`, v); toast('Result changed'); onChange(); }} />}
    </div>
  );
}
