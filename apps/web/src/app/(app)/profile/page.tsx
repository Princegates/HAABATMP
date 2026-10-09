'use client';
import { useEffect, useState } from 'react';
import { api, ApiError, useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Field, FieldDef } from '@/components/form';
import { useToast } from '@/components/toast';
import { Card, PageHead, Loading } from '@/components/ui';

const fields: FieldDef[] = [
  { name: 'aviation_role', label: 'Your aviation role' }, { name: 'employer', label: 'Employer' }, { name: 'licence_number', label: 'Licence number' }, { name: 'licence_expiry', label: 'Licence expiry', type: 'date' },
  { name: 'nationality', label: 'Nationality' }, { name: 'date_of_birth', label: 'Date of birth', type: 'date' }, { name: 'id_type', label: 'ID type', help: 'For example Ghana Card or passport' },
  { name: 'id_number', label: 'ID number', help: 'Stored encrypted. Leave blank to keep what is saved.' }, { name: 'emergency_contact', label: 'Emergency contact', full: true }, { name: 'qualifications', label: 'Qualifications', type: 'textarea', full: true },
];

async function mfa(body: Record<string, unknown>) {
  const res = await fetch('/api/session/mfa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message ?? 'Something went wrong');
  return json;
}

/** Two-step sign-in is optional unless the Super Admin requires it for this role. */
function SecurityCard() {
  const { me } = useAuth();
  const toast = useToast();
  const [setup, setSetup] = useState<{ factor_id: string; qr_svg?: string; secret?: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { toast((e as Error).message, 'error'); } setBusy(false); };
  return (
    <Card title="Two-step sign-in">
      {!me.mfa_available ? <p className="muted">Not available in this environment.</p> : (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>
            {me.mfa_enrolled
              ? 'On. You enter a six-digit code from your authenticator app each time you sign in.'
              : 'Off. Turn it on to protect your account with a code from an authenticator app on your phone.'}
            {me.mfa_required_by_policy && ' Your administrator requires it for your role.'}
          </p>
          {!me.mfa_enrolled && !setup && <div><button className="btn outline" disabled={busy} onClick={() => run(async () => { const q = await mfa({ action: 'enroll' }); setSetup(q); })}>Turn on</button></div>}
          {setup && (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await mfa({ action: 'verify', factor_id: setup.factor_id, code }); toast('Two-step sign-in is on'); window.location.reload(); }); }}>
              <p className="muted" style={{ margin: 0 }}>Scan this code with an authenticator app, then enter the six digits it shows.</p>
              {setup.qr_svg && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={setup.qr_svg.startsWith('data:') ? setup.qr_svg : `data:image/svg+xml;utf8,${encodeURIComponent(setup.qr_svg)}`} alt="QR code for your authenticator app" width={176} height={176} style={{ background: '#fff', padding: 8, alignSelf: 'flex-start' }} />
              )}
              {setup.secret && <span className="muted" style={{ fontSize: 12.5 }}>Or type this key: <code style={{ userSelect: 'all' }}>{setup.secret}</code></span>}
              <div className="field" style={{ maxWidth: 220 }}><label htmlFor="mfa-code">Six-digit code</label><input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
              <div className="row"><button className="btn" disabled={busy || code.length !== 6}>Confirm</button><button type="button" className="btn ghost" onClick={() => { setSetup(null); setCode(''); }}>Cancel</button></div>
            </form>
          )}
          {me.mfa_enrolled && !me.mfa_required_by_policy && <div><button className="btn outline" disabled={busy} onClick={() => run(async () => { await mfa({ action: 'disable' }); toast('Two-step sign-in is off'); window.location.reload(); })}>Turn off</button></div>}
        </div>
      )}
    </Card>
  );
}

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
      <SecurityCard />
    </>
  );
}
