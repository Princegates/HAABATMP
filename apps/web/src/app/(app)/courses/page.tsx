'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Column, DataList } from '@/components/datalist';
import { FormModal } from '@/components/form';
import { Badge, PageHead } from '@/components/ui';
import { useToast } from '@/components/toast';
import { courseFields } from '@/lib/course-fields';
import { money, label } from '@/lib/format';
import { useCategoryOptions } from '@/lib/options';

function Inner() {
  const { can } = useAuth();
  const toast = useToast();
  const params = useSearchParams();
  const cats = useCategoryOptions();
  const [form, setForm] = useState<boolean>(false);
  const [tick, setTick] = useState(0);
  useEffect(() => { if (params.get('new') && can('courses:write')) setForm(true); }, [params, can]);
  const columns: Column<any>[] = [
    { key: 'code', label: 'Code', render: (c) => <span className="mono">{c.code}</span>, href: (c) => `/courses/${c.id}` }, { key: 'title', label: 'Course', render: (c) => <b style={{ fontWeight: 600 }}>{c.title}</b> }, { key: 'category_name', label: 'Category' },
    { key: 'duration_hours', label: 'Hours', num: true }, { key: 'fee', label: 'Fee', num: true, render: (c) => money(c.fee, c.currency) }, { key: 'validity_months', label: 'Valid for', render: (c) => (c.validity_months ? `${c.validity_months} months` : 'No expiry') },
    { key: 'status', label: 'Status', render: (c) => <Badge value={c.status} /> },
  ];
  return (
    <>
      <PageHead title="Course" accent="catalogue" subtitle="Every course HAAB delivers, with its pass mark, attendance rule and how long the certificate lasts." actions={can('courses:write') && <button className="btn" onClick={() => setForm(true)}>New course</button>} />
      <DataList path="/courses" columns={columns} refreshKey={tick} searchPlaceholder="Search code or title"
        filters={[{ name: 'category_id', label: 'Category', options: cats }, ...(can('courses:write') ? [{ name: 'status', label: 'Status', options: ['draft', 'active', 'archived'].map((s) => ({ value: s, label: label(s) })) }] : [])]}
        empty={{ title: 'No courses yet', hint: can('courses:write') ? 'Create the first course to start scheduling programmes.' : undefined }} />
      {form && <FormModal title="New course" size="wide" fields={courseFields(cats)} initial={{ delivery_method: 'classroom', duration_hours: 8, capacity: 20, fee: 0, pass_mark: 70, min_attendance_pct: 80, status: 'draft' }} onClose={() => setForm(false)}
        onSubmit={async (v) => { await api.post('/courses', v); toast('Course created'); setTick((t) => t + 1); }} />}
    </>
  );
}
export default function CoursesPage() { return <Suspense><Inner /></Suspense>; }
