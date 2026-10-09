'use client';
import { Suspense, useState } from 'react';
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
      <div className="login-hero">
        <Logo height={64} />
        <div>
          <div className="eyebrow">Training management platform</div>
          <h1>Training records you can <em>stand behind</em></h1>
          <p>Courses, attendance, assessments and certificates for HAAB Aviation Consultancy Services, kept in one controlled place and ready for any audit.</p>
        </div>
        <div className="label" style={{ color: 'var(--brand-fog)' }}>ICAO-aligned · Africa-focused · Future-ready</div>
      </div>
      <div className="login-panel">
        <div className="login-form stack" style={{ gap: 20 }}>
          <div className="row between"><div className="label">{stage.kind === 'mfa' ? 'Second step' : 'Sign in'}</div><ThemeToggleLight /></div>
          {stage.kind === 'password' ? (
            <form onSubmit={signIn} className="stack" noValidate>
              <div><h2>Welcome <span className="accent">back</span></h2><p className="muted">Use the email address HAAB registered for you. Accounts are created by an administrator.</p></div>
              {params.get('step') === 'mfa' && <div className="alert info">Your role needs a second step. Sign in again to continue.</div>}
              <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></div>
              <div className="field"><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
              {error && <div className="alert danger" role="alert">{error}</div>}
              <button className="btn" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
              <p className="muted" style={{ fontSize: 13 }}>Forgotten your password? Ask your administrator to send a reset.</p>
            </form>
          ) : (
            <form onSubmit={verify} className="stack" noValidate>
              <div><h2>Confirm it&apos;s <span className="accent">you</span></h2>
                <p className="muted">{stage.qr ? 'Scan this code with an authenticator app, then enter the six digits it shows.' : 'Enter the six-digit code from your authenticator app.'}</p></div>
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
      </div>
    </div>
  );
}

// the toggle sits on the paper panel here, so it needs ink-coloured icons
function ThemeToggleLight() { return <span style={{ color: 'var(--text)' }}><span style={{ ['--chrome-text' as any]: 'var(--text)', ['--chrome-line' as any]: 'var(--border)' }}><ThemeToggle /></span></span>; }

export default function LoginPage() { return <Suspense><LoginForm /></Suspense>; }
