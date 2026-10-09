'use client';
import { use, useEffect, useState } from 'react';
import { Logo } from '@/components/logo';
import { date, label } from '@/lib/format';

interface V { status: 'valid' | 'expiring_soon' | 'expired' | 'revoked'; holder: string; course: string; course_code: string; certificate_number: string; issued_at: string; expires_at: string | null; issued_by: string }

const COPY: Record<string, { title: string; note: string }> = {
  valid: { title: 'This certificate is valid', note: 'It was issued by the organisation named below and has not been revoked.' },
  expiring_soon: { title: 'This certificate is valid', note: 'It is valid today but will expire soon. Check the date below.' },
  expired: { title: 'This certificate has expired', note: 'It was genuine, but its validity period has ended. The holder needs refresher training.' },
  revoked: { title: 'This certificate has been revoked', note: 'It must not be accepted. Contact the issuing organisation if you have questions.' },
};

export default function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [v, setV] = useState<V | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'none' | 'error'>('loading');
  useEffect(() => {
    fetch(`/api/verify/${encodeURIComponent(token)}`).then(async (r) => {
      if (r.status === 404) return setState('none');
      if (!r.ok) return setState('error');
      setV(await r.json()); setState('ok');
    }).catch(() => setState('error'));
  }, [token]);

  return (
    <div className="verify">
      <div className="stack" style={{ width: 'min(560px, 100%)', alignItems: 'stretch' }}>
        <div style={{ background: 'var(--chrome-bg)', padding: '18px 24px' }}><Logo height={44} /></div>
        <div className="card">
          {state === 'loading' && <div className="empty muted">Checking…</div>}
          {state === 'none' && <div className="card-body"><h2>No certificate found</h2><p className="muted" style={{ marginTop: 8 }}>This code does not match any certificate issued through the platform. If you scanned a printed certificate, it may not be genuine.</p></div>}
          {state === 'error' && <div className="card-body"><h2>Could not check</h2><p className="muted" style={{ marginTop: 8 }}>The verification service is not reachable right now. Please try again shortly.</p></div>}
          {v && (
            <>
              <div className={`verify-status ${v.status}`}>
                <div><h2 style={{ fontSize: 26 }}>{COPY[v.status].title}</h2><p className="muted" style={{ marginTop: 4 }}>{COPY[v.status].note}</p></div>
              </div>
              <div className="card-body stack">
                <dl className="kv">
                  <dt>Holder</dt><dd style={{ fontFamily: 'var(--font-display)', fontSize: 24 }}>{v.holder}</dd>
                  <dt>Course</dt><dd>{v.course} <span className="muted">({v.course_code})</span></dd>
                  <dt>Certificate</dt><dd className="mono">{v.certificate_number}</dd>
                  <dt>Issued</dt><dd>{date(v.issued_at)}</dd>
                  <dt>Valid until</dt><dd>{v.expires_at ? date(v.expires_at) : 'No expiry'}</dd>
                  <dt>Status</dt><dd>{label(v.status)}</dd>
                  <dt>Issued by</dt><dd>{v.issued_by}</dd>
                </dl>
              </div>
            </>
          )}
        </div>
        <p className="muted" style={{ fontSize: 12.5, textAlign: 'center' }}>This page confirms the certificate and nothing else. No contact or personal details are shown.</p>
      </div>
    </div>
  );
}
