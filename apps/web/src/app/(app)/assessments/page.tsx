'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Column, DataList } from '@/components/datalist';
import { FormModal } from '@/components/form';
import { Badge, PageHead } from '@/components/ui';
import { fromLocalInput, label, dateTime } from '@/lib/format';
import { useCourseOptions } from '@/lib/options';

function Inner() {
  const { can } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const courses = useCourseOptions();
  const [form, setForm] = useState(false);
  const [courseId, setCourseId] = useState(params.get('course') ?? '');
  const progs = useApi<{ data: any[] }>(courseId ? `/programmes?course_id=${courseId}&limit=100` : null);
  useEffect(() => { if (params.get('new') && can('assessments:write')) setForm(true); }, [params, can]);
  const columns: Column<any>[] = [
    { key: 'title', label: 'Assessment', render: (a) => <b style={{ fontWeight: 600 }}>{a.title}</b>, href: (a) => `/assessments/${a.id}` }, { key: 'course_code', label: 'Course' }, { key: 'programme_code', label: 'Programme' },
    { key: 'kind', label: 'Kind', render: (a) => label(a.kind) }, { key: 'question_count', label: 'Questions', num: true }, { key: 'duration_minutes', label: 'Minutes', num: true }, { key: 'pass_mark', label: 'Pass', num: true, render: (a) => `${a.pass_mark}%` },
    { key: 'awaiting_marking', label: 'To mark', num: true }, { key: 'status', label: 'Status', render: (a) => <Badge value={a.status} /> },
  ];
  return (
    <>
      <PageHead title="Assessments" subtitle="Exams, quizzes and practicals. Time is kept by the server, answers are saved as people type, and trainees never receive the correct answers." actions={can('assessments:write') && <button className="btn" onClick={() => setForm(true)}>New assessment</button>} />
      <DataList path="/assessments" columns={columns} searchPlaceholder="Search title" filters={[{ name: 'status', label: 'Status', options: ['draft', 'published', 'closed'].map((v) => ({ value: v, label: label(v) })) }, { name: 'course_id', label: 'Course', options: courses }]} empty={{ title: 'No assessments yet' }} />
      {form && <FormModal title="New assessment" size="wide" initial={{ course_id: params.get('course') ?? '', programme_id: params.get('programme') ?? '', kind: 'exam', duration_minutes: 60, pass_mark: 70, max_attempts: 1, randomize: true, release_mode: 'manual' }} onClose={() => { setForm(false); }}
        fields={[
          { name: 'course_id', label: 'Course', type: 'select', required: true, options: courses }, { name: 'programme_id', label: 'Programme', type: 'select', required: true, options: (progs.data?.data ?? []).map((p) => ({ value: p.id, label: `${p.code} · ${p.title}` })), help: courseId ? 'Trainees on this programme can sit it' : 'Choose the course first' },
          { name: 'title', label: 'Title', required: true, full: true }, { name: 'kind', label: 'Kind', type: 'select', required: true, options: ['exam', 'quiz', 'practical'].map((v) => ({ value: v, label: label(v) })), help: 'Quizzes do not count towards the result' },
          { name: 'duration_minutes', label: 'Time allowed (minutes)', type: 'number', required: true, min: 1 }, { name: 'pass_mark', label: 'Pass mark (%)', type: 'number', required: true, min: 0, max: 100 }, { name: 'max_attempts', label: 'Attempts allowed', type: 'number', required: true, min: 1, max: 10 },
          { name: 'opens_at', label: 'Opens (UTC)', type: 'datetime' }, { name: 'closes_at', label: 'Closes (UTC)', type: 'datetime' },
          { name: 'release_mode', label: 'Results', type: 'select', required: true, options: [{ value: 'manual', label: 'Released by staff' }, { value: 'immediate', label: 'Shown as soon as marked' }] }, { name: 'randomize', label: 'Shuffle the question order for each trainee', type: 'checkbox' },
        ]}
        onSubmit={async (v) => { const a = await api.post('/assessments', v); router.push(`/assessments/${a.id}`); }}>
        <div className="field"><label htmlFor="cpick">Pick the course to load its programmes</label><select id="cpick" value={courseId} onChange={(e) => setCourseId(e.target.value)}><option value="">Choose…</option>{courses.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
      </FormModal>}
    </>
  );
}
export default function AssessmentsPage() { return <Suspense><Inner /></Suspense>; }
