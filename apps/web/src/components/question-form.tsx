'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Field, FieldDef } from './form';
import { Modal } from './ui';
import { label } from '@/lib/format';

const TYPES = [['mcq_single', 'Multiple choice (one answer)'], ['mcq_multi', 'Multiple choice (several answers)'], ['true_false', 'True or false'], ['short_answer', 'Short answer'], ['essay', 'Essay (marked by hand)'], ['matching', 'Matching'], ['scenario', 'Scenario (marked by hand)']];
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const nums = (s: string) => s.split(/[,\s]+/).filter(Boolean).map((x) => Number(x));

function toState(q: any) {
  const o = q?.options; const a = q?.answer;
  return {
    type: q?.type ?? 'mcq_single', prompt: q?.prompt ?? '', difficulty: q?.difficulty ?? 'medium', marks: String(q?.marks ?? 1), topic: q?.topic ?? '', explanation: q?.explanation ?? '', course_id: q?.course_id ?? '',
    optionsText: Array.isArray(o) ? o.join('\n') : '', single: q?.type === 'mcq_single' && Number.isInteger(a) ? String(a + 1) : '', multi: q?.type === 'mcq_multi' && Array.isArray(a) ? a.map((x: number) => x + 1).join(', ') : '',
    tf: q?.type === 'true_false' ? String(a) : 'true', accepted: q?.type === 'short_answer' && Array.isArray(a) ? a.join('\n') : '',
    left: o?.left ? o.left.join('\n') : '', right: o?.right ? o.right.join('\n') : '', mapping: q?.type === 'matching' && Array.isArray(a) ? a.map((x: number) => x + 1).join(', ') : '',
  };
}

/** Authoring form for every question type. Correct answers are numbered from 1 so nobody has to count from zero. */
export function QuestionModal({ question, courses, courseId, onClose, onSaved }: { question?: any; courses: { value: string; label: string }[]; courseId?: string; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(() => ({ ...toState(question), course_id: question?.course_id ?? courseId ?? '' }));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (x: any) => setV((p) => ({ ...p, [k]: x }));
  const f = (def: FieldDef, key: string) => <Field def={def} value={(v as any)[key]} onChange={set(key)} />;
  const opts = lines(v.optionsText);

  async function save() {
    setBusy(true); setErr('');
    try {
      let options: any = null; let answer: any = null;
      if (v.type === 'mcq_single') { options = opts; answer = Number(v.single) - 1; }
      else if (v.type === 'mcq_multi') { options = opts; answer = nums(v.multi).map((n) => n - 1); }
      else if (v.type === 'true_false') answer = v.tf === 'true';
      else if (v.type === 'short_answer') answer = lines(v.accepted);
      else if (v.type === 'matching') { options = { left: lines(v.left), right: lines(v.right) }; answer = nums(v.mapping).map((n) => n - 1); }
      const body: any = { type: v.type, prompt: v.prompt, difficulty: v.difficulty, marks: Number(v.marks), topic: v.topic || null, explanation: v.explanation || null, options, answer };
      if (question) await api.patch(`/questions/${question.id}`, body); else await api.post('/questions', { ...body, course_id: v.course_id });
      onSaved(); onClose();
    } catch (e) { const ae = e as ApiError; setErr(ae.issues?.length ? ae.issues.map((i) => `${i.path}: ${i.message}`).join('; ') : ae.message); setBusy(false); }
  }
  const ready = v.prompt.trim().length >= 3 && v.course_id && Number(v.marks) > 0;
  return (
    <Modal title={question ? 'Edit question' : 'New question'} size="wide" onClose={onClose} footer={<><button className="btn outline" onClick={onClose}>Cancel</button><button className="btn" disabled={!ready || busy} onClick={save}>{busy ? 'Saving…' : 'Save question'}</button></>}>
      <div className="stack">
        <div className="form-grid">
          {!question && f({ name: 'course_id', label: 'Course', type: 'select', required: true, options: courses, full: true }, 'course_id')}
          {f({ name: 'type', label: 'Type', type: 'select', required: true, options: TYPES.map(([value, l]) => ({ value, label: l })), disabled: !!question }, 'type')}
          {f({ name: 'difficulty', label: 'Difficulty', type: 'select', required: true, options: ['easy', 'medium', 'hard'].map((x) => ({ value: x, label: label(x) })) }, 'difficulty')}
          {f({ name: 'prompt', label: 'Question', type: 'textarea', required: true, full: true }, 'prompt')}
          {f({ name: 'marks', label: 'Marks', type: 'number', required: true, min: 0.5, step: 0.5 }, 'marks')}{f({ name: 'topic', label: 'Topic', help: 'Used to pick questions by topic' }, 'topic')}
        </div>
        {(v.type === 'mcq_single' || v.type === 'mcq_multi') && (
          <div className="form-grid">
            {f({ name: 'optionsText', label: 'Choices, one per line', type: 'textarea', required: true, full: true }, 'optionsText')}
            {v.type === 'mcq_single' ? f({ name: 'single', label: 'Correct choice number', type: 'select', required: true, options: opts.map((o, i) => ({ value: String(i + 1), label: `${i + 1}. ${o}` })) }, 'single')
              : f({ name: 'multi', label: 'Correct choice numbers', required: true, placeholder: 'For example 1, 3', help: `There are ${opts.length} choices` }, 'multi')}
          </div>
        )}
        {v.type === 'true_false' && f({ name: 'tf', label: 'Correct answer', type: 'select', required: true, options: [{ value: 'true', label: 'True' }, { value: 'false', label: 'False' }] }, 'tf')}
        {v.type === 'short_answer' && f({ name: 'accepted', label: 'Accepted answers, one per line', type: 'textarea', required: true, help: 'Capital letters and extra spaces are ignored when marking.' }, 'accepted')}
        {v.type === 'matching' && <div className="form-grid">{f({ name: 'left', label: 'Left column, one per line', type: 'textarea', required: true }, 'left')}{f({ name: 'right', label: 'Right column, one per line', type: 'textarea', required: true }, 'right')}
          {f({ name: 'mapping', label: 'Matching right number for each left item', required: true, placeholder: 'For example 2, 1, 3', full: true, help: 'The first number is the right-hand item that matches the first left item, and so on.' }, 'mapping')}</div>}
        {(v.type === 'essay' || v.type === 'scenario') && <div className="alert info">This question is marked by hand. The marker awards marks up to the value above.</div>}
        {f({ name: 'explanation', label: 'Explanation shown to markers', type: 'textarea', full: true }, 'explanation')}
        {err && <div className="alert danger" role="alert">{err}</div>}
      </div>
    </Modal>
  );
}
