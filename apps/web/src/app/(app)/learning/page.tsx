'use client';
import { useState } from 'react';
import { api, useApi } from '@/lib/api';
import { Badge, Card, ErrorNote, Loading, PageHead } from '@/components/ui';
import { label } from '@/lib/format';
import { useToast } from '@/components/toast';

function Course({ c }: { c: any }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const d = useApi<{ modules: any[] }>(open ? `/my/learning/${c.course_id}` : null);
  const pctDone = c.required_items ? Math.round((c.completed_items / c.required_items) * 100) : 0;
  return (
    <Card title={c.title} actions={<><span className="muted">{c.completed_items} of {c.required_items} required done</span><button className="btn outline sm" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Open'}</button></>}>
      <div className="tile" style={{ border: 0, padding: 0 }}><div className="bar" aria-hidden="true"><i style={{ width: `${pctDone}%` }} /></div></div>
      {open && (
        <div className="stack" style={{ marginTop: 16 }}>
          {!d.data && <Loading />}
          {d.data?.modules.map((m) => (
            <div key={m.id}><h3 style={{ marginBottom: 8 }}>{m.title}</h3>
              {m.materials.length === 0 ? <span className="muted">Nothing in this module yet.</span> : <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{m.materials.map((l: any) => (
                <li key={l.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span>{l.url ? <a href={l.url} target="_blank" rel="noopener noreferrer" onClick={async () => { if (l.status === 'not_started') { await api.put(`/materials/${l.id}/progress`, { status: 'in_progress' }); d.reload(); } }}>{l.title}</a> : l.title} <span className="muted">· {label(l.kind)}</span> {l.required && <Badge tone="neutral">Required</Badge>}</span>
                  <label className="check"><input type="checkbox" checked={l.status === 'completed'} onChange={async (e) => { await api.put(`/materials/${l.id}/progress`, { status: e.target.checked ? 'completed' : 'in_progress' }); toast(e.target.checked ? 'Marked as done' : 'Marked as not done'); d.reload(); }} /><span>Done</span></label>
                </li>))}</ul>}</div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function LearningPage() {
  const { data, error } = useApi<any[]>('/my/learning');
  return (
    <>
      <PageHead title="Learning" accent="materials" subtitle="The reading and resources for programmes you are confirmed on. Tick each one off as you finish it." />
      <ErrorNote error={error} />{!data && !error && <Loading />}
      <div className="stack">{data?.length === 0 && <Card><div className="empty muted">Materials appear here once your place on a programme is confirmed.</div></Card>}{data?.map((c) => <Course key={c.programme_id} c={c} />)}</div>
    </>
  );
}
