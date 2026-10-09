'use client';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/shell';

type Stage = { kind: 'password' } | { kind: 'mfa'; factorId: string | null; qr?: string; secret?: string };

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const [stage, setStage] = useState<Stage>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [canRegister, setCanRegister] = useState(false);
  useEffect(() => { fetch('/api/registration/status').then((r) => r.json()).then((s) => setCanRegister(Boolean(s.enabled))).catch(() => undefined); }, []);
  const [forgotDone, setForgotDone] = useState(false);

  async function post(url: string, body: unknown) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 429 ? 'Too many attempts. Wait a minute and try again.' : json.message ?? 'Something went wrong');
    return json;
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await post('/api/session', { email, password });
      if (r.mfa_required) {
        if (r.mfa_enrolled) setStage({ kind: 'mfa', factorId: r.mfa_factor_id });
        else { const q = await post('/api/session/mfa', { action: 'enroll' }); setStage({ kind: 'mfa', factorId: q.factor_id, qr: q.qr_svg, secret: q.secret }); }
      } else router.replace(safeNext);
    } catch (err: any) { setError(err.message); }
    setBusy(false);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault(); if (stage.kind !== 'mfa') return;
    setBusy(true); setError('');
    try { await post('/api/session/mfa', { action: 'verify', factor_id: stage.factorId, code }); router.replace(safeNext); }
    catch (err: any) { setError(err.message); setCode(''); }
    setBusy(false);
  }

  return (
    <div className="login">
      <aside className="login-hero">
        <svg className="hero-art" viewBox="0 0 760 760" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
          <circle cx="480" cy="480" r="110" /><circle cx="480" cy="480" r="190" /><circle cx="480" cy="480" r="270" /><circle cx="480" cy="480" r="350" /><circle cx="480" cy="480" r="430" />
          <path d="M30 640 C 220 380, 430 330, 720 110" /><path d="M30 700 C 240 470, 450 420, 740 190" opacity="0.5" />
          <circle cx="720" cy="110" r="4" fill="currentColor" stroke="none" />
        </svg>
        <div className="hero-center">
          <Logo height={132} />
          <div className="hero-foot">ICAO-aligned · Africa-focused · Future-ready</div>
        </div>
      </aside>
      <main className="login-panel">
        <div className="login-form">
          <div className="login-top">
            <div className="mobile-logo"><Logo adaptive height={54} /></div>
            <span style={{ marginLeft: 'auto' }}><ThemeToggleLight /></span>
          </div>
          <div className="login-card">
            {stage.kind === 'password' ? (
              <form onSubmit={signIn} className="stack" noValidate>
                <div>
                  <h2>Welcome <span className="accent">back</span></h2>
                  <p className="lead">Sign in with the email address HAAB registered for you.{canRegister ? '' : ' Accounts are created by an administrator.'}</p>
                </div>
                {params.get('step') === 'mfa' && <div className="alert info">A second step is needed for your account. Sign in again to continue.</div>}
                <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></div>
                <div className="field">
                  <label htmlFor="password">Password</label>
                  <div className="pw-wrap">
                    <input id="password" type={showPw ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                    <button type="button" className="pw-toggle" onClick={() => setShowPw((v) => !v)} aria-pressed={showPw} aria-label={showPw ? 'Hide password' : 'Show password'}>{showPw ? 'Hide' : 'Show'}</button>
                  </div>
                </div>
                {error && <div className="alert danger" role="alert">{error}</div>}
                <button className="btn" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
                {forgot ? (
                  <div className="stack tight" style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                    {forgotDone ? <div className="alert ok" role="status">If that address is registered, a link to set a new password is on its way. It can take a few minutes.</div> : <>
                      <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>Enter your email address above and we will send a link to choose a new password.</p>
                      <button type="button" className="btn outline" disabled={busy || !email} onClick={async () => { setBusy(true); try { await post('/api/auth/forgot', { email }); } catch { /* the answer is the same either way */ } setForgotDone(true); setBusy(false); }}>Send me a link</button></>}
                  </div>
                ) : (
                  <div className="login-links">
                    <button type="button" onClick={() => setForgot(true)}>Forgotten your password?</button>
                    {canRegister && <Link href="/register">Request an account</Link>}
                  </div>
                )}
              </form>
            ) : (
              <form onSubmit={verify} className="stack" noValidate>
                <div><h2>Confirm it&apos;s <span className="accent">you</span></h2>
                  <p className="lead">{stage.qr ? 'Scan this code with an authenticator app, then enter the six digits it shows.' : 'Enter the six-digit code from your authenticator app.'}</p></div>
                {stage.qr && (
                  <div className="stack tight" style={{ alignItems: 'center' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={stage.qr.startsWith('data:') ? stage.qr : `data:image/svg+xml;utf8,${encodeURIComponent(stage.qr)}`} alt="QR code for your authenticator app" width={176} height={176} style={{ background: '#fff', padding: 8 }} />
                    {stage.secret && <span className="muted" style={{ fontSize: 12.5 }}>Or type this key: <code style={{ userSelect: 'all' }}>{stage.secret}</code></span>}
                  </div>
                )}
                <div className="field"><label htmlFor="code">Six-digit code</label><input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus style={{ letterSpacing: '0.5em', fontSize: 22, textAlign: 'center' }} /></div>
                {error && <div className="alert danger" role="alert">{error}</div>}
                <button className="btn" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify and continue'}</button>
              </form>
            )}
          </div>
          <p className="login-note">For authorised users only. Sign-ins and activity are recorded.</p>
        </div>
      </main>
    </div>
  );
}

// the toggle sits on the paper panel here, so it needs ink-coloured icons
function ThemeToggleLight() { return <span style={{ color: 'var(--text)' }}><span style={{ ['--chrome-text' as any]: 'var(--text)', ['--chrome-line' as any]: 'var(--border)' }}><ThemeToggle /></span></span>; }

export default function LoginPage() { return <Suspense><LoginForm /></Suspense>; }
