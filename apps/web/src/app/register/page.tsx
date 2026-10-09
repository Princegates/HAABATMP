'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/logo';

/** Public. A request, not an account: a HAAB administrator reviews it, and approval sends the invitation email. */
export default function RegisterPage() {
  const [status, setStatus] = useState<{ enabled: boolean; notice: string } | null>(null);
  const [v, setV] = useState({ full_name: '', email: '', phone: '', organisation: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((p) => ({ ...p, [k]: e.target.value }));

  useEffect(() => { fetch('/api/registration/status').then((r) => r.json()).then(setStatus).catch(() => setStatus({ enabled: false, notice: '' })); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const res = await fetch('/api/registration', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(v) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(res.status === 429 ? 'Too many attempts. Wait a minute and try again.' : Array.isArray(json.message) ? json.message.join(', ') : json.message ?? 'Something went wrong');
      setDone(json.message);
    } catch (err: any) { setError(err.message); }
    setBusy(false);
  }

  return (
    <div className="verify">
      <div className="stack" style={{ width: 'min(520px, 100%)', alignItems: 'stretch' }}>
        <div style={{ background: 'var(--chrome-bg)', padding: '18px 24px' }}><Logo height={44} /></div>
        <div className="card card-body stack">
          {!status ? <span className="muted">Loading…</span> : !status.enabled ? (
            <><h2>Registration is <span className="accent">closed</span></h2><p className="muted">New accounts are created by HAAB. Contact your training coordinator if you need one.</p><Link href="/login" className="btn outline" style={{ alignSelf: 'flex-start' }}>Back to sign in</Link></>
          ) : done ? (
            <><h2>Request <span className="accent">received</span></h2><p className="muted">{done}</p><Link href="/login" className="btn outline" style={{ alignSelf: 'flex-start' }}>Back to sign in</Link></>
          ) : (
            <form className="stack" onSubmit={submit}>
              <div><h2>Request a <span className="accent">trainee account</span></h2><p className="muted">HAAB reviews every request. If it is approved, you receive an email with a link to choose your password.</p></div>
              {status.notice && <div className="alert info">{status.notice}</div>}
              <div className="field"><label htmlFor="full_name">Full name</label><input id="full_name" value={v.full_name} onChange={set('full_name')} required minLength={2} autoComplete="name" autoFocus /></div>
              <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" value={v.email} onChange={set('email')} required autoComplete="email" /></div>
              <div className="field"><label htmlFor="phone">Phone (optional)</label><input id="phone" value={v.phone} onChange={set('phone')} autoComplete="tel" /></div>
              <div className="field"><label htmlFor="organisation">Employer or organisation (optional)</label><input id="organisation" value={v.organisation} onChange={set('organisation')} autoComplete="organization" /></div>
              {/* honeypot: people never see or fill this */}
              <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }}><label htmlFor="website">Website</label><input id="website" tabIndex={-1} autoComplete="off" value={v.website} onChange={set('website')} /></div>
              {error && <div className="alert danger" role="alert">{error}</div>}
              <button className="btn" disabled={busy || v.full_name.trim().length < 2 || !v.email}>{busy ? 'Sending…' : 'Send request'}</button>
              <Link href="/login" className="muted" style={{ fontSize: 14 }}>Already have an account? Sign in</Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
