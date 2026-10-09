'use client';
import { use, useEffect, useState } from 'react';
import { api, ApiError, useApi } from '@/lib/api';
import { useToast } from '@/components/toast';
import { Badge, Card, ErrorNote, Loading, PageHead } from '@/components/ui';
import { label, pct } from '@/lib/format';

const show = (q: any, r: any) => {
  if (r === null || r === undefined) return <span className="muted">No answer</span>;
  if (q.type === 'mcq_single') return q.options?.[r] ?? String(r);
  if (q.type === 'mcq_multi') return (r as number[]).map((i) => q.options?.[i]).join(', ');
  if (q.type === 'true_false') return r ? 'True' : 'False';
  if (q.type === 'matching') return (r as number[]).map((ri, li) => `${q.options?.left?.[li]} → ${q.options?.right?.[ri] ?? '?'}`).join('; ');
  return <span style={{ whiteSpace: 'pre-wrap' }}>{String(r)}</span>;
};
const correct = (q: any) => {
  const a = q.answer; if (a === null || a === undefined) return null;
  if (q.type === 'mcq_single') return q.options?.[a];
  if (q.type === 'mcq_multi') return (a as number[]).map((i) => q.options?.[i]).join(', ');
  if (q.type === 'true_false') return a ? 'True' : 'False';
  if (q.type === 'short_answer') return (a as string[]).join(' / ');
  if (q.type === 'matching') return (a as number[]).map((ri, li) => `${q.options?.left?.[li]} → ${q.options?.right?.[ri]}`).join('; ');
  return null;
};

export default function MarkAttempt({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const { data, error, reload } = useApi<{ attempt: any; items: any[] }>(`/attempts/${id}/review`);
  const [marks, setMarks] = useState<Record<string, { m: string; fb: string }>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setMarks(Object.fromEntries(data.items.map((i) => [i.question_id, { m: i.awarded_marks === null || i.awarded_marks === undefined ? '' : String(i.awarded_marks), fb: i.feedback ?? '' }]))); }, [data]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const manual = data.items.filter((i) => i.needs_manual);
  const complete = manual.every((i) => marks[i.question_id]?.m !== '');
  async function save() {
    setBusy(true);
    try {
      const body = { marks: data!.items.filter((i) => (i.needs_manual || marks[i.question_id]?.m !== String(i.awarded_marks ?? '')) && marks[i.question_id]?.m !== '').map((i) => ({ question_id: i.question_id, awarded_marks: Number(marks[i.question_id].m), feedback: marks[i.question_id].fb || null })) };
      const r = await api.put(`/attempts/${id}/mark`, body);
      toast(r.status === 'marked' ? `Marked: ${pct(r.percentage, 1)}` : 'Saved. Some answers still need marking.'); reload();
    } catch (e) { toast((e as ApiError).message, 'error'); }
    setBusy(false);
  }
  return (
    <>
      <PageHead title="Mark attempt" crumbs={[{ label: 'Marking', href: '/marking' }, { label: 'Attempt' }]} subtitle={<><Badge value={data.attempt.status} /> · {data.attempt.percentage !== null && `${pct(data.attempt.percentage, 1)} so far`}</>} actions={<button className="btn" disabled={busy || (manual.length > 0 && !complete)} onClick={save}>{busy ? 'Saving…' : 'Save marks'}</button>} />
      <div className="stack">
        {data.items.map((q, i) => (
          <Card key={q.question_id} title={<>Question {i + 1} <span className="muted" style={{ fontSize: 14 }}>· {label(q.type)} · {q.marks} mark{q.marks === 1 ? '' : 's'}</span></>}>
            <div className="stack tight">
              <p style={{ fontWeight: 500 }}>{q.prompt}</p>
              <div><div className="label">Their answer</div><div>{show(q, q.response)}</div></div>
              {correct(q) && <div><div className="label">Correct answer</div><div className="muted">{correct(q)}</div></div>}
              {q.explanation && <div className="muted" style={{ fontSize: 13.5 }}>Note: {q.explanation}</div>}
              <div className="row wrap" style={{ marginTop: 6 }}>
                <div className="field" style={{ width: 130 }}><label htmlFor={`m${i}`}>Marks (of {q.marks})</label><input id={`m${i}`} type="number" min={0} max={q.marks} step={0.5} value={marks[q.question_id]?.m ?? ''} onChange={(e) => setMarks((p) => ({ ...p, [q.question_id]: { ...p[q.question_id], m: e.target.value } }))} /></div>
                <div className="field grow"><label htmlFor={`f${i}`}>Feedback</label><input id={`f${i}`} type="text" value={marks[q.question_id]?.fb ?? ''} onChange={(e) => setMarks((p) => ({ ...p, [q.question_id]: { ...p[q.question_id], fb: e.target.value } }))} /></div>
                {q.needs_manual ? <Badge tone="warn">Needs marking</Badge> : <Badge tone="ok">Auto-marked</Badge>}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
