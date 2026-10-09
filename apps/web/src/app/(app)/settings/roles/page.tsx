'use client';
import { useApi } from '@/lib/api';
import { Card, ErrorNote, Loading } from '@/components/ui';
import { ROLE_LABEL, Role } from '@/lib/auth';

export default function RolesPage() {
  const { data, error } = useApi<{ roles: Role[]; matrix: { permission: string; roles: Role[] }[] }>('/settings/roles');
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const groups = [...new Set(data.matrix.map((m) => m.permission.split(':')[0]))];
  return (
    <Card title="Roles Permissions" flush>
      <div style={{ padding: '16px 20px' }}><p className="muted">Who can do what. These rules are built into the platform and reviewed as part of its security, so they are shown here but not editable. Finance cannot touch training records, training staff cannot record payments, auditors can only read, and instructors can mark but not finalise results.</p></div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Permission</th>{data.roles.map((r) => <th key={r} style={{ textAlign: 'center', whiteSpace: 'normal', minWidth: 90 }}>{ROLE_LABEL[r]}</th>)}</tr></thead>
        <tbody>
          {groups.map((g) => (
            <>
              <tr key={`h-${g}`}><td colSpan={data.roles.length + 1} className="label" style={{ background: 'var(--surface-2)' }}>{g}</td></tr>
              {data.matrix.filter((m) => m.permission.startsWith(`${g}:`)).map((m) => (
                <tr key={m.permission}><td>{m.permission.split(':')[1].replace('_', ' ')}</td>
                  {data.roles.map((r) => <td key={r} style={{ textAlign: 'center' }} aria-label={m.roles.includes(r) ? 'allowed' : 'not allowed'}>{m.roles.includes(r) ? <span style={{ color: 'var(--ok)', fontWeight: 700 }}>●</span> : <span className="muted">·</span>}</td>)}</tr>
              ))}
            </>
          ))}
        </tbody>
      </table></div>
    </Card>
  );
}
