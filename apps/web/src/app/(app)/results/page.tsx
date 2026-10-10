'use client';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { Column, DataList } from '@/components/datalist';
import { Badge, PageHead } from '@/components/ui';
import { label, pct } from '@/lib/format';
import { useOrgOptions } from '@/lib/options';

export default function ResultsPage() {
  const { is } = useAuth();
  const seesOrg = is('super_admin', 'training_admin', 'auditor');
  const orgs = useOrgOptions(seesOrg);
  const columns: Column<any>[] = [
    ...(is('trainee') ? [] : [{ key: 'trainee_name', label: 'Trainee', render: (r: any) => <b style={{ fontWeight: 600 }}>{r.trainee_name}</b> }]),
    ...(seesOrg ? [{ key: 'organization_name', label: 'Organisation', render: (r: any) => r.organization_name ?? <span className="muted">Individual</span> }] : []),
    { key: 'programme_code', label: 'Programme', render: (r) => <span className="mono">{r.programme_code}</span>, href: (r) => `/programmes/${r.programme_id}` }, { key: 'course_title', label: 'Course' },
    { key: 'final_score', label: 'Score', num: true, render: (r) => (r.final_score === null ? '' : pct(r.final_score, 1)) }, { key: 'attendance_pct', label: 'Attendance', num: true, render: (r) => (r.attendance_pct === null ? '' : pct(r.attendance_pct, 0)) },
    { key: 'status', label: 'Result', render: (r) => <><Badge value={r.status} />{r.pending_reason && <div className="muted" style={{ fontSize: 12, marginTop: 4, maxWidth: 260 }}>{r.pending_reason}</div>}</> },
    { key: 'certificate_number', label: 'Certificate', render: (r) => (r.certificate_id ? <Link href={`/certificates/${r.certificate_id}`} className="mono">{r.certificate_number}</Link> : '') },
  ];
  return (
    <>
      <PageHead title={is('trainee') ? 'My' : 'Training'} accent="results" subtitle={is('trainee') || is('org_admin') ? 'Official results appear here once HAAB has finalised and released them.' : 'Results across every programme. Open a programme to calculate, finalise and release them.'} />
      <DataList path="/results" columns={columns} searchPlaceholder="Search trainee"
        filters={[{ name: 'status', label: 'Result', options: ['pass', 'fail', 'pending', 'absent', 'disqualified'].map((v) => ({ value: v, label: label(v) })) }, ...(seesOrg ? [{ name: 'organization_id', label: 'Organisation', options: orgs }] : [])]} empty={{ title: 'No results yet' }} />
    </>
  );
}
