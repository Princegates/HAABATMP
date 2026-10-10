'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Badge, Modal } from './ui';
import { label } from '@/lib/format';

interface Parsed { n: number; prompt: string; type: string; options: string[] | null; answer: any; marks: number; difficulty: string; duplicate: boolean; problems: string[] }
interface Preview { total: number; ready: number; with_problems: number; duplicates: number; questions: Parsed[]; can_import: boolean }

const letters = 'ABCDEFGH';
const TYPE_NAMES: Record<string, string> = { mcq_single: 'Multiple choice', mcq_multi: 'Choose several', true_false: 'True or false', short_answer: 'Short answer', essay: 'Essay', scenario: 'Scenario' };
function answerText(q: Parsed) {
  if (q.type === 'mcq_single' && Number.isInteger(q.answer)) return letters[q.answer];
  if (q.type === 'mcq_multi' && Array.isArray(q.answer)) return q.answer.map((i: number) => letters[i]).join(', ');
  if (q.type === 'true_false') return q.answer === true ? 'True' : q.answer === false ? 'False' : '';
  if (q.type === 'short_answer' && Array.isArray(q.answer)) return q.answer.join(' | ');
  return 'Marked by hand';
}

/** Upload a Word file, look at what was found, then confirm. Nothing is saved until the second step. */
export function QuestionImportModal({ courses, onClose, onDone }: { courses: { value: string; label: string }[]; onClose: () => void; onDone: (imported: number) => void }) {
  const [course, setCourse] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send(commit: boolean) {
    if (!file || !course) return;
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.append('course_id', course); fd.append('commit', commit ? 'true' : 'false'); fd.append('file', file);
      const r = await api.upload<any>('/questions/import', fd);
      if (commit) { onDone(r.imported); onClose(); } else setPreview(r);
    } catch (e) { setError((e as ApiError).message); if (!commit) setPreview(null); }
    setBusy(false);
  }

  return (
    <Modal title="Import questions from Word" size="wide" onClose={onClose} footer={<>
      <button className="btn outline" onClick={onClose}>Cancel</button>
      {preview ? <button className="btn" disabled={busy || !preview.can_import} onClick={() => send(true)}>{busy ? 'Importing…' : `Import ${preview.ready} question${preview.ready === 1 ? '' : 's'}`}</button>
        : <button className="btn" disabled={busy || !file || !course} onClick={() => send(false)}>{busy ? 'Reading…' : 'Check file'}</button>}
    </>}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>Write the questions in Word using the template, save as a <b>.docx</b>, and upload it. You will see what was found before anything is saved. <a href="/templates/question-template.docx" download>Download the Word template</a>.</p>
        <div className="form-grid">
          <div className="field"><label htmlFor="imp-course">Course *</label>
            <select id="imp-course" value={course} onChange={(e) => { setCourse(e.target.value); setPreview(null); }}><option value="">Choose…</option>{courses.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
            <span className="help">The questions are added to this course&apos;s question bank.</span></div>
          <div className="field"><label htmlFor="imp-file">Word file (.docx) *</label>
            <input id="imp-file" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setError(''); }} />
            <span className="help">Up to 5 MB and 500 questions.</span></div>
        </div>
        {error && <div className="alert danger" role="alert">{error}</div>}
        {preview && (
          <>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <Badge tone="neutral">{preview.total} found</Badge>
              <Badge tone="ok">{preview.ready} ready</Badge>
              {preview.with_problems > 0 && <Badge tone="danger">{preview.with_problems} with problems</Badge>}
              {preview.duplicates > 0 && <Badge tone="warn">{preview.duplicates} already in the bank (skipped)</Badge>}
            </div>
            {preview.with_problems > 0 && <div className="alert warn">Fix the questions marked below in your Word file and upload it again. Nothing is imported while any question has a problem.</div>}
            <div className="table-wrap" style={{ maxHeight: 340, overflow: 'auto' }}>
              <table className="table">
                <thead><tr><th>#</th><th>Question</th><th>Type</th><th>Answer</th><th className="num">Marks</th><th>Check</th></tr></thead>
                <tbody>{preview.questions.map((q) => (
                  <tr key={q.n}>
                    <td>{q.n}</td><td>{q.prompt.length > 120 ? `${q.prompt.slice(0, 120)}…` : q.prompt}</td><td>{TYPE_NAMES[q.type] ?? label(q.type)}</td><td>{q.problems.length ? '' : answerText(q)}</td><td className="num">{q.marks}</td>
                    <td>{q.problems.length ? <span style={{ color: 'var(--danger)' }}>{q.problems.join('. ')}</span> : q.duplicate ? <Badge tone="warn">Already in bank</Badge> : <Badge tone="ok">OK</Badge>}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
