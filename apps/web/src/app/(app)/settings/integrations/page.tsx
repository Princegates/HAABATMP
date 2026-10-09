'use client';
import { useState } from 'react';
import { api, ApiError, useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Card, ErrorNote, Loading } from '@/components/ui';
import { useToast } from '@/components/toast';
import { date } from '@/lib/format';

interface IField { name: string; label: string; type: 'text' | 'secret' | 'select' | 'boolean' | 'number'; help?: string; required?: boolean; options?: { value: string; label: string }[]; configured: boolean; value?: any; hint?: string }
interface Integration { key: string; title: string; description: string; status: 'active' | 'planned'; testable: boolean; enabled: boolean; source: 'database' | 'environment' | 'none'; secrets_updated_at: string | null; fields: IField[] }
interface Status {
  environment: string; database: { connected: boolean; note: string }; authentication: { mode: string; provider_host: string | null; anon_key_set: boolean; service_key_set: boolean; note: string };
  encryption: { master_key_set: boolean; note: string }; storage: { driver: string; bucket: string | null }; mfa_required_for: string[];
}

export default function IntegrationsPage() {
  const { is } = useAuth();
  const list = useApi<Integration[]>('/integrations');
  const status = useApi<Status>('/settings/system-status');
  if (!is('super_admin')) return <div className="alert warn">Only a super administrator can manage integrations.</div>;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="alert info"><b>How keys are kept.</b> Keys are encrypted before they are stored and can never be shown again, only replaced or removed. Every change is written to the audit log (the field name, never the value) and the other super administrators are emailed.</div>
      <Card title="Host settings"><HostStatus status={status.data} error={status.error} /></Card>
      <ErrorNote error={list.error} />
      {!list.data && !list.error && <Loading />}
      {list.data?.map((i) => <IntegrationCard key={i.key} item={i} onSaved={list.reload} />)}
    </div>
  );
}

function HostStatus({ status, error }: { status?: Status; error?: { message: string } }) {
  if (error) return <ErrorNote error={error} />;
  if (!status) return <Loading />;
  const row = (k: string, v: React.ReactNode, note?: string) => <tr key={k}><td style={{ width: 200 }} className="label">{k}</td><td>{v}</td><td className="muted">{note}</td></tr>;
  return (
    <>
      <p className="muted" style={{ marginBottom: 12 }}>The platform needs these to start and to sign anyone in, so they are held by the server, not by this screen. Change them in the hosting settings.</p>
      <table className="table"><tbody>
        {row('Database', <Badge tone={status.database.connected ? 'ok' : 'danger'}>{status.database.connected ? 'Connected' : 'Not reachable'}</Badge>, status.database.note)}
        {row('Sign-in', <><Badge tone={status.authentication.mode === 'supabase' ? 'ok' : 'warn'}>{status.authentication.mode === 'supabase' ? 'Supabase Auth' : 'Development mode'}</Badge> <span className="muted">{status.authentication.provider_host}</span></>, status.authentication.mode === 'dev' ? 'Development sign-in must never be used in production.' : status.authentication.note)}
        {row('Encryption key', <Badge tone={status.encryption.master_key_set ? 'ok' : 'warn'}>{status.encryption.master_key_set ? 'Set' : 'Using development key'}</Badge>, status.encryption.note)}
        {row('File storage', <Badge tone={status.storage.driver === 'supabase' ? 'ok' : 'warn'}>{status.storage.driver}</Badge>, status.storage.bucket ?? 'Local disk is lost on redeploy. Use Supabase storage in production.')}
        {row('Second factor', status.mfa_required_for.map((r) => r.replace('_', ' ')).join(', '), 'Roles that must use an authenticator app.')}
        {row('Environment', status.environment)}
      </tbody></table>
    </>
  );
}

function IntegrationCard({ item, onSaved }: { item: Integration; onSaved: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(item.status === 'active');
  const [enabled, setEnabled] = useState(item.enabled);
  const [config, setConfig] = useState<Record<string, any>>(() => Object.fromEntries(item.fields.filter((f) => f.type !== 'secret').map((f) => [f.name, f.value ?? (f.type === 'boolean' ? false : '')])));
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [remove, setRemove] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [err, setErr] = useState('');
  const dirty = Object.values(secrets).some(Boolean) || Object.values(remove).some(Boolean) || enabled !== item.enabled || item.fields.some((f) => f.type !== 'secret' && String(config[f.name] ?? '') !== String(f.value ?? (f.type === 'boolean' ? false : '')));

  async function save() {
    setBusy(true); setErr(''); setResult(null);
    const cfg: Record<string, any> = {};
    for (const f of item.fields.filter((x) => x.type !== 'secret')) {
      const v = config[f.name];
      cfg[f.name] = v === '' || v === undefined ? null : f.type === 'number' ? Number(v) : v;
    }
    const sec: Record<string, string | null> = {};
    for (const f of item.fields.filter((x) => x.type === 'secret')) { if (remove[f.name]) sec[f.name] = null; else if (secrets[f.name]) sec[f.name] = secrets[f.name]; }
    try { await api.put(`/integrations/${item.key}`, { enabled, config: cfg, secrets: sec }); toast(`${item.title} saved`); setSecrets({}); setRemove({}); onSaved(); }
    catch (e) { setErr((e as ApiError).message); }
    setBusy(false);
  }
  async function test() {
    setBusy(true); setResult(null);
    try { setResult(await api.post(`/integrations/${item.key}/test`)); } catch (e) { setResult({ ok: false, message: (e as ApiError).message }); }
    setBusy(false);
  }

  const configured = item.fields.filter((f) => f.required).every((f) => f.configured) && item.fields.some((f) => f.configured);
  return (
    <section className="card">
      <div className="card-head" style={{ cursor: 'pointer' }} onClick={() => setOpen((o) => !o)} role="button" aria-expanded={open} tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpen((o) => !o)}>
        <div><h3>{item.title}</h3><div className="muted" style={{ fontSize: 13.5 }}>{item.description}</div></div>
        <div className="row">
          {item.status === 'planned' && <Badge tone="neutral">Planned</Badge>}
          {item.source === 'environment' && <Badge tone="info">From server settings</Badge>}
          <Badge tone={configured ? (item.enabled ? 'ok' : 'warn') : 'neutral'}>{configured ? (item.enabled ? 'In use' : 'Switched off') : 'Not set up'}</Badge>
        </div>
      </div>
      {open && (
        <div className="card-body stack">
          {item.source === 'environment' && <div className="alert info">These values come from the server's own settings. Saving here moves them into the platform, where they are encrypted and audited.</div>}
          <label className="check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /><span>Use this integration</span></label>
          <div className="form-grid">
            {item.fields.map((f) => {
              const id = `int_${item.key}_${f.name}`;
              if (f.type === 'secret') {
                return (
                  <div className="field" key={f.name}>
                    <label htmlFor={id}>{f.label}{f.required && ' *'}</label>
                    <input id={id} type="password" autoComplete="new-password" value={secrets[f.name] ?? ''} disabled={remove[f.name]} onChange={(e) => setSecrets((p) => ({ ...p, [f.name]: e.target.value }))}
                      placeholder={remove[f.name] ? 'Will be removed when you save' : f.configured ? `Saved (${f.hint ?? 'set'}). Type to replace.` : 'Paste the key'} />
                    <span className="help">{f.help}{f.configured && <> <button type="button" className="btn ghost sm" onClick={() => setRemove((p) => ({ ...p, [f.name]: !p[f.name] }))}>{remove[f.name] ? 'Keep it' : 'Remove saved key'}</button></>}</span>
                  </div>
                );
              }
              return (
                <div className="field" key={f.name}>
                  <label htmlFor={id}>{f.label}{f.required && ' *'}</label>
                  {f.type === 'select' ? (
                    <select id={id} value={config[f.name] ?? ''} onChange={(e) => setConfig((p) => ({ ...p, [f.name]: e.target.value }))}><option value="">Choose…</option>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                  ) : f.type === 'boolean' ? (
                    <label className="check"><input id={id} type="checkbox" checked={!!config[f.name]} onChange={(e) => setConfig((p) => ({ ...p, [f.name]: e.target.checked }))} /><span>{f.help ?? 'On'}</span></label>
                  ) : (
                    <input id={id} type={f.type === 'number' ? 'number' : 'text'} value={config[f.name] ?? ''} onChange={(e) => setConfig((p) => ({ ...p, [f.name]: e.target.value }))} />
                  )}
                  {f.help && f.type !== 'boolean' && <span className="help">{f.help}</span>}
                </div>
              );
            })}
          </div>
          {item.secrets_updated_at && item.fields.some((f) => f.type === 'secret' && f.configured) && <div className="muted" style={{ fontSize: 13 }}>Keys last changed {date(item.secrets_updated_at)}.</div>}
          {err && <div className="alert danger" role="alert">{err}</div>}
          {result && <div className={`alert ${result.ok ? 'ok' : 'danger'}`} role="status"><b>{result.ok ? 'Working.' : 'Test failed.'}</b> {result.message}</div>}
          <div className="row">
            <button className="btn" disabled={busy || !dirty} onClick={save}>{busy ? 'Working…' : 'Save'}</button>
            {item.testable && <button className="btn outline" disabled={busy || dirty} title={dirty ? 'Save first, then test' : ''} onClick={test}>Test connection</button>}
            {item.testable && dirty && <span className="muted" style={{ fontSize: 13 }}>Save your changes before testing.</span>}
          </div>
        </div>
      )}
    </section>
  );
}
