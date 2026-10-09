'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Column, DataList } from '@/components/datalist';
import { FieldDef, FormModal } from '@/components/form';
import { Badge, PageHead } from '@/components/ui';
import { useToast } from '@/components/toast';
import { date } from '@/lib/format';

const fields: FieldDef[] = [
  { name: 'full_name', label: 'Full name', required: true }, { name: 'email', label: 'Email', type: 'email', required: true }, { name: 'phone', label: 'Phone' },
  { name: 'employment_type', label: 'Employment', type: 'select', required: true, options: [{ value: 'employee', label: 'Employee' }, { value: 'associate', label: 'Associate (contract)' }] },
  { name: 'accreditation_body', label: 'Accrediting body' }, { name: 'accreditation_expiry', label: 'Accreditation expires', type: 'date' }, { name: 'specialties', label: 'Specialties', full: true },
];

export default function InstructorsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [tick, setTick] = useState(0);
  const columns: Column<any>[] = [{ key: 'full_name', label: 'Instructor', render: (u) => <b style={{ fontWeight: 600 }}>{u.full_name}</b>, href: (u) => `/people/${u.id}` }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }, { key: 'status', label: 'Status', render: (u) => <Badge value={u.status} /> }, { key: 'last_login_at', label: 'Last sign-in', render: (u) => (u.last_login_at ? date(u.last_login_at) : 'Never') }];
  return (
    <>
      <PageHead title="Instructors" subtitle="Employees and contract associates who deliver training. An instructor can only be scheduled for courses they are authorised for, and only while their accreditation is in date." actions={can('users:write') && <button className="btn" onClick={() => setAdding(true)}>Add instructor</button>} />
      <DataList path="/users" extra={{ role: 'instructor' }} columns={columns} refreshKey={tick} searchPlaceholder="Search name or email" empty={{ title: 'No instructors yet' }} />
      {adding && <FormModal title="Add instructor" fields={fields} initial={{ employment_type: 'associate' }} onClose={() => setAdding(false)}
        onSubmit={async (v) => { const { employment_type, accreditation_body, accreditation_expiry, specialties, ...base } = v; await api.post('/users', { ...base, role: 'instructor', instructor_profile: { employment_type, accreditation_body, accreditation_expiry, specialties } }); toast('Instructor added. They will receive an invitation.'); setTick((t) => t + 1); }} />}
    </>
  );
}
