'use client';
import { use, useEffect, useState } from 'react';
import { api, ApiError, useApi } from '@/lib/api';
import { Field, FieldDef } from '@/components/form';
import { useToast } from '@/components/toast';
import { Badge, Card, ErrorNote, Loading } from '@/components/ui';

interface PageData {
  key: string; title: string; description: string; status: 'active' | 'planned'; can_edit: boolean; values: Record<string, any>;
  fields: { name: string; label: string; type: string; help?: string; options?: { value: string; label: string }[]; min?: number; max?: number }[];
}
interface Method { key: string; label: string; enabled: boolean; instructions: string }

/** One generic form, driven by the field list the API publishes for each settings page. */
export default function SettingsPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const { data, error, loading, reload } = useApi<PageData>(`/settings/pages/${key}`);
  const toast = useToast();
  const [values, setValues] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (data) setValues(Object.fromEntries(data.fields.map((f) => [f.name, data.values[f.name]]))); }, [data]);

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!data) return;
    setBusy(true); setErrors({});
    const body: Record<string, any> = {};
    for (const f of data.fields) {
      const v = values[f.name];
      if (f.type === 'number') body[f.name] = Number(v);
      else if (f.type === 'tags') body[f.name] = Array.isArray(v) ? v : String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => (/^\d+$/.test(s) ? Number(s) : s));
      else if (f.type === 'boolean') body[f.name] = !!v;
      else body[f.name] = v ?? '';
    }
    try { await api.put(`/settings/pages/${key}`, body); toast('Saved'); reload(); }
    catch (err) {
      const ae = err as ApiError; const fe: Record<string, string> = {};
      for (const i of ae.issues) fe[i.path.split('.')[0]] = i.message;
      setErrors(fe); toast(Object.keys(fe).length ? 'Please check the highlighted fields' : ae.message, 'error');
    }
    setBusy(false);
  }

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const readOnly = !data.can_edit;
  return (
    <Card title={<>{data.title} {data.status === 'planned' && <Badge tone="neutral">Planned</Badge>}</>}>
      <form onSubmit={save} className="stack" noValidate>
        <p className="muted">{data.description}</p>
        {readOnly && data.status === 'active' && <div className="alert info">You can view this page but not change it.</div>}
        {data.status === 'planned' && <div className="alert warn">This setting is not available yet. It is listed so you can see what is coming.</div>}
        {data.fields.length > 0 && (
          <div className="form-grid">
            {data.fields.map((f) => {
              if (f.type === 'methods') return <MethodsEditor key={f.name} value={(values[f.name] ?? []) as Method[]} disabled={readOnly} onChange={(v) => setValues((p) => ({ ...p, [f.name]: v }))} />;
              const def: FieldDef = { name: f.name, label: f.label, help: f.help, disabled: readOnly, full: f.type === 'textarea' || f.type === 'boolean',
                type: f.type === 'boolean' ? 'checkbox' : (f.type as FieldDef['type']), options: f.options, min: f.min, max: f.max };
              return <Field key={f.name} def={def} value={values[f.name]} error={errors[f.name]} onChange={(v) => setValues((p) => ({ ...p, [f.name]: v }))} />;
            })}
          </div>
        )}
        {data.can_edit && data.fields.length > 0 && <div><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div>}
      </form>
    </Card>
  );
}

function MethodsEditor({ value, onChange, disabled }: { value: Method[]; onChange: (v: Method[]) => void; disabled: boolean }) {
  const set = (i: number, patch: Partial<Method>) => onChange(value.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  return (
    <div className="full stack tight">
      <div className="label">Payment methods</div>
      <div className="card"><table className="table"><thead><tr><th>On</th><th>Method</th><th>Label</th><th>Instructions printed on invoices</th></tr></thead><tbody>
        {value.map((m, i) => (
          <tr key={m.key}>
            <td><input type="checkbox" aria-label={`Enable ${m.label}`} checked={m.enabled} disabled={disabled} onChange={(e) => set(i, { enabled: e.target.checked })} style={{ accentColor: 'var(--accent)', width: 17, height: 17 }} /></td>
            <td className="muted">{m.key.replace('_', ' ')}</td>
            <td><input type="text" aria-label={`${m.key} label`} value={m.label} disabled={disabled} onChange={(e) => set(i, { label: e.target.value })} /></td>
            <td><input type="text" aria-label={`${m.key} instructions`} value={m.instructions} disabled={disabled} placeholder="For example: account name, number and bank" onChange={(e) => set(i, { instructions: e.target.value })} /></td>
          </tr>
        ))}
      </tbody></table></div>
    </div>
  );
}
