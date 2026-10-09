'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import jsQR from 'jsqr';
import { api, ApiError } from '@/lib/api';
import { Badge, Card, PageHead } from '@/components/ui';

type Outcome = { kind: 'ok'; status: string; already: boolean } | { kind: 'error'; message: string };

/** Pulls the code out of whatever was scanned: a check-in link, or the bare code. */
function tokenFrom(text: string) {
  try { const u = new URL(text); return u.searchParams.get('t') ?? text; } catch { return text.trim(); }
}

function Inner() {
  const params = useSearchParams();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState('');
  const [camError, setCamError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef(0);

  const submit = useCallback(async (token: string) => {
    setBusy(true); setOutcome(null);
    try {
      // Location is optional and never holds up a check-in: it is used only if the person already allowed it,
      // and we never wait more than two seconds for it. (A pending permission prompt would otherwise block forever.)
      const pos = await Promise.race<GeolocationPosition | null>([
        (async () => {
          try {
            if (!navigator.geolocation || !navigator.permissions) return null;
            if ((await navigator.permissions.query({ name: 'geolocation' as PermissionName })).state !== 'granted') return null;
            return await new Promise<GeolocationPosition | null>((res) => navigator.geolocation.getCurrentPosition(res, () => res(null), { timeout: 1800, maximumAge: 60000 }));
          } catch { return null; }
        })(),
        new Promise<null>((res) => setTimeout(() => res(null), 2000)),
      ]);
      const r = await api.post<{ status: string; already: boolean }>('/attendance/qr-checkin', { token, ...(pos ? { latitude: +pos.coords.latitude.toFixed(6), longitude: +pos.coords.longitude.toFixed(6) } : {}) });
      setOutcome({ kind: 'ok', ...r });
    } catch (e) { setOutcome({ kind: 'error', message: (e as ApiError).message }); }
    setBusy(false);
  }, []);

  const stop = useCallback(() => { cancelAnimationFrame(raf.current); stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setScanning(false); }, []);
  useEffect(() => { const t = params.get('t'); if (t) submit(t); return stop; }, [params, submit, stop]);

  async function start() {
    setCamError(''); setOutcome(null);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      setScanning(true);
      await new Promise((r) => setTimeout(r, 50));
      const v = video.current!; v.srcObject = stream.current; await v.play();
      const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      let last = 0;
      const tick = (now: number) => {
        if (!stream.current) return;
        if (now - last > 180 && v.videoWidth) {
          last = now; canvas.width = v.videoWidth; canvas.height = v.videoHeight; ctx.drawImage(v, 0, 0);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (code?.data) { stop(); submit(tokenFrom(code.data)); return; }
        }
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    } catch { setCamError('The camera could not be opened. Allow camera access, or type the code below.'); stop(); }
  }

  return (
    <>
      <PageHead title="Check in" accent="to class" subtitle="Scan the code your instructor shows on screen. You must be confirmed on the programme and the session must be open (from 15 minutes before it starts)." />
      <div className="grid c2" style={{ alignItems: 'start' }}>
        <Card title="Scan the code">
          <div className="stack">
            {scanning ? <><video ref={video} muted playsInline style={{ width: '100%', background: '#000', maxHeight: 360, objectFit: 'cover' }} aria-label="Camera view" /><button className="btn outline" onClick={stop}>Stop camera</button></> : <button className="btn" onClick={start} disabled={busy}>Open camera</button>}
            {camError && <div className="alert warn">{camError}</div>}
            <form className="stack tight" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) submit(tokenFrom(manual)); }}>
              <div className="field"><label htmlFor="manual">Or paste the code or link</label><input id="manual" type="text" value={manual} onChange={(e) => setManual(e.target.value)} autoComplete="off" /></div>
              <div><button className="btn outline" disabled={busy || !manual.trim()}>Check in</button></div>
            </form>
          </div>
        </Card>
        <Card title="Result">
          {busy && <div className="muted">Checking you in…</div>}
          {!busy && !outcome && <div className="muted">Your check-in will show here.</div>}
          {outcome?.kind === 'ok' && <div className="alert ok" role="status"><b>{outcome.already ? 'You were already checked in.' : 'You are checked in.'}</b><div style={{ marginTop: 6 }}>Recorded as <Badge value={outcome.status} />{outcome.status === 'late' && ' (more than 15 minutes after the start)'}.</div></div>}
          {outcome?.kind === 'error' && <div className="alert danger" role="alert"><b>Not checked in.</b><div style={{ marginTop: 6 }}>{outcome.message}</div></div>}
        </Card>
      </div>
    </>
  );
}
export default function CheckinPage() { return <Suspense><Inner /></Suspense>; }
