'use client';
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Badge, Card, ConfirmModal, ErrorNote, Loading } from '@/components/ui';
import { pct } from '@/lib/format';

interface Q { id: string; type: string; prompt: string; options: any; marks: number }
interface Payload { resumed: boolean; attempt: { id: string; attempt_no: number; deadline_at: string; server_time: string }; assessment: { title: string; duration_minutes: number; pass_mark: number }; questions: Q[]; answers: Record<string, any> }

const fmt = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`; };

export default function SitExam({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [p, setP] = useState<Payload | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [now, setNow] = useState(Date.now());
  const [state, setState] = useState<'sitting' | 'done' | 'timeup'>('sitting');
  const [confirm, setConfirm] = useState(false);
  const [saveNote, setSaveNote] = useState('');
  const offset = useRef(0); // server time minus browser time, so a wrong device clock cannot add or remove minutes
  const dirty = useRef<Record<string, any>>({});
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; started.current = true;
    api.post<Payload>(`/assessments/${id}/start`).then((r) => { offset.current = new Date(r.attempt.server_time).getTime() - Date.now(); setP(r); setAnswers(r.answers); }).catch((e) => setError(e));
  }, [id]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const flush = useCallback(async () => {
    if (!p || !Object.keys(dirty.current).length) return true;
    const batch = dirty.current; dirty.current = {};
    try { await api.put(`/attempts/${p.attempt.id}/answers`, { answers: batch }); setSaveNote(`Saved ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`); return true; }
    catch (e) {
      const ae = e as ApiError;
      if (ae.code === 'TIME_UP') { setState('timeup'); return false; }
      dirty.current = { ...batch, ...dirty.current }; setSaveNote('Not saved yet. Retrying…'); return false;
    }
  }, [p]);
  useEffect(() => { const t = setInterval(flush, 4000); return () => clearInterval(t); }, [flush]);
  useEffect(() => { const h = (e: BeforeUnloadEvent) => { if (state === 'sitting' && Object.keys(dirty.current).length) { e.preventDefault(); } }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [state]);

  const deadline = p ? new Date(p.attempt.deadline_at).getTime() : 0;
  const remaining = p ? deadline - (now + offset.current) : 0;
  const submit = useCallback(async () => {
    if (!p) return;
    await flush();
    try { await api.post(`/attempts/${p.attempt.id}/submit`); setState('done'); } catch (e) { if ((e as ApiError).status === 409) setState('timeup'); else throw e; }
  }, [p, flush]);
  useEffect(() => { if (p && state === 'sitting' && remaining <= 0) submit().catch(() => undefined); }, [remaining, p, state, submit]);

  const set = (qid: string, v: any) => { setAnswers((a) => ({ ...a, [qid]: v })); dirty.current[qid] = v; };
  const answered = useMemo(() => p?.questions.filter((q) => { const v = answers[q.id]; return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0); }).length ?? 0, [answers, p]);

  if (error) return <div className="stack"><ErrorNote error={error} /><Link href="/exams" className="btn outline" style={{ alignSelf: 'flex-start' }}>Back to my assessments</Link></div>;
  if (!p) return <Loading what="Starting your assessment" />;
  if (state !== 'sitting') return (
    <Card title={state === 'done' ? 'Submitted' : 'Time is up'}>
      <div className="stack"><div className={`alert ${state === 'done' ? 'ok' : 'warn'}`}>{state === 'done' ? 'Your answers have been submitted.' : 'Time ran out, so your saved answers were submitted for you.'}</div>
        <p className="muted">Your result will appear under My assessments once it has been marked and released.</p><Link href="/exams" className="btn" style={{ alignSelf: 'flex-start' }}>Back to my assessments</Link></div>
    </Card>
  );
  const low = remaining < 5 * 60000;
  return (
    <>
      <div className="card" style={{ position: 'sticky', top: 64, zIndex: 20, marginBottom: 20 }}>
        <div className="card-body row between wrap" style={{ padding: '12px 20px' }}>
          <div><h2 style={{ fontSize: 22 }}>{p.assessment.title}</h2><div className="muted" style={{ fontSize: 13 }}>Attempt {p.attempt.attempt_no} · {answered} of {p.questions.length} answered · {saveNote || 'Answers save as you go'}</div></div>
          <div className="row"><span role="timer" aria-live="off" className="mono" style={{ fontFamily: 'var(--font-display)', fontSize: 34, color: low ? 'var(--danger)' : 'var(--text)' }}>{fmt(remaining)}</span><button className="btn" onClick={() => setConfirm(true)}>Submit</button></div>
        </div>
      </div>
      <div className="stack" style={{ maxWidth: 860 }}>
        {p.questions.map((q, i) => (
          <Card key={q.id} title={<>Question {i + 1} <span className="muted" style={{ fontSize: 14 }}>· {q.marks} mark{q.marks === 1 ? '' : 's'}</span></>}>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ fontSize: 17, fontWeight: 500, marginBottom: 12, padding: 0 }}>{q.prompt}</legend>
              <Answer q={q} value={answers[q.id]} onChange={(v) => set(q.id, v)} />
            </fieldset>
          </Card>
        ))}
        <div><button className="btn" onClick={() => setConfirm(true)}>Submit my answers</button></div>
      </div>
      {confirm && <ConfirmModal title="Submit your answers?" message={<>You have answered <b>{answered} of {p.questions.length}</b> questions. Once you submit you cannot change them.{answered < p.questions.length && <div className="alert warn" style={{ marginTop: 10 }}>{p.questions.length - answered} unanswered question{p.questions.length - answered === 1 ? '' : 's'} will score zero.</div>}</>} confirmLabel="Submit" onClose={() => setConfirm(false)} onConfirm={submit} />}
    </>
  );
}

function Answer({ q, value, onChange }: { q: Q; value: any; onChange: (v: any) => void }) {
  const name = `q_${q.id}`;
  if (q.type === 'mcq_single') return <div className="stack tight">{(q.options as string[]).map((o, i) => <label key={i} className="check"><input type="radio" name={name} checked={value === i} onChange={() => onChange(i)} /><span>{o}</span></label>)}</div>;
  if (q.type === 'mcq_multi') { const cur: number[] = Array.isArray(value) ? value : []; return <div className="stack tight">{(q.options as string[]).map((o, i) => <label key={i} className="check"><input type="checkbox" checked={cur.includes(i)} onChange={() => onChange(cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i])} /><span>{o}</span></label>)}<span className="muted" style={{ fontSize: 13 }}>Choose all that apply. A wrong choice cancels out a right one.</span></div>; }
  if (q.type === 'true_false') return <div className="row">{[true, false].map((b) => <label key={String(b)} className="check"><input type="radio" name={name} checked={value === b} onChange={() => onChange(b)} /><span>{b ? 'True' : 'False'}</span></label>)}</div>;
  if (q.type === 'short_answer') return <input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label="Your answer" autoComplete="off" />;
  if (q.type === 'matching') { const cur: (number | null)[] = Array.isArray(value) ? value : []; const { left, right } = q.options as { left: string[]; right: string[] }; return <div className="stack tight">{left.map((l, i) => <div key={i} className="row"><span style={{ flex: 1 }}>{l}</span><select style={{ flex: 1 }} aria-label={`Match for ${l}`} value={cur[i] ?? ''} onChange={(e) => { const n = [...left.map((_, j) => cur[j] ?? null)]; n[i] = e.target.value === '' ? null : Number(e.target.value); onChange(n); }}><option value="">Choose…</option>{right.map((r, j) => <option key={j} value={j}>{r}</option>)}</select></div>)}</div>; }
  return <textarea value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label="Your answer" style={{ minHeight: 180 }} />;
}
