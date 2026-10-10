'use client';
import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { FormModal } from '@/components/form';
import { ChecklistPicker } from '@/components/picker';
import { useToast } from '@/components/toast';
import { Badge, Card, ConfirmModal, ErrorNote, KV, Loading, Modal, PageHead } from '@/components/ui';
import { dateTime, label } from '@/lib/format';

export default function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const toast = useToast();
  const a = useApi<any>(`/assessments/${id}`);
  const [picking, setPicking] = useState(false);
  const [auto, setAuto] = useState(false);
  const [confirm, setConfirm] = useState<'publish' | 'close' | 'release' | null>(null);
  const [win, setWin] = useState(false);
  if (a.error) return <ErrorNote error={a.error} />;
  if (!a.data) return <Loading />;
  const x = a.data; const w = can('assessments:write'); const total = x.questions.reduce((s: number, q: any) => s + Number(q.assigned_marks), 0);
  const act = async (path: string, msg: string) => { try { await api.post(`/assessments/${id}/${path}`, {}); toast(msg); a.reload(); } catch (e) { toast((e as ApiError).message, 'error'); } };
  return (
    <>
      <PageHead title={x.title} crumbs={[{ label: 'Assessments', href: '/assessments' }, { label: x.title }]} subtitle={<><Badge value={x.status} /> · {label(x.kind)} · {x.duration_minutes} minutes · pass mark {x.pass_mark}%</>}
        actions={<>
          {w && (x.status === 'draft' || x.status === 'published') && <button className="btn outline" onClick={() => setWin(true)}>Opening times</button>}
          {w && x.status === 'draft' && <button className="btn outline" onClick={() => setPicking(true)}>Add questions</button>}
          {w && x.status === 'draft' && <button className="btn outline" onClick={() => setAuto(true)}>Pick at random</button>}
          {w && x.status === 'draft' && <button className="btn" onClick={() => setConfirm('publish')}>Publish</button>}
          {w && x.status === 'published' && <button className="btn outline" onClick={() => setConfirm('close')}>Close</button>}
          {can('attempts:mark') && x.status !== 'draft' && <><Link href={`/marking?assessment_id=${id}`} className="btn outline">Marking</Link><button className="btn" onClick={() => setConfirm('release')}>Release results</button></>}
        </>} />
      <div className="grid c2" style={{ marginBottom: 20 }}>
        <Card title="Settings"><KV items={[['Attempts allowed', x.max_attempts], ['Question order', x.randomize ? 'Shuffled for each trainee' : 'Fixed'], ['Results', x.release_mode === 'immediate' ? 'Shown as soon as marked' : 'Released by staff'], ['Opens', x.opens_at ? dateTime(x.opens_at) : 'Immediately'], ['Closes', x.closes_at ? dateTime(x.closes_at) : 'No deadline'], ['Total marks', total]]} /></Card>
        <Card title="What trainees see"><p className="muted">A countdown based on the server's clock, their saved answers if they reconnect, and nothing about the correct answers. When time runs out the exam submits itself with whatever they had answered.</p></Card>
      </div>
      <Card title={`Questions (${x.questions.length})`} flush>
        {x.questions.length === 0 ? <div className="empty muted">No questions yet. Add some from the bank, or pick at random.</div> : (
          <table className="table"><thead><tr><th>#</th><th>Question</th><th>Type</th><th className="num">Marks</th></tr></thead><tbody>{x.questions.map((q: any, i: number) => <tr key={q.id}><td>{i + 1}</td><td>{q.prompt}</td><td>{label(q.type)}</td><td className="num">{q.assigned_marks}</td></tr>)}</tbody></table>)}
      </Card>
      {picking && <BankPicker assessment={x} onClose={() => setPicking(false)} onDone={() => { a.reload(); }} />}
      {win && <FormModal title="Opening times" size="narrow" submitLabel="Save times" onClose={() => setWin(false)}
        fields={[
          { name: 'opens_at', label: 'Opens (UTC)', type: 'datetime', help: 'Leave empty to open as soon as it is published. UTC is the same as Ghana time.' },
          { name: 'closes_at', label: 'Closes (UTC)', type: 'datetime', help: 'Leave empty for no deadline. A trainee who starts shortly before this time only has until it closes, so leave enough room for the full time allowed.' },
        ]}
        initial={{ opens_at: x.opens_at ? String(x.opens_at).slice(0, 16) : '', closes_at: x.closes_at ? String(x.closes_at).slice(0, 16) : '' }}
        onSubmit={async (v) => { await api.patch(`/assessments/${id}`, { opens_at: v.opens_at ?? null, closes_at: v.closes_at ?? null }); toast('Opening times saved'); a.reload(); }} />}
      {auto && <FormModal title="Pick questions at random" size="narrow" fields={[{ name: 'count', label: 'How many', type: 'number', required: true, min: 1, max: 200 }, { name: 'topic', label: 'Topic', help: 'Optional' }]} initial={{ count: 10 }} onClose={() => setAuto(false)}
        onSubmit={async (v) => { const r = await api.post(`/assessments/${id}/questions/auto`, v); toast(r.short_by ? `Added ${r.added}. The bank only had that many matching.` : `Added ${r.added} questions`); a.reload(); }} />}
      {confirm === 'publish' && <ConfirmModal title="Publish this assessment?" message="Trainees on the programme can sit it as soon as it opens. The questions can no longer be changed." confirmLabel="Publish" onClose={() => setConfirm(null)} onConfirm={async () => { await api.post(`/assessments/${id}/publish`, {}); toast('Published'); a.reload(); }} />}
      {confirm === 'close' && <ConfirmModal title="Close this assessment?" message="Nobody can start it any more. Attempts already in progress still finish." confirmLabel="Close" onClose={() => setConfirm(null)} onConfirm={async () => { await api.post(`/assessments/${id}/close`, {}); toast('Closed'); a.reload(); }} />}
      {confirm === 'release' && <ConfirmModal title="Release marked results?" message="Trainees whose attempts are fully marked can then see their score." confirmLabel="Release" onClose={() => setConfirm(null)} onConfirm={async () => { const r = await api.post(`/assessments/${id}/release`, {}); toast(`${r.released} released`); a.reload(); }} />}
    </>
  );
}

function BankPicker({ assessment, onClose, onDone }: { assessment: any; onClose: () => void; onDone: () => void }) {
  const { data } = useApi<{ data: any[] }>(`/questions?course_id=${assessment.course_id}&limit=200`);
  const existing = useMemo(() => assessment.questions.map((q: any) => q.id), [assessment]);
  const [sel, setSel] = useState<string[]>(existing);
  const toast = useToast();
  const items = (data?.data ?? []).map((q) => ({ value: q.id, label: q.prompt.slice(0, 120), sub: `${label(q.type)} · ${q.marks} mark${q.marks === 1 ? '' : 's'}${q.topic ? ` · ${q.topic}` : ''}`, group: q.topic || 'General' }));
  return (
    <Modal title="Add questions from the bank" size="wide" onClose={onClose} footer={<><button className="btn outline" onClick={onClose}>Cancel</button><button className="btn" onClick={async () => { try { await api.put(`/assessments/${assessment.id}/questions`, { items: sel.map((question_id) => ({ question_id })) }); toast('Questions saved'); onDone(); onClose(); } catch (e) { toast((e as ApiError).message, 'error'); } }}>Save selection</button></>}>
      {!data ? <Loading /> : <ChecklistPicker items={items} selected={sel} onChange={setSel} placeholder="Search questions" />}
    </Modal>
  );
}
