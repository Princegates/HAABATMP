'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/logo';

/**
 * Opened from the emailed invitation or reset link. The link carries a one-time token in the part of the address after
 * the "#", which browsers never send to any server. It is read here, removed from the address bar, and used once.
 */
export default function SetPasswordPage() {
  const [token, setToken] = useState('');
  const [problem, setProblem] = useState('');
  const [invited, setInvited] = useState(false);
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const t = h.get('access_token');
    if (t) { setToken(t); setInvited(h.get('type') === 'invite'); }
    else setProblem(h.get('error_description')?.replace(/\+/g, ' ') ?? 'This link is missing its token. Open the link from your email again, or ask for a new one.');
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const rules = [
    { ok: pw.length >= 12, text: 'At least 12 characters' }, { ok: /[A-Za-z]/.test(pw) && /\d/.test(pw), text: 'Letters and at least one number' }, { ok: pw.length > 0 && pw === again, text: 'Both entries match' },
  ];
  const ready = rules.every((r) => r.ok);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const res = await fetch('/api/auth/set-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ access_token: token, password: pw }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(res.status === 401 ? 'This link has expired or was already used. Ask for a new one.' : json.message ?? 'Something went wrong');
      setDone(true);
    } catch (err: any) { setError(err.message); }
    setBusy(false);
  }

  return (
    <div className="verify">
      <div className="stack" style={{ width: 'min(480px, 100%)', alignItems: 'stretch' }}>
        <div style={{ background: 'var(--chrome-bg)', padding: '18px 24px' }}><Logo height={44} /></div>
        <div className="card card-body stack">
          {done ? (
            <><h2>Password <span className="accent">set</span></h2><p className="muted">You can sign in now{invited ? '. Staff roles are asked to set up an authenticator app on first sign-in' : ''}.</p><Link href="/login" className="btn" style={{ alignSelf: 'flex-start' }}>Go to sign in</Link></>
          ) : problem ? (
            <><h2>This link <span className="accent">did not work</span></h2><div className="alert warn">{problem}</div><Link href="/login" className="btn outline" style={{ alignSelf: 'flex-start' }}>Back to sign in</Link></>
          ) : (
            <form className="stack" onSubmit={submit} noValidate>
              <div><h2>{invited ? 'Welcome. ' : ''}Choose a <span className="accent">password</span></h2><p className="muted">{invited ? 'Your account has been created for you. Choose a password to finish.' : 'Choose a new password for your account.'}</p></div>
              <div className="field"><label htmlFor="pw">New password</label><input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></div>
              <div className="field"><label htmlFor="pw2">Type it again</label><input id="pw2" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{rules.map((r) => <li key={r.text} style={{ color: r.ok ? 'var(--ok)' : 'var(--text-muted)', fontSize: 13.5 }}>{r.ok ? '✓' : '•'} {r.text}</li>)}</ul>
              {error && <div className="alert danger" role="alert">{error}</div>}
              <button className="btn" disabled={!ready || busy}>{busy ? 'Saving…' : 'Set password'}</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
