'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, useApi } from '@/lib/api';
import { AuthProvider, ROLE_LABEL, useAuth } from '@/lib/auth';
import { dateTime, initials } from '@/lib/format';
import { navFor } from '@/lib/nav';
import { Icon } from './icons';
import { Logo } from './logo';
import { useDebounced } from './ui';

const hrefFor: Record<string, (id: string) => string> = {
  trainee: (id) => `/people/${id}`, instructor: (id) => `/people/${id}`, organization: (id) => `/clients/${id}`, course: (id) => `/courses/${id}`,
  programme: (id) => `/programmes/${id}`, certificate: (id) => `/certificates/${id}`, invoice: (id) => `/invoices/${id}`,
};

function isActive(path: string, href: string) {
  const h = href.split('?')[0];
  if (href.includes('?')) return false;
  return h === '/' ? path === '/' : path === h || path.startsWith(`${h}/`);
}

function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { me } = useAuth();
  const path = usePathname();
  const groups = navFor(me.role);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return (
    <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
      <div className="brand"><Link href="/" onClick={onNavigate}><Logo /></Link></div>
      <div className="period">Reporting year <b>{new Date().getUTCFullYear()}</b></div>
      <nav className="nav">
        {groups.map((g, gi) => {
          if (!g.items) return <Link key={g.label + gi} href={g.href!} className={`nav-item ${isActive(path, g.href!) ? 'active' : ''}`} onClick={onNavigate}><Icon name={g.icon} />{g.label}</Link>;
          const hasActive = g.items.some((i) => isActive(path, i.href));
          const isOpen = expanded[g.label] ?? hasActive;
          return (
            <div key={g.label + gi} className={`nav-group ${isOpen ? 'open' : ''}`}>
              <button className={hasActive ? 'has-active' : ''} aria-expanded={isOpen} onClick={() => setExpanded((p) => ({ ...p, [g.label]: !isOpen }))}>
                <Icon name={g.icon} className="ico" />{g.label}<Icon name="chevron" className="chev" />
              </button>
              <div className="nav-sub">{g.items.map((i) => <Link key={i.href} href={i.href} className={`nav-item ${isActive(path, i.href) ? 'active' : ''}`} onClick={onNavigate}>{i.label}</Link>)}</div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [open, setOpen] = useState(false);
  const { data } = useApi<{ groups: { type: string; label: string; items: { id: string; title: string; subtitle?: string }[] }[] }>(dq.trim().length >= 2 ? `/search?q=${encodeURIComponent(dq.trim())}` : null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="search" ref={box}>
      <Icon name="search" />
      <input type="search" placeholder="Search trainees, courses, certificates" aria-label="Global search" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
      {open && dq.trim().length >= 2 && (
        <div className="pop" style={{ left: 0, right: 0, minWidth: 0 }}>
          {!data && <div className="group muted">Searching…</div>}
          {data && data.groups.length === 0 && <div className="group muted" style={{ padding: 14 }}>Nothing found for "{dq}".</div>}
          {data?.groups.map((g) => (
            <div key={g.type}>
              <div className="group label">{g.label}</div>
              {g.items.map((it) => <Link key={it.id} href={hrefFor[g.type]?.(it.id) ?? '/'} className="item" onClick={() => { setOpen(false); setQ(''); }}>{it.title}{it.subtitle && <small>{it.subtitle}</small>}</Link>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Bell() {
  const { data, reload } = useApi<{ items: { id: string; subject: string; body: string; status: string; created_at: string }[]; unread: number }>('/notifications/mine');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setInterval(reload, 60000); return () => clearInterval(t); }, [reload]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button className="icon-btn" aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ''}`} onClick={() => setOpen((o) => !o)}>
        <Icon name="bell" />{!!data?.unread && <span className="dot">{data.unread > 9 ? '9+' : data.unread}</span>}
      </button>
      {open && (
        <div className="pop right" style={{ width: 380 }}>
          <div className="row between group"><span className="label">Notifications</span>{!!data?.unread && <button className="btn ghost sm" onClick={async () => { await api.post('/notifications/read-all'); reload(); }}>Mark all read</button>}</div>
          {data?.items.length === 0 && <div className="muted" style={{ padding: 18 }}>You are up to date.</div>}
          {data?.items.slice(0, 12).map((n) => (
            <button key={n.id} className="item" style={{ opacity: n.status === 'read' ? 0.65 : 1 }} onClick={async () => { if (n.status !== 'read') { await api.post(`/notifications/${n.id}/read`); reload(); } }}>
              <b style={{ fontWeight: 600 }}>{n.subject}</b><small>{n.body.slice(0, 110)}{n.body.length > 110 ? '…' : ''} · {dateTime(n.created_at)}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<'day' | 'night'>('night');
  useEffect(() => {
    const t = document.documentElement.getAttribute('data-theme');
    setTheme(t === 'day' || t === 'night' ? t : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day');
  }, []);
  const flip = useCallback(() => {
    const next = theme === 'night' ? 'day' : 'night';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('haab-theme', next); } catch { /* private mode: the choice just is not remembered */ }
  }, [theme]);
  return <button className="icon-btn" onClick={flip} aria-label={theme === 'night' ? 'Switch to day mode' : 'Switch to night mode'} title={theme === 'night' ? 'Day mode' : 'Night mode'}><Icon name={theme === 'night' ? 'sun' : 'moon'} /></button>;
}

function Account() {
  const { me, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button className="account icon-btn" style={{ width: 'auto', padding: '0 4px' }} onClick={() => setOpen((o) => !o)} aria-label="Account menu" aria-expanded={open}><span className="avatar">{initials(me.full_name)}</span></button>
      {open && (
        <div className="pop right" style={{ minWidth: 260 }}>
          <div className="group"><b style={{ fontWeight: 600 }}>{me.full_name}</b><div className="muted" style={{ fontSize: 13 }}>{me.email}</div><div className="muted" style={{ fontSize: 13 }}>{ROLE_LABEL[me.role]}{me.organization ? ` · ${me.organization.name}` : ''}</div></div>
          {me.role === 'trainee' && <Link href="/profile" className="item" onClick={() => setOpen(false)}>My profile</Link>}
          <button className="item" onClick={signOut}>Sign out</button>
        </div>
      )}
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    <div className="shell">
      <Sidebar open={open} onNavigate={() => setOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" aria-label="Open menu" onClick={() => setOpen((o) => !o)}><Icon name="menu" /></button>
          <GlobalSearch />
          <div className="grow" />
          <ThemeToggle /><Bell /><Account />
        </header>
        <main className="content" id="content">{children}</main>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return <AuthProvider><Frame>{children}</Frame></AuthProvider>;
}
