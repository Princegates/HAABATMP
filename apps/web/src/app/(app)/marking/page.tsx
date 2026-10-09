'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Column, DataList } from '@/components/datalist';
import { Badge, PageHead } from '@/components/ui';
import { dateTime } from '@/lib/format';

function Inner() {
  const params = useSearchParams();
  const columns: Column<any>[] = [
    { key: 'trainee_name', label: 'Trainee', render: (x) => <b style={{ fontWeight: 600 }}>{x.trainee_name}</b>, href: (x) => `/marking/${x.id}` }, { key: 'assessment_title', label: 'Assessment' }, { key: 'attempt_no', label: 'Attempt', num: true },
    { key: 'submitted_at', label: 'Submitted', render: (x) => dateTime(x.submitted_at) }, { key: 'unmarked_answers', label: 'To mark', num: true }, { key: 'status', label: 'Status', render: (x) => <Badge value={x.status} /> },
  ];
  return (
    <>
      <PageHead title="Marking" accent="queue" subtitle="Submitted attempts with answers that need a person. Objective questions have already been marked automatically." />
      <DataList path="/attempts" columns={columns} search={false} extra={{ assessment_id: params.get('assessment_id') ?? undefined }}
        filters={[{ name: 'status', label: 'Show', options: [{ value: 'submitted', label: 'Waiting to be marked' }, { value: 'marked', label: 'Marked' }] }]} empty={{ title: 'Nothing waiting to be marked' }} />
    </>
  );
}
export default function MarkingPage() { return <Suspense><Inner /></Suspense>; }
