'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApi } from '@/lib/api';
import { PageHead } from '@/components/ui';
import { settingsHref as hrefOf } from '@/lib/settings-links';

interface PageItem { key: string; title: string; description: string; kind: 'form' | 'roles' | 'link' | 'integrations'; status: 'active' | 'planned'; can_edit: boolean }

/** The "System Setting" group: one page per concern, listed down the left like the reference menu. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { data } = useApi<PageItem[]>('/settings/pages');
  const path = usePathname();
  return (
    <>
      <PageHead title="System" accent="setting" subtitle="Organisation details, rules and connections. Each page saves on its own and every change is recorded in the audit log." />
      <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', gap: 20, alignItems: 'start' }} className="settings-grid">
        <nav className="card" aria-label="Settings pages" style={{ position: 'sticky', top: 76 }}>
          {data?.map((p) => {
            const href = hrefOf(p.key);
            const active = path === href;
            return (
              <Link key={p.key} href={href} aria-current={active ? 'page' : undefined}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 16px', borderLeft: `3px solid ${active ? 'var(--accent)' : 'transparent'}`, background: active ? 'var(--accent-wash)' : 'transparent', color: active ? 'var(--text)' : 'var(--text)', borderBottom: '1px solid var(--border)', textDecoration: 'none' }}>
                <span>{p.title}</span>{p.status === 'planned' && <span className="badge neutral" style={{ fontSize: 10 }}>Planned</span>}
              </Link>
            );
          })}
        </nav>
        <div style={{ minWidth: 0 }}>{children}</div>
      </div>
      <style>{`@media (max-width: 900px) { .settings-grid { grid-template-columns: 1fr !important; } .settings-grid nav { position: static !important; } }`}</style>
    </>
  );
}
