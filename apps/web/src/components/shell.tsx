'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, useApi } from '@/lib/api';
import { AuthProvider, ROLE_LABEL, useAuth } from '@/lib/auth';
import { dateTime, initials } from '@/lib/format';
import { navFor, TABS } from '@/lib/nav';
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
  const groups = navFor(me.role).filter((g) => !(g.label === 'Finance' && !me.show_finance));
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
  const [sheet, setSheet] = useState(false); // phones: the search box opens full width over the top bar
  const { data } = useApi<{ groups: { type: string; label: string; items: { id: string; title: string; subtitle?: string }[] }[] }>(dq.trim().length >= 2 ? `/search?q=${encodeURIComponent(dq.trim())}` : null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <>
    <button className="icon-btn search-toggle" aria-label="Search" onClick={() => setSheet(true)}><Icon name="search" /></button>
    <div className={`search ${sheet ? 'sheet' : ''}`} ref={box}>
      <Icon name="search" />
      <input type="search" placeholder="Search trainees, courses, certificates" aria-label="Global search" autoFocus={sheet} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
      {sheet && <button className="icon-btn search-close" aria-label="Close search" onClick={() => { setSheet(false); setOpen(false); setQ(''); }}><Icon name="x" /></button>}
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
    </>
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
          <Link href="/profile" className="item" onClick={() => setOpen(false)}>{me.role === 'trainee' ? 'My profile' : 'My account'}</Link>
          <button className="item" onClick={signOut}>Sign out</button>
        </div>
      )}
    </div>
  );
}

/** Phones: the four things this role does most, one thumb-tap away. "More" opens the full menu. */
function BottomBar({ menuOpen, onMore }: { menuOpen: boolean; onMore: () => void }) {
  const { me } = useAuth();
  const path = usePathname();
  const tabs = TABS[me.role];
  const onTab = tabs.some((t) => isActive(path, t.href));
  return (
    <nav className="tabbar" aria-label="Quick navigation">
      {tabs.map((t) => {
        const on = isActive(path, t.href) && !menuOpen;
        return <Link key={t.href} href={t.href} className={`tab ${on ? 'on' : ''}`} aria-current={on ? 'page' : undefined}><Icon name={t.icon} /><span>{t.label}</span></Link>;
      })}
      <button className={`tab ${menuOpen || !onTab ? 'on' : ''}`} onClick={onMore} aria-expanded={menuOpen}><Icon name="menu" /><span>More</span></button>
    </nav>
  );
}

/** Gives every table cell its column title, so on phones each row can be shown as a card ("Status: Active"). */
function useCellLabels(path: string) {
  useEffect(() => {
    const label = () => {
      document.querySelectorAll<HTMLTableElement>('table.table').forEach((t) => {
        const heads = [...t.querySelectorAll('thead th')].map((h) => h.textContent?.trim() ?? '');
        t.querySelectorAll('tbody tr').forEach((r) => [...r.children].forEach((c, i) => { if (c instanceof HTMLElement && c.tagName === 'TD' && !c.dataset.label && heads[i]) c.dataset.label = heads[i]; }));
      });
    };
    label();
    const root = document.getElementById('content');
    if (!root) return;
    let raf = 0;
    const obs = new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(label); });
    obs.observe(root, { childList: true, subtree: true });
    return () => { obs.disconnect(); cancelAnimationFrame(raf); };
  }, [path]);
}

function Frame({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useCellLabels(path);
  return (
    <div className="shell">
      <Sidebar open={open} onNavigate={() => setOpen(false)} />
      {open && <button className="drawer-scrim" aria-label="Close menu" onClick={() => setOpen(false)} />}
      <div className="main">
        <header className="topbar">
          <Link href="/" className="topbar-logo" aria-label="Home"><Logo height={30} /></Link>
          <GlobalSearch />
          <div className="grow" />
          <ThemeToggle /><Bell /><Account />
        </header>
        <main className="content" id="content">{children}</main>
      </div>
      <BottomBar menuOpen={open} onMore={() => setOpen((o) => !o)} />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return <AuthProvider><Frame>{children}</Frame></AuthProvider>;
}
