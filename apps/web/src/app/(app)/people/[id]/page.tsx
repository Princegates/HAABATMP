'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, download, useApi } from '@/lib/api';
import { ROLE_LABEL, Role, useAuth } from '@/lib/auth';
import { Column, DataList } from '@/components/datalist';
import { FieldDef, FormModal } from '@/components/form';
import { useToast } from '@/components/toast';
import { Badge, Card, ConfirmModal, ErrorNote, KV, Loading, PageHead, Tabs } from '@/components/ui';
import { date, dateTime, label } from '@/lib/format';

const traineeFields: FieldDef[] = [
  { name: 'aviation_role', label: 'Aviation role' }, { name: 'employer', label: 'Employer' }, { name: 'licence_number', label: 'Licence number' }, { name: 'licence_expiry', label: 'Licence expiry', type: 'date' },
  { name: 'nationality', label: 'Nationality' }, { name: 'date_of_birth', label: 'Date of birth', type: 'date' }, { name: 'id_type', label: 'ID type', help: 'For example Ghana Card or passport' },
  { name: 'id_number', label: 'ID number', help: 'Stored encrypted. Leave blank to keep the saved number.' }, { name: 'emergency_contact', label: 'Emergency contact', full: true }, { name: 'qualifications', label: 'Qualifications', type: 'textarea', full: true },
];
const instructorFields: FieldDef[] = [
  { name: 'employment_type', label: 'Employment', type: 'select', required: true, options: [{ value: 'employee', label: 'Employee' }, { value: 'associate', label: 'Associate (contract)' }] },
  { name: 'accreditation_body', label: 'Accrediting body' }, { name: 'accreditation_expiry', label: 'Accreditation expires', type: 'date', help: 'They cannot be scheduled after this date' },
  { name: 'specialties', label: 'Specialties', full: true }, { name: 'qualifications', label: 'Qualifications', type: 'textarea', full: true },
];

export default function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can, is, me } = useAuth();
  const toast = useToast();
  const user = useApi<any>(`/users/${id}`);
  const [reveal, setReveal] = useState(false);
  const profile = useApi<any>(can('users:read') ? `/users/${id}/profile${reveal ? '?reveal=true' : ''}` : null);
  const [tab, setTab] = useState('profile');
  const [edit, setEdit] = useState(false);
  const [suspend, setSuspend] = useState(false);
  if (user.error) return <ErrorNote error={user.error} />;
  if (!user.data) return <Loading />;
  const u = user.data; const p = profile.data;
  const isTrainee = u.role === 'trainee'; const staff = is('super_admin', 'training_admin');
  const regs: Column<any>[] = [{ key: 'programme_code', label: 'Programme', href: (e) => `/programmes/${e.programme_id}` }, { key: 'programme_title', label: 'Title' }, { key: 'start_date', label: 'Starts', render: (e) => date(e.start_date) }, { key: 'status', label: 'Status', render: (e) => <Badge value={e.status} /> }];
  const certs: Column<any>[] = [{ key: 'number', label: 'Certificate', render: (c) => <span className="mono">{c.number}</span>, href: (c) => `/certificates/${c.id}` }, { key: 'course_title', label: 'Course' }, { key: 'issued_at', label: 'Issued', render: (c) => date(c.issued_at) }, { key: 'expires_at', label: 'Expires', render: (c) => (c.expires_at ? date(c.expires_at) : 'No expiry') }, { key: 'status', label: 'Status', render: (c) => <Badge value={c.status} /> }];
  const docs: Column<any>[] = [{ key: 'filename', label: 'File' }, { key: 'category', label: 'Kind', render: (d) => label(d.category) }, { key: 'created_at', label: 'Added', render: (d) => date(d.created_at) }];
  const fields = isTrainee ? traineeFields : u.role === 'instructor' ? instructorFields : [];

  return (
    <>
      <PageHead title={u.full_name} crumbs={[{ label: isTrainee ? 'Trainees' : 'Instructors', href: isTrainee ? '/trainees' : '/instructors' }, ...(u.organization_id ? [{ label: u.organization_name, href: `/clients/${u.organization_id}` }] : []), { label: u.full_name }]}
        subtitle={<>{ROLE_LABEL[u.role as Role]} · {u.organization_name ?? 'Individual'} · <Badge value={u.status} /></>}
        actions={can('users:write') && staff || (is('org_admin') && isTrainee) ? <>
          {fields.length > 0 && <button className="btn outline" onClick={() => setEdit(true)}>Edit profile</button>}
          {u.id !== me.id && u.status !== 'suspended' && <button className="btn outline" onClick={async () => { try { const r = await api.post(`/users/${id}/send-reset`); toast(r.note ?? 'A password reset link has been emailed'); } catch (e) { toast((e as ApiError).message, 'error'); } }}>Send password reset</button>}
          {u.id !== me.id && (u.status === 'suspended' ? <button className="btn outline" onClick={async () => { await api.post(`/users/${id}/reactivate`); toast('Reactivated'); user.reload(); }}>Reactivate</button> : <button className="btn danger" onClick={() => setSuspend(true)}>Suspend</button>)}
        </> : undefined} />
      <div className="stack" style={{ gap: 20 }}>
        <div className="card card-body"><KV items={[['Email', u.email], ['Phone', u.phone], ['Organisation', u.organization_name ?? 'None (individual)'], ['Last sign-in', u.last_login_at ? dateTime(u.last_login_at) : 'Never'], ['Account created', date(u.created_at)]]} /></div>
        <div>
          <Tabs value={tab} onChange={setTab} tabs={[{ key: 'profile', label: 'Profile' }, ...(isTrainee ? [{ key: 'regs', label: 'Training history' }, { key: 'certs', label: 'Certificates' }] : []), { key: 'docs', label: 'Documents' }]} />
          {tab === 'profile' && (
            <Card title={isTrainee ? 'Trainee profile' : 'Instructor profile'}>
              {!p ? <div className="muted">{profile.loading ? 'Loading…' : 'No profile details recorded yet.'}</div> : (
                <KV items={isTrainee ? [['Aviation role', p.aviation_role], ['Employer', p.employer], ['Licence', p.licence_number], ['Licence expiry', p.licence_expiry && date(p.licence_expiry)], ['Nationality', p.nationality], ['Date of birth', p.date_of_birth && date(p.date_of_birth)], ['ID type', p.id_type],
                  ['ID number', p.id_number && <span className="row" key="n"><span className="mono">{p.id_number}</span>{staff && !reveal && <button className="btn ghost sm" onClick={() => setReveal(true)}>Show (recorded in audit log)</button>}</span>], ['Emergency contact', p.emergency_contact], ['Qualifications', p.qualifications]]
                  : [['Employment', label(p.employment_type)], ['Accrediting body', p.accreditation_body], ['Accreditation expires', p.accreditation_expiry && date(p.accreditation_expiry)], ['Specialties', p.specialties], ['Qualifications', p.qualifications]]} />
              )}
            </Card>
          )}
          {tab === 'regs' && <DataList path="/enrollments" extra={{ trainee_id: id }} columns={regs} search={false} empty={{ title: 'No training yet' }} />}
          {tab === 'certs' && <DataList path="/certificates" extra={{ trainee_id: id }} columns={certs} search={false} empty={{ title: 'No certificates yet' }} />}
          {tab === 'docs' && <DataList path="/documents" extra={{ owner_user_id: id }} columns={docs} search={false} empty={{ title: 'No documents' }} actions={(d) => <button className="btn outline sm" onClick={() => download(`/documents/${d.id}/download`, d.filename)}>Download</button>} />}
        </div>
      </div>
      {edit && <FormModal title="Edit profile" size="wide" fields={fields} initial={{ ...(p ?? {}), id_number: '' }} onClose={() => setEdit(false)} onSubmit={async (v) => { const body = { ...v }; if (!body.id_number) delete body.id_number; await api.put(`/users/${id}/profile`, body); toast('Profile saved'); profile.reload(); }} />}
      {suspend && <ConfirmModal title={`Suspend ${u.full_name}?`} message="They are signed out straight away and cannot sign in until reactivated." askReason="Reason" danger confirmLabel="Suspend" onClose={() => setSuspend(false)} onConfirm={async (reason) => { await api.post(`/users/${id}/suspend`, { reason }); toast('Suspended'); user.reload(); }} />}
    </>
  );
}
