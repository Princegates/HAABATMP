'use client';
import { useState } from 'react';
import { api, useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { FieldDef, FormModal } from '@/components/form';
import { Card, ErrorNote, Loading, PageHead } from '@/components/ui';
import { useToast } from '@/components/toast';

export default function CategoriesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useApi<any[]>('/course-categories');
  const [form, setForm] = useState<'new' | any | null>(null);
  const fields = (isNew: boolean): FieldDef[] => [{ name: 'code', label: 'Code', required: true, disabled: !isNew, help: 'Two to five capital letters. Used in certificate numbers.' }, { name: 'name', label: 'Name', required: true }, { name: 'description', label: 'Description', type: 'textarea', full: true }];
  return (
    <>
      <PageHead title="Course" accent="categories" subtitle="Groups courses together. The code is part of every certificate number, so it cannot be changed once created." actions={can('courses:write') && <button className="btn" onClick={() => setForm('new')}>New category</button>} />
      <Card flush><ErrorNote error={error} />{!data && !error && <Loading />}
        {data && <table className="table"><thead><tr><th>Code</th><th>Name</th><th>Description</th><th /></tr></thead><tbody>{data.map((c) => <tr key={c.id}><td className="mono"><b style={{ fontWeight: 600 }}>{c.code}</b></td><td>{c.name}</td><td className="muted">{c.description}</td><td className="actions">{can('courses:write') && <button className="btn outline sm" onClick={() => setForm(c)}>Edit</button>}</td></tr>)}</tbody></table>}
      </Card>
      {form && <FormModal title={form === 'new' ? 'New category' : `Edit ${form.name}`} fields={fields(form === 'new')} initial={form === 'new' ? {} : form} onClose={() => setForm(null)}
        onSubmit={async (v) => { form === 'new' ? await api.post('/course-categories', v) : await api.patch(`/course-categories/${form.id}`, { name: v.name, description: v.description }); toast('Saved'); reload(); }} />}
    </>
  );
}
