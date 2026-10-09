'use client';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { Modal } from './ui';

export type FieldDef = {
  name: string; label: string; type?: 'text' | 'email' | 'password' | 'number' | 'date' | 'datetime' | 'textarea' | 'select' | 'checkbox' | 'tags' | 'url';
  options?: { value: string; label: string }[]; required?: boolean; help?: string; full?: boolean; min?: number; max?: number; step?: number; placeholder?: string;
  hidden?: (v: Record<string, any>) => boolean; disabled?: boolean;
};

/** Renders one field from its definition. Values are kept as strings/booleans and converted on submit. */
export function Field({ def, value, onChange, error }: { def: FieldDef; value: any; onChange: (v: any) => void; error?: string }) {
  const id = `f_${def.name}`;
  const common = { id, 'aria-invalid': !!error, disabled: def.disabled };
  let control: React.ReactNode;
  switch (def.type) {
    case 'textarea': control = <textarea {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={def.placeholder} />; break;
    case 'select': control = (
      <select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {!def.required && <option value="">None</option>}{def.required && value === '' && <option value="">Choose…</option>}
        {def.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>); break;
    case 'checkbox': return (
      <div className={`field ${def.full ? 'full' : ''}`}>
        <label className="check" htmlFor={id} style={{ textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--font-body)', fontSize: 14.5, fontWeight: 400, color: 'var(--text)' }}>
          <input id={id} type="checkbox" checked={!!value} disabled={def.disabled} onChange={(e) => onChange(e.target.checked)} /><span>{def.label}{def.help && <span className="help" style={{ display: 'block' }}>{def.help}</span>}</span>
        </label>{error && <span className="err">{error}</span>}
      </div>);
    case 'tags': control = <input {...common} type="text" value={Array.isArray(value) ? value.join(', ') : value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={def.placeholder ?? 'Separate with commas'} />; break;
    case 'datetime': control = <input {...common} type="datetime-local" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />; break;
    default: control = <input {...common} type={def.type ?? 'text'} value={value ?? ''} min={def.min} max={def.max} step={def.step} placeholder={def.placeholder} autoComplete={def.type === 'password' ? 'new-password' : 'off'} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <div className={`field ${def.full ? 'full' : ''}`}>
      <label htmlFor={id}>{def.label}{def.required && <span aria-hidden="true"> *</span>}</label>
      {control}
      {def.help && !error && <span className="help">{def.help}</span>}
      {error && <span className="err">{error}</span>}
    </div>
  );
}

/** Converts form strings into what the API expects. Empty optional fields are left out. */
export function coerce(defs: FieldDef[], values: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const d of defs) {
    if (d.hidden?.(values)) continue;
    const v = values[d.name];
    if (d.type === 'checkbox') { out[d.name] = !!v; continue; }
    if (v === '' || v === undefined || v === null) { if (d.type === 'select' || d.type === 'text' || d.type === 'textarea' || d.type === 'date') out[d.name] = null; continue; }
    if (d.type === 'number') out[d.name] = Number(v);
    else if (d.type === 'tags') out[d.name] = Array.isArray(v) ? v : String(v).split(',').map((s) => s.trim()).filter(Boolean).map((s) => (/^\d+$/.test(s) ? Number(s) : s));
    else if (d.type === 'datetime') out[d.name] = new Date(`${v}:00Z`).toISOString();
    else out[d.name] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

export function FormModal({ title, fields, initial, submitLabel = 'Save', size, onSubmit, onClose, children }: {
  title: string; fields: FieldDef[]; initial?: Record<string, any>; submitLabel?: string; size?: 'narrow' | 'wide';
  onSubmit: (values: Record<string, any>) => Promise<unknown>; onClose: () => void; children?: React.ReactNode;
}) {
  const [values, setValues] = useState<Record<string, any>>(() => Object.fromEntries(fields.map((f) => [f.name, initial?.[f.name] ?? (f.type === 'checkbox' ? false : '')])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState('');
  const [busy, setBusy] = useState(false);
  const missing = fields.filter((f) => f.required && !f.hidden?.(values) && (values[f.name] === '' || values[f.name] === undefined));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErrors({}); setGeneral('');
    try { await onSubmit(coerce(fields, values)); onClose(); }
    catch (err) {
      const ae = err as ApiError;
      const fe: Record<string, string> = {};
      for (const i of ae.issues ?? []) fe[i.path.split('.')[0]] = i.message;
      setErrors(fe);
      const conflicts = ae.conflicts?.length ? ` Clashes with: ${ae.conflicts.map((c: any) => `${c.kind} (${c.programme}: ${c.session})`).join('; ')}.` : '';
      setGeneral(Object.keys(fe).length ? 'Please check the highlighted fields.' : `${ae.message}${conflicts}`);
      setBusy(false);
    }
  }
  return (
    <Modal title={title} size={size} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="stack">
          <div className="form-grid">
            {fields.filter((f) => !f.hidden?.(values)).map((f) => <Field key={f.name} def={f} value={values[f.name]} error={errors[f.name]} onChange={(v) => setValues((p) => ({ ...p, [f.name]: v }))} />)}
          </div>
          {children}
          {general && <div className="alert danger" role="alert">{general}</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn outline" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn" disabled={busy || missing.length > 0}>{busy ? 'Saving…' : submitLabel}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
