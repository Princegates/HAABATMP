'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { label, Tone, tone } from '@/lib/format';
import { Icon } from './icons';

export function Badge({ value, tone: t, children }: { value?: string | null; tone?: Tone; children?: React.ReactNode }) {
  return <span className={`badge ${t ?? tone(value)}`}>{children ?? label(value)}</span>;
}

export function PageHead({ title, accent, subtitle, crumbs, actions }: { title: string; accent?: string; subtitle?: React.ReactNode; crumbs?: { label: string; href?: string }[]; actions?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {crumbs && <div className="crumbs">{crumbs.map((c, i) => <span key={i}>{i > 0 && ' / '}{c.href ? <Link href={c.href}>{c.label}</Link> : c.label}</span>)}</div>}
        <h1>{title}{accent && <> <span className="accent">{accent}</span></>}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="row wrap">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, flush }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; flush?: boolean }) {
  return (
    <section className="card">
      {(title || actions) && <div className="card-head"><h3>{title}</h3>{actions && <div className="row">{actions}</div>}</div>}
      <div className={`card-body ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="empty"><h3>{title}</h3>{children && <p>{children}</p>}</div>;
}

export function Loading({ what = 'Loading' }: { what?: string }) { return <div className="empty muted">{what}…</div>; }

export function ErrorNote({ error }: { error?: { message: string } }) {
  return error ? <div className="alert danger" role="alert"><b>Something went wrong.</b> {error.message}</div> : null;
}

export function Tabs({ tabs, value, onChange }: { tabs: { key: string; label: string; count?: number }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={value === t.key ? 'on' : ''} onClick={() => onChange(t.key)}>
          {t.label}{t.count !== undefined && <span className="muted"> {t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, size }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; size?: 'narrow' | 'wide' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button.btn')?.focus();
    return () => { document.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${size ?? ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head"><h2 style={{ fontSize: 24 }}>{title}</h2><button className="icon-btn" style={{ color: 'var(--text)' }} onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmation with an optional reason, for actions that are hard to undo. */
export function ConfirmModal({ title, message, confirmLabel = 'Confirm', danger, askReason, minReason = 5, onConfirm, onClose }: {
  title: string; message?: React.ReactNode; confirmLabel?: string; danger?: boolean; askReason?: string; minReason?: number;
  onConfirm: (reason: string) => Promise<void>; onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const bad = askReason !== undefined && reason.trim().length < minReason;
  return (
    <Modal title={title} size="narrow" onClose={onClose} footer={<>
      <button className="btn outline" onClick={onClose}>Cancel</button>
      <button className={`btn ${danger ? 'danger' : ''}`} disabled={busy || bad} onClick={async () => { setBusy(true); setErr(''); try { await onConfirm(reason.trim()); onClose(); } catch (e: any) { setErr(e.message); setBusy(false); } }}>{confirmLabel}</button>
    </>}>
      <div className="stack">
        {message && <div>{message}</div>}
        {askReason !== undefined && <div className="field"><label htmlFor="why">{askReason || 'Reason'}</label><textarea id="why" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`At least ${minReason} characters. This is kept in the audit log.`} /></div>}
        {err && <div className="alert danger">{err}</div>}
      </div>
    </Modal>
  );
}

export function Tile({ name, value, total, unit, tone: t, hint }: { name: string; value: number; total?: number; unit?: string; tone?: string; hint?: string }) {
  const shown = unit === 'money' ? Number(value).toLocaleString('en-GB', { maximumFractionDigits: 0 }) : Number(value).toLocaleString('en-GB');
  const width = unit === 'percent' ? Math.min(100, value) : total ? Math.min(100, (value / total) * 100) : value > 0 ? 100 : 0;
  return (
    <div className={`tile ${t ?? ''}`}>
      <div className="top"><span className="name">{name}</span><span className="value mono">{shown}{unit === 'percent' && <small>%</small>}{unit === 'hours' && <small> h</small>}{unit === 'money' && <small> GHS</small>}{total !== undefined && unit !== 'percent' && <small> / {total.toLocaleString('en-GB')}</small>}</span></div>
      <div className="bar" aria-hidden="true"><i style={{ width: `${width}%` }} /></div>
      {hint && <span className="muted" style={{ fontSize: 12.5 }}>{hint}</span>}
    </div>
  );
}

export function KV({ items }: { items: [string, React.ReactNode][] }) {
  return <dl className="kv">{items.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
