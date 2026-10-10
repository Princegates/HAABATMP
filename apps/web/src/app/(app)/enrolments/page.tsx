'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Column, DataList } from '@/components/datalist';
import { Badge, ConfirmModal, PageHead } from '@/components/ui';
import { useToast } from '@/components/toast';
import { date, label } from '@/lib/format';
import { useOrgOptions } from '@/lib/options';
import { DeleteButton } from '@/components/delete';

export default function EnrolmentsPage() {
  const { can, is } = useAuth();
  const toast = useToast();
  const orgs = useOrgOptions(is('super_admin', 'training_admin', 'auditor', 'finance_officer'));
  const [cancel, setCancel] = useState<{ row: any; reload: () => void } | null>(null);
  const seesOrg = is('super_admin', 'training_admin', 'auditor', 'finance_officer');
  const columns: Column<any>[] = [
    ...(is('trainee') ? [] : [{ key: 'trainee_name', label: 'Trainee', render: (e: any) => <b style={{ fontWeight: 600 }}>{e.trainee_name}</b>, href: (e: any) => (can('users:read') ? `/people/${e.trainee_id}` : undefined) }]),
    ...(seesOrg ? [{ key: 'organization_name', label: 'Organisation', render: (e: any) => e.organization_name ?? <span className="muted">Individual</span> }] : []),
    { key: 'programme_code', label: 'Programme', render: (e) => <span className="mono">{e.programme_code}</span>, href: (e) => `/programmes/${e.programme_id}` }, { key: 'programme_title', label: 'Title' },
    { key: 'start_date', label: 'Starts', render: (e) => date(e.start_date) }, { key: 'status', label: 'Status', render: (e) => <Badge value={e.status} /> },
    ...(can('invoices:read') && !is('instructor') ? [{ key: 'invoice_status', label: 'Payment', render: (e: any) => (e.invoice_status ? <Badge value={e.invoice_status} /> : '') }] : []),
  ];
  return (
    <>
      <PageHead title={is('trainee') ? 'My' : 'Registrations'} accent={is('trainee') ? 'registrations' : undefined} subtitle={is('trainee') ? 'Programmes you have registered for and where each one stands.' : 'Who is booked on which programme, and whether their place and payment are confirmed.'} />
      <DataList path="/enrollments" columns={columns} searchPlaceholder="Search trainee" extra={{}}
        filters={[{ name: 'status', label: 'Status', options: ['pending', 'confirmed', 'waitlisted', 'completed', 'cancelled'].map((s) => ({ value: s, label: label(s) })) }, ...(seesOrg ? [{ name: 'organization_id', label: 'Organisation', options: orgs }] : [])]}
        empty={{ title: 'No registrations yet' }}
        actions={(e, reload) => (!['cancelled', 'completed'].includes(e.status) || is('super_admin')) && !is('instructor', 'auditor', 'finance_officer') && (
          <span className="row" style={{ justifyContent: 'flex-end' }}>
            {is('super_admin', 'training_admin') && e.status === 'pending' && <button className="btn outline sm" onClick={async () => { try { await api.post(`/enrollments/${e.id}/confirm`, {}); toast('Place confirmed'); reload(); } catch (err) { toast((err as ApiError).message, 'error'); } }}>Confirm</button>}
            {!['cancelled', 'completed'].includes(e.status) && <button className="btn ghost sm" onClick={() => setCancel({ row: e, reload })}>Cancel</button>}
            <DeleteButton path={`/enrollments/${e.id}`} what="this registration" goes="Their attendance, assessment attempts and unpaid invoice for this programme go with it." onDone={reload} />
          </span>)} />
      {cancel && <ConfirmModal title="Cancel this registration?" message={`${cancel.row.trainee_name} on ${cancel.row.programme_title}.`} askReason="Reason" danger confirmLabel="Cancel registration" onClose={() => setCancel(null)}
        onConfirm={async (reason) => { await api.post(`/enrollments/${cancel.row.id}/cancel`, { reason }); toast('Registration cancelled'); cancel.reload(); }} />}
    </>
  );
}
