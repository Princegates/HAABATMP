'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Column, DataList } from '@/components/datalist';
import { FieldDef, FormModal } from '@/components/form';
import { Badge, PageHead } from '@/components/ui';
import { useToast } from '@/components/toast';
import { orgFields } from '@/lib/org';
import { label } from '@/lib/format';
import { DeleteButton } from '@/components/delete';

function Inner() {
  const { can, is } = useAuth();
  const toast = useToast();
  const params = useSearchParams();
  const [form, setForm] = useState<'new' | any | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { if (params.get('new') && can('orgs:write')) setForm('new'); }, [params, can]);
  const columns: Column<any>[] = [
    { key: 'name', label: 'Organisation', render: (o) => <b style={{ fontWeight: 600 }}>{o.name}</b>, href: (o) => `/clients/${o.id}` },
    { key: 'type', label: 'Type', render: (o) => label(o.type) }, { key: 'trainee_count', label: 'Trainees', num: true },
    { key: 'contact_name', label: 'Contact', render: (o) => <>{o.contact_name}<div className="muted">{o.contact_email}</div></> }, { key: 'status', label: 'Status', render: (o) => <Badge value={o.status} /> },
  ];
  return (
    <>
      <PageHead title={is('org_admin') ? 'Your' : 'Client'} accent={is('org_admin') ? 'organisation' : 'organisations'} subtitle="The airlines, airports and other organisations that train with HAAB. Each one's trainees, bookings, results and invoices are kept separate from every other client."
        actions={can('orgs:write') && <button className="btn" onClick={() => setForm('new')}>New client</button>} />
      <DataList path="/organizations" columns={columns} refreshKey={tick} searchPlaceholder="Search organisations"
        filters={[{ name: 'status', label: 'Status', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] }]}
        actions={(o) => can('orgs:write') && <span className="row" style={{ justifyContent: 'flex-end' }}><button className="btn outline sm" onClick={() => setForm(o)}>Edit</button><DeleteButton path={`/organizations/${o.id}?with_people=true`} what={o.name} goes="Its people go with it, with their registrations and unpaid invoices." onDone={() => setTick((t) => t + 1)} /></span>} empty={{ title: 'No clients yet', hint: 'Add the first organisation to start registering its people.' }} />
      {form && <FormModal title={form === 'new' ? 'New client' : `Edit ${form.name}`} size="wide" fields={orgFields} initial={form === 'new' ? { type: 'other', status: 'active' } : form} onClose={() => setForm(null)}
        onSubmit={async (v) => { form === 'new' ? await api.post('/organizations', v) : await api.patch(`/organizations/${form.id}`, v); toast('Saved'); setTick((t) => t + 1); }} />}
    </>
  );
}
export default function ClientsPage() { return <Suspense><Inner /></Suspense>; }
