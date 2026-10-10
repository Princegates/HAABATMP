'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, useApi } from '@/lib/api';
import { ROLE_LABEL, Role, useAuth } from '@/lib/auth';
import { Card, ErrorNote, Loading } from '@/components/ui';
import { useToast } from '@/components/toast';
import { groupKey, MenuChoice, NAV, visibleNav } from '@/lib/nav';

const ROLES: Role[] = ['training_admin', 'instructor', 'trainee', 'org_admin', 'finance_officer', 'auditor'];
type Overrides = Record<string, MenuChoice>;
interface Row { key: string; label: string; indent: boolean; perm?: string; defaultRoles: Role[] }

/** One row per menu entry: groups and the pages inside them, with the roles that have each by default. */
function buildRows(): Row[] {
  const rows = new Map<string, Row>();
  const put = (r: Row) => {
    const ex = rows.get(r.key);
    if (ex) { ex.defaultRoles = [...new Set([...ex.defaultRoles, ...r.defaultRoles])]; ex.perm ??= r.perm; } else rows.set(r.key, r);
  };
  for (const g of NAV) {
    if (g.label === 'Dashboard') continue; // the home page is always there
    put({ key: groupKey(g), label: g.label, indent: false, perm: g.perm, defaultRoles: g.roles });
    for (const i of g.items ?? []) put({ key: i.href, label: i.label, indent: true, perm: i.perm, defaultRoles: i.roles ? i.roles.filter((r) => g.roles.includes(r)) : g.roles });
  }
  return [...rows.values()];
}

export default function MenuAccessPage() {
  const { is } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useApi<{ overrides: Overrides; permissions: Record<string, string[]> }>(is('super_admin') ? '/settings/menu' : null);
  const [ov, setOv] = useState<Overrides>({});
  const [busy, setBusy] = useState(false);
  const rows = useMemo(buildRows, []);
  useEffect(() => { if (data) setOv(data.overrides ?? {}); }, [data]);
  if (!is('super_admin')) return <Card title="Menu Access"><div className="empty muted">Only the Super Administrator can change who sees which menu items.</div></Card>;
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;

  const choice = (role: string): MenuChoice => ov[role] ?? { hide: [], show: [] };
  const visibleKeys = (role: Role) => {
    const keys = new Set<string>();
    for (const g of visibleNav(role, choice(role), data.permissions[role] ?? [])) { keys.add(groupKey(g)); g.items?.forEach((i) => keys.add(i.href)); if (g.href) keys.add(g.href); }
    return keys;
  };
  const visible = Object.fromEntries(ROLES.map((r) => [r, visibleKeys(r)])) as Record<Role, Set<string>>;
  const capable = (row: Row, role: Role) => row.defaultRoles.includes(role) || (!!row.perm && (data.permissions[role] ?? []).includes(row.perm));

  const toggle = (row: Row, role: Role) => {
    const c = choice(role);
    const on = visible[role].has(row.key);
    const isDefault = row.defaultRoles.includes(role);
    const hide = new Set(c.hide), show = new Set(c.show);
    if (on) { hide.add(row.key); show.delete(row.key); if (!isDefault) hide.delete(row.key); }
    else { hide.delete(row.key); if (!isDefault) show.add(row.key); }
    // a group that was added needs its pages to be shown too, so adding a group adds every page the role may use in it
    if (!on && !isDefault && !row.indent) {
      for (const g of NAV.filter((x) => groupKey(x) === row.key)) for (const i of g.items ?? []) if ((data.permissions[role] ?? []).includes(i.perm ?? '')) show.add(i.href);
    }
    setOv({ ...ov, [role]: { hide: [...hide], show: [...show] } });
  };

  const save = async () => {
    setBusy(true);
    try { await api.put('/settings/menu', { overrides: Object.fromEntries(Object.entries(ov).filter(([, v]) => v.hide.length || v.show.length)) }); toast('Menu saved. People see it the next time they open or refresh the platform.'); reload(); }
    catch (e) { toast((e as ApiError).message, 'error'); }
    setBusy(false);
  };

  return (
    <Card title="Menu Access" actions={<><button className="btn outline sm" onClick={() => setOv({})}>Reset to defaults</button> <button className="btn sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>} flush>
      <div style={{ padding: '14px 20px' }}>
        <p className="muted" style={{ margin: 0 }}>
          Tick the pages each role sees in its menu. Untick to remove one, tick to add one. A hidden page also shows a "not available" message if someone opens its address.
          Greyed boxes are pages that role is not permitted to use at all: what each role may <b>do</b> is fixed under Roles &amp; Permissions and checked by the server on every request, so this screen can narrow or arrange what people are shown, but never grants more.
          The home page, My profile and the Super Administrator&apos;s own menu cannot be changed.
        </p>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>Menu item</th>{ROLES.map((r) => <th key={r} style={{ textAlign: 'center' }}>{ROLE_LABEL[r]}</th>)}</tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td style={{ paddingLeft: row.indent ? 36 : undefined, fontWeight: row.indent ? 400 : 600 }}>{row.label}</td>
                {ROLES.map((role) => {
                  const can = capable(row, role);
                  return (
                    <td key={role} style={{ textAlign: 'center' }}>
                      <input type="checkbox" aria-label={`${row.label} for ${ROLE_LABEL[role]}`} disabled={!can} checked={can && visible[role].has(row.key)} onChange={() => toggle(row, role)} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
