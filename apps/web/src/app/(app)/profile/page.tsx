'use client';
import { useEffect, useState } from 'react';
import { api, ApiError, useApi } from '@/lib/api';
import { Field, FieldDef } from '@/components/form';
import { useToast } from '@/components/toast';
import { Card, PageHead, Loading } from '@/components/ui';

const fields: FieldDef[] = [
  { name: 'aviation_role', label: 'Your aviation role' }, { name: 'employer', label: 'Employer' }, { name: 'licence_number', label: 'Licence number' }, { name: 'licence_expiry', label: 'Licence expiry', type: 'date' },
  { name: 'nationality', label: 'Nationality' }, { name: 'date_of_birth', label: 'Date of birth', type: 'date' }, { name: 'id_type', label: 'ID type', help: 'For example Ghana Card or passport' },
  { name: 'id_number', label: 'ID number', help: 'Stored encrypted. Leave blank to keep what is saved.' }, { name: 'emergency_contact', label: 'Emergency contact', full: true }, { name: 'qualifications', label: 'Qualifications', type: 'textarea', full: true },
];

export default function ProfilePage() {
  const { data, reload } = useApi<any>('/profile');
  const toast = useToast();
  const [v, setV] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data !== undefined) setV(Object.fromEntries(fields.map((f) => [f.name, f.name === 'id_number' ? '' : data?.[f.name] ?? '']))); }, [data]);
  if (data === undefined) return <Loading />;
  return (
    <>
      <PageHead title="My" accent="profile" subtitle="Keep these details current. Your employer and licence details appear on your training record." />
      <Card><form className="stack" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { const body: Record<string, any> = {}; for (const f of fields) { const x = v[f.name]; if (x !== '' && x !== undefined) body[f.name] = x; } await api.put('/profile', body); toast('Profile saved'); reload(); } catch (err) { toast((err as ApiError).message, 'error'); } setBusy(false); }}>
        <div className="form-grid">{fields.map((f) => <Field key={f.name} def={f} value={v[f.name]} onChange={(x) => setV((p) => ({ ...p, [f.name]: x }))} />)}</div>
        {data?.id_number && <div className="muted">Saved ID number: <span className="mono">{data.id_number}</span></div>}
        <div><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button></div></form></Card>
    </>
  );
}
