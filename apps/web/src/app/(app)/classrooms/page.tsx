'use client';
import { useState } from 'react';
import { api, useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { FieldDef, FormModal } from '@/components/form';
import { Badge, Card, ErrorNote, Loading, PageHead } from '@/components/ui';
import { useToast } from '@/components/toast';
import { DeleteButton } from '@/components/delete';

const fields: FieldDef[] = [{ name: 'name', label: 'Name', required: true }, { name: 'capacity', label: 'Seats', type: 'number', required: true, min: 1 }, { name: 'location', label: 'Where', full: true }, { name: 'active', label: 'In use', type: 'checkbox', full: true }];

export default function ClassroomsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useApi<any[]>('/classrooms');
  const [form, setForm] = useState<'new' | any | null>(null);
  return (
    <>
      <PageHead title="Class" accent="rooms" subtitle="Rooms that can be booked for sessions. A room cannot be booked twice at the same time." actions={can('programmes:write') && <button className="btn" onClick={() => setForm('new')}>New classroom</button>} />
      <Card flush><ErrorNote error={error} />{!data && !error && <Loading />}
        {data && <table className="table"><thead><tr><th>Room</th><th className="num">Seats</th><th>Where</th><th>Status</th><th /></tr></thead><tbody>{data.map((r) => <tr key={r.id}><td><b style={{ fontWeight: 600 }}>{r.name}</b></td><td className="num">{r.capacity}</td><td className="muted">{r.location}</td><td><Badge tone={r.active ? 'ok' : 'neutral'}>{r.active ? 'In use' : 'Retired'}</Badge></td><td className="actions">{can('programmes:write') && <button className="btn outline sm" onClick={() => setForm(r)}>Edit</button>}<DeleteButton path={`/classrooms/${r.id}`} what={r.name} goes="Sessions that used it are kept and simply have no room." onDone={reload} /></td></tr>)}</tbody></table>}
      </Card>
      {form && <FormModal title={form === 'new' ? 'New classroom' : `Edit ${form.name}`} size="narrow" fields={fields} initial={form === 'new' ? { active: true, capacity: 20 } : form} onClose={() => setForm(null)} onSubmit={async (v) => { form === 'new' ? await api.post('/classrooms', v) : await api.patch(`/classrooms/${form.id}`, v); toast('Saved'); reload(); }} />}
    </>
  );
}
