'use client';
import { use, useState } from 'react';
import { api, useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Column, DataList } from '@/components/datalist';
import { FormModal } from '@/components/form';
import { ChecklistPicker } from '@/components/picker';
import { useToast } from '@/components/toast';
import { Badge, Card, ConfirmModal, ErrorNote, KV, Loading, PageHead, Tabs } from '@/components/ui';
import { date, label, money } from '@/lib/format';
import { useCategoryOptions, useCourseOptions, useInstructorOptions } from '@/lib/options';
import { courseFields } from '@/lib/course-fields';

const KINDS = ['video', 'pdf', 'presentation', 'document', 'audio', 'image', 'scorm', 'link'].map((v) => ({ value: v, label: label(v) }));

export default function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const toast = useToast();
  const course = useApi<any>(`/courses/${id}`);
  const cats = useCategoryOptions(); const allCourses = useCourseOptions(); const instructors = useInstructorOptions();
  const [tab, setTab] = useState('overview');
  const [edit, setEdit] = useState(false);
  const [addModule, setAddModule] = useState(false);
  const [addMaterial, setAddMaterial] = useState<string | null>(null);
  const [prereq, setPrereq] = useState<string[] | null>(null);
  const [instr, setInstr] = useState<string[] | null>(null);
  const [removeModule, setRemoveModule] = useState<any | null>(null);
  if (course.error) return <ErrorNote error={course.error} />;
  if (!course.data) return <Loading />;
  const c = course.data; const w = can('courses:write');
  const progs: Column<any>[] = [{ key: 'code', label: 'Programme', href: (p) => `/programmes/${p.id}` }, { key: 'start_date', label: 'Starts', render: (p) => date(p.start_date) }, { key: 'end_date', label: 'Ends', render: (p) => date(p.end_date) }, { key: 'confirmed_count', label: 'Confirmed', num: true }, { key: 'status', label: 'Status', render: (p) => <Badge value={p.status} /> }];
  return (
    <>
      <PageHead title={c.title} crumbs={[{ label: 'Courses', href: '/courses' }, { label: c.code }]} subtitle={<><span className="mono">{c.code}</span> · {c.category_name} · <Badge value={c.status} /></>} actions={w && <button className="btn outline" onClick={() => setEdit(true)}>Edit course</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Overview' }, { key: 'content', label: 'Modules and materials', count: c.modules.length }, { key: 'requirements', label: 'Requirements' }, { key: 'programmes', label: 'Programmes' }]} />
      {tab === 'overview' && (
        <div className="grid c2">
          <Card title="Rules"><KV items={[['Duration', `${c.duration_hours} hours`], ['Delivery', label(c.delivery_method)], ['Fee', money(c.fee, c.currency)], ['Capacity', c.capacity], ['Pass mark', `${c.pass_mark}%`], ['Minimum attendance', `${c.min_attendance_pct}%`], ['Certificate valid', c.validity_months ? `${c.validity_months} months` : 'No expiry']]} /></Card>
          <Card title="Recognition"><KV items={[['Approved by', c.approving_body || 'Not recorded'], ['Reference', c.approval_reference], ['Approval expires', c.approval_expiry && date(c.approval_expiry)], ['Audience', c.target_audience]]} />{!c.approving_body && <div className="alert warn" style={{ marginTop: 12 }}>No approving body is recorded. Add one if this course is accredited or aligned to a standard.</div>}</Card>
          {c.description && <Card title="About this course"><p>{c.description}</p></Card>}{c.objectives && <Card title="Objectives"><p style={{ whiteSpace: 'pre-wrap' }}>{c.objectives}</p></Card>}
        </div>
      )}
      {tab === 'content' && (
        <div className="stack">
          {w && <div><button className="btn sm" onClick={() => setAddModule(true)}>Add module</button></div>}
          {c.modules.length === 0 && <div className="card empty"><h3>No modules yet</h3><p>Modules group the learning materials trainees work through.</p></div>}
          {c.modules.map((m: any) => (
            <Card key={m.id} title={m.title} actions={w && <><button className="btn outline sm" onClick={() => setAddMaterial(m.id)}>Add material</button><button className="btn danger sm" onClick={() => setRemoveModule(m)}>Remove</button></>} flush>
              {m.materials.length === 0 ? <div className="empty muted">No materials in this module.</div> : <table className="table"><tbody>{m.materials.map((l: any) => (
                <tr key={l.id}><td><b style={{ fontWeight: 600 }}>{l.title}</b> {l.required && <Badge tone="neutral">Required</Badge>}</td><td>{label(l.kind)}</td><td>{l.url ? <a href={l.url} target="_blank" rel="noopener noreferrer">Open link</a> : 'Uploaded file'}</td>{w && <td className="actions"><button className="btn ghost sm" onClick={async () => { await api.del(`/materials/${l.id}`); course.reload(); }}>Remove</button></td>}</tr>))}</tbody></table>}
            </Card>
          ))}
        </div>
      )}
      {tab === 'requirements' && (
        <div className="grid c2">
          <Card title="Prerequisites" actions={w && <button className="btn outline sm" onClick={() => setPrereq(c.prerequisites.map((p: any) => p.id))}>Edit</button>}>
            {c.prerequisites.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{c.prerequisites.map((p: any) => <li key={p.id}>{p.code} · {p.title}</li>)}</ul> : <span className="muted">None. Anyone can register.</span>}
            <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>A trainee must hold a valid certificate for each prerequisite before they can register.</p></Card>
          <Card title="Authorised instructors" actions={w && <button className="btn outline sm" onClick={() => setInstr(c.instructors.map((p: any) => p.id))}>Edit</button>}>
            {c.instructors.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{c.instructors.map((p: any) => <li key={p.id}>{p.full_name}</li>)}</ul> : <span className="muted">No list. Any active instructor can be scheduled.</span>}
            <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>When a list exists, only these people can be scheduled to teach the course.</p></Card>
        </div>
      )}
      {tab === 'programmes' && <DataList path="/programmes" extra={{ course_id: id }} columns={progs} search={false} empty={{ title: 'No programmes yet', hint: 'Programmes are scheduled runs of this course.' }} />}

      {removeModule && <ConfirmModal title={`Remove ${removeModule.title}?`} message="The module and its materials are removed from the course. Trainee progress on them is lost." danger confirmLabel="Remove" onClose={() => setRemoveModule(null)} onConfirm={async () => { await api.del(`/modules/${removeModule.id}`); toast('Module removed'); course.reload(); }} />}
      {edit && <FormModal title="Edit course" size="wide" fields={courseFields(cats)} initial={c} onClose={() => setEdit(false)} onSubmit={async (v) => { await api.patch(`/courses/${id}`, v); toast('Saved'); course.reload(); }} />}
      {addModule && <FormModal title="Add module" size="narrow" fields={[{ name: 'title', label: 'Title', required: true, full: true }, { name: 'description', label: 'Description', type: 'textarea', full: true }]} onClose={() => setAddModule(false)} onSubmit={async (v) => { await api.post(`/courses/${id}/modules`, { ...v, position: c.modules.length }); course.reload(); }} />}
      {addMaterial && <FormModal title="Add learning material" fields={[{ name: 'title', label: 'Title', required: true }, { name: 'kind', label: 'Kind', type: 'select', required: true, options: KINDS }, { name: 'url', label: 'Link', type: 'url', required: true, full: true, help: 'A link to the video, document or SCORM package' }, { name: 'required', label: 'Trainees must complete this', type: 'checkbox', full: true }]} initial={{ kind: 'pdf', required: true }} onClose={() => setAddMaterial(null)} onSubmit={async (v) => { await api.post(`/modules/${addMaterial}/materials`, v); course.reload(); }} />}
      {prereq && <FormModal title="Prerequisites" size="wide" fields={[]} onClose={() => setPrereq(null)} onSubmit={async () => { await api.put(`/courses/${id}/prerequisites`, { ids: prereq }); toast('Saved'); course.reload(); }}><ChecklistPicker items={allCourses.filter((o) => o.value !== id)} selected={prereq} onChange={setPrereq} placeholder="Search courses" /></FormModal>}
      {instr && <FormModal title="Authorised instructors" size="wide" fields={[]} onClose={() => setInstr(null)} onSubmit={async () => { await api.put(`/courses/${id}/instructors`, { ids: instr }); toast('Saved'); course.reload(); }}><ChecklistPicker items={instructors} selected={instr} onChange={setInstr} placeholder="Search instructors" /></FormModal>}
    </>
  );
}
