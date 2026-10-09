'use client';
import { useState } from 'react';
import { api, useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { FieldDef, FormModal } from '@/components/form';
import { Card, ConfirmModal, ErrorNote, Loading, Modal, PageHead } from '@/components/ui';
import { useToast } from '@/components/toast';

export default function CategoriesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useApi<any[]>('/course-categories');
  const [form, setForm] = useState<'new' | any | null>(null);
  const [del, setDel] = useState<any | null>(null);
  const [withCourses, setWithCourses] = useState(false);
  const fields = (isNew: boolean): FieldDef[] => [{ name: 'code', label: 'Code', required: true, disabled: !isNew, help: 'Two to five capital letters. Used in certificate numbers.' }, { name: 'name', label: 'Name', required: true }, { name: 'description', label: 'Description', type: 'textarea', full: true }];
  return (
    <>
      <PageHead title="Course" accent="categories" subtitle="Groups courses together. The code is part of every certificate number, so it cannot be changed once created." actions={can('courses:write') && <button className="btn" onClick={() => setForm('new')}>New category</button>} />
      <Card flush><ErrorNote error={error} />{!data && !error && <Loading />}
        {data && <table className="table"><thead><tr><th>Code</th><th>Name</th><th>Description</th><th className="num">Courses</th><th /></tr></thead><tbody>{data.map((c) => <tr key={c.id}><td className="mono"><b style={{ fontWeight: 600 }}>{c.code}</b></td><td>{c.name}</td><td className="muted">{c.description}</td><td className="num">{c.course_count}</td><td className="actions">{can('courses:write') && <span className="row" style={{ justifyContent: 'flex-end' }}><button className="btn outline sm" onClick={() => setForm(c)}>Edit</button><button className="btn ghost sm" onClick={() => { setWithCourses(false); setDel(c); }}>Delete</button></span>}</td></tr>)}</tbody></table>}
      </Card>
      {del && (del.course_count === 0
        ? <ConfirmModal title={`Delete ${del.code}?`} danger confirmLabel="Delete category" message={<>Delete the category <b>{del.name}</b>? It has no courses. This cannot be undone.</>} onClose={() => setDel(null)}
            onConfirm={async () => { await api.del(`/course-categories/${del.id}`); toast('Category deleted'); reload(); }} />
        : <Modal title={`Delete ${del.code}?`} size="narrow" onClose={() => setDel(null)} footer={<>
            <button className="btn outline" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn danger" disabled={!withCourses} onClick={async () => { try { await api.del(`/course-categories/${del.id}?with_courses=true`); toast('Category and its courses deleted'); setDel(null); reload(); } catch (e: any) { toast(e.message, 'error'); } }}>Delete category and courses</button></>}>
            <div className="stack">
              <p style={{ margin: 0 }}><b>{del.name}</b> has {del.course_count} course{del.course_count === 1 ? '' : 's'}. A category can only be deleted together with its courses, and only if none of them has programmes, certificates or assessments.</p>
              <label className="check"><input type="checkbox" checked={withCourses} onChange={(e) => setWithCourses(e.target.checked)} /><span>Yes, delete the category and all {del.course_count} of its courses. This cannot be undone.</span></label>
              <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>If any course has been used, nothing is deleted. Archive those courses instead and delete the rest one by one.</p>
            </div>
          </Modal>)}
      {form && <FormModal title={form === 'new' ? 'New category' : `Edit ${form.name}`} fields={fields(form === 'new')} initial={form === 'new' ? {} : form} onClose={() => setForm(null)}
        onSubmit={async (v) => { form === 'new' ? await api.post('/course-categories', v) : await api.patch(`/course-categories/${form.id}`, { name: v.name, description: v.description }); toast('Saved'); reload(); }} />}
    </>
  );
}
