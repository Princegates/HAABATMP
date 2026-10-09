'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Column, DataList } from '@/components/datalist';
import { FormModal } from '@/components/form';
import { Badge, PageHead } from '@/components/ui';
import { useToast } from '@/components/toast';
import { programmeFields } from '@/lib/programme-fields';
import { date, label } from '@/lib/format';
import { useClassroomOptions, useCourseOptions, useInstructorOptions, useOrgOptions } from '@/lib/options';

const STATUSES = ['draft', 'open_for_registration', 'registration_closed', 'ongoing', 'completed', 'cancelled'].map((s) => ({ value: s, label: label(s) }));

function Inner() {
  const { can, is } = useAuth();
  const toast = useToast();
  const params = useSearchParams();
  const courses = useCourseOptions(); const rooms = useClassroomOptions(); const instructors = useInstructorOptions(); const orgs = useOrgOptions(can('programmes:write'));
  const [form, setForm] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => { if (params.get('new') && can('programmes:write')) setForm(true); }, [params, can]);
  const columns: Column<any>[] = [
    { key: 'code', label: 'Programme', render: (p) => <span className="mono">{p.code}</span>, href: (p) => `/programmes/${p.id}` }, { key: 'title', label: 'Title', render: (p) => <b style={{ fontWeight: 600 }}>{p.title}</b> },
    { key: 'start_date', label: 'Dates', render: (p) => `${date(p.start_date)}${p.end_date !== p.start_date ? ` to ${date(p.end_date)}` : ''}` },
    { key: 'seats', label: 'Places', num: true, render: (p) => `${p.confirmed_count + p.pending_count} / ${p.capacity}` },
    ...(can('programmes:write') ? [{ key: 'organization_name', label: 'Reserved for', render: (p: any) => p.organization_name ?? <span className="muted">Open to all</span> }] : []),
    { key: 'status', label: 'Status', render: (p) => <Badge value={p.status} /> },
  ];
  return (
    <>
      <PageHead title={is('trainee') ? 'Programmes' : 'Training'} accent={is('trainee') ? 'open for registration' : 'programmes'} subtitle={is('trainee') ? 'Programmes you can register for, and the ones you are already on.' : 'Each programme is one scheduled run of a course, with its own dates, people and results.'}
        actions={can('programmes:write') && <button className="btn" onClick={() => setForm(true)}>New programme</button>} />
      <DataList path="/programmes" columns={columns} refreshKey={tick} searchPlaceholder="Search code or title"
        filters={[{ name: 'status', label: 'Status', options: STATUSES }, { name: 'course_id', label: 'Course', options: courses }]} empty={{ title: 'No programmes to show', hint: can('programmes:write') ? 'Create a programme from an active course.' : 'Nothing is open for registration right now.' }} />
      {form && <FormModal title="New programme" size="wide" fields={programmeFields({ courses, rooms, instructors, orgs, creating: true })} initial={{}} onClose={() => setForm(false)}
        onSubmit={async (v) => { await api.post('/programmes', v); toast('Programme created as a draft'); setTick((t) => t + 1); }} />}
    </>
  );
}
export default function ProgrammesPage() { return <Suspense><Inner /></Suspense>; }
