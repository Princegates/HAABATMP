'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Column, DataList } from '@/components/datalist';
import { QuestionModal } from '@/components/question-form';
import { Badge, PageHead } from '@/components/ui';
import { label } from '@/lib/format';
import { useCourseOptions } from '@/lib/options';
import { api } from '@/lib/api';
import { useToast } from '@/components/toast';

export default function QuestionBank() {
  const { can } = useAuth();
  const toast = useToast();
  const courses = useCourseOptions();
  const [form, setForm] = useState<'new' | any | null>(null);
  const [tick, setTick] = useState(0);
  const columns: Column<any>[] = [
    { key: 'prompt', label: 'Question', render: (q) => <span>{q.prompt.length > 110 ? `${q.prompt.slice(0, 110)}…` : q.prompt}</span> }, { key: 'type', label: 'Type', render: (q) => label(q.type) },
    { key: 'topic', label: 'Topic' }, { key: 'difficulty', label: 'Level', render: (q) => <Badge tone={q.difficulty === 'hard' ? 'danger' : q.difficulty === 'easy' ? 'ok' : 'warn'}>{q.difficulty}</Badge> }, { key: 'marks', label: 'Marks', num: true },
  ];
  return (
    <>
      <PageHead title="Question" accent="bank" subtitle="Reusable questions by course, topic, difficulty and type. A question that has been answered in an exam is retired, not edited, so past marks always stay explainable." actions={can('questions:write') && <button className="btn" onClick={() => setForm('new')}>New question</button>} />
      <DataList path="/questions" columns={columns} refreshKey={tick} searchPlaceholder="Search question text"
        filters={[{ name: 'course_id', label: 'Course', options: courses }, { name: 'difficulty', label: 'Level', options: ['easy', 'medium', 'hard'].map((v) => ({ value: v, label: label(v) })) }, { name: 'type', label: 'Type', options: ['mcq_single', 'mcq_multi', 'true_false', 'short_answer', 'essay', 'matching', 'scenario'].map((v) => ({ value: v, label: label(v) })) }]}
        actions={(q) => can('questions:write') && <span className="row" style={{ justifyContent: 'flex-end' }}><button className="btn outline sm" onClick={() => setForm(q)}>Edit</button><button className="btn ghost sm" onClick={async () => { await api.patch(`/questions/${q.id}`, { status: 'retired' }); toast('Question retired'); setTick((t) => t + 1); }}>Retire</button></span>}
        empty={{ title: 'The bank is empty', hint: 'Add questions here, then build assessments from them.' }} />
      {form && <QuestionModal question={form === 'new' ? undefined : form} courses={courses} onClose={() => setForm(null)} onSaved={() => { toast('Question saved'); setTick((t) => t + 1); }} />}
    </>
  );
}
