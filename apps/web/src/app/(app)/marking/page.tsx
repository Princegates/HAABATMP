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
      <PageHead title="Marking" accent="queue" subtitle="Every submitted attempt. Objective questions are marked automatically; written answers need a person. Open an attempt to read the answers." />
      <DataList path="/attempts" columns={columns} search={false} extra={{ assessment_id: params.get('assessment_id') ?? undefined }}
        filters={[{ name: 'status', label: 'Show', options: [{ value: 'submitted', label: 'Waiting to be marked' }, { value: 'marked', label: 'Marked' }] }]} empty={{ title: 'No attempts to show', hint: 'Attempts appear here once a trainee has submitted. Use the filter to see only those waiting or already marked.' }} />
    </>
  );
}
export default function MarkingPage() { return <Suspense><Inner /></Suspense>; }
