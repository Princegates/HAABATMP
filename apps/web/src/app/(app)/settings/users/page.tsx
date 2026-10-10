'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth, ROLE_LABEL, Role } from '@/lib/auth';
import { Column, DataList } from '@/components/datalist';
import { FieldDef, FormModal } from '@/components/form';
import { Badge, Card, ConfirmModal, Tabs } from '@/components/ui';
import { useToast } from '@/components/toast';
import { date } from '@/lib/format';
import { useOrgOptions } from '@/lib/options';
import { DeleteButton } from '@/components/delete';

const CREATABLE: Record<Role, Role[]> = {
  super_admin: ['super_admin', 'training_admin', 'instructor', 'trainee', 'org_admin', 'finance_officer', 'auditor'], training_admin: ['trainee', 'instructor', 'org_admin'],
  org_admin: ['trainee'], instructor: [], trainee: [], finance_officer: [], auditor: [],
};

export default function UsersPage() {
  const { me, can } = useAuth();
  const toast = useToast();
  const orgs = useOrgOptions();
  const [form, setForm] = useState<'new' | any | null>(null);
  const [suspend, setSuspend] = useState<any | null>(null);
  const [tick, setTick] = useState(0);
  const [group, setGroup] = useState<'staff' | 'client'>('staff');
  const roles = CREATABLE[me.role];
  const roleOpts = roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }));
  const fields = (isNew: boolean): FieldDef[] => [
    { name: 'full_name', label: 'Full name', required: true }, { name: 'email', label: 'Email', type: 'email', required: true, disabled: !isNew },
    { name: 'phone', label: 'Phone' }, { name: 'role', label: 'Role', type: 'select', required: true, options: roleOpts, disabled: !isNew && me.role !== 'super_admin' },
    { name: 'organization_id', label: 'Client organisation', type: 'select', options: orgs, help: 'Required for client administrators', hidden: (v) => !['org_admin', 'trainee'].includes(v.role) },
    { name: 'can_finalise_results', label: 'May finalise and release results', type: 'checkbox', full: true, help: 'Lets this instructor make results official and release them, only on programmes they lead or teach. Whoever marked someone\'s work still cannot finalise it while that control is on in Training Rules.', hidden: (v) => isNew || me.role !== 'super_admin' || v.role !== 'instructor' },
  ];
  const columns: Column<any>[] = [
    { key: 'full_name', label: 'Name', render: (u) => <b style={{ fontWeight: 600 }}>{u.full_name}</b>, href: (u) => ['trainee', 'instructor'].includes(u.role) ? `/people/${u.id}` : undefined },
    { key: 'email', label: 'Email' }, { key: 'role', label: 'Role', render: (u) => <>{ROLE_LABEL[u.role as Role]}{u.can_finalise_results && <div className="muted" style={{ fontSize: 12 }}>May finalise results</div>}</> }, { key: 'organization_name', label: 'Belongs to', render: (u) => (u.organization_name ? u.organization_name : ['trainee', 'org_admin'].includes(u.role) ? <span className="muted">Individual</span> : <Badge tone="info">HAAB staff</Badge>) },
    { key: 'status', label: 'Status', render: (u) => <Badge value={u.status} /> }, { key: 'last_login_at', label: 'Last sign-in', render: (u) => (u.last_login_at ? date(u.last_login_at) : 'Never') },
  ];
  return (
    <Card title="Users" actions={can('users:write') && <button className="btn sm" onClick={() => setForm('new')}>New user</button>} flush>
      <div style={{ padding: '14px 20px 0' }}>
        <Tabs value={group} onChange={(g) => setGroup(g as 'staff' | 'client')} tabs={[{ key: 'staff', label: 'HAAB staff' }, { key: 'client', label: 'Client users' }]} />
        <p className="muted" style={{ marginTop: -8, marginBottom: 12 }}>{group === 'staff' ? 'Administrators, instructors, finance and auditors. They work for HAAB and are not attached to any client.' : 'Trainees and client administrators. Each belongs to one client organisation, or is an individual.'}</p>
      </div>
      <DataList path="/users" extra={{ group }} columns={columns} refreshKey={tick} searchPlaceholder="Search name or email"
        filters={[{ name: 'role', label: 'Role', options: (Object.keys(ROLE_LABEL) as Role[]).filter((r) => (group === 'staff') === !['trainee', 'org_admin'].includes(r)).map((r) => ({ value: r, label: ROLE_LABEL[r] })) }, { name: 'status', label: 'Status', options: ['active', 'invited', 'suspended'].map((s) => ({ value: s, label: s })) }]}
        actions={(u) => can('users:write') && (
          <span className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn outline sm" onClick={() => setForm(u)}>Edit</button>
            {u.status !== 'suspended' && <button className="btn ghost sm" onClick={async () => { try { const r = await api.post(`/users/${u.id}/send-reset`); toast(r.note ?? 'Password reset link sent'); } catch (e) { toast((e as ApiError).message, 'error'); } }}>Reset password</button>}
            {u.id !== me.id && u.status !== 'suspended' && <button className="btn ghost sm" title="Use when the person has lost their phone" onClick={async () => { try { await api.post(`/users/${u.id}/reset-mfa`); toast('Two-step sign-in reset'); } catch (e) { toast((e as ApiError).message, 'error'); } }}>Reset two-step</button>}
            {u.id !== me.id && (u.status === 'suspended' ? <button className="btn outline sm" onClick={async () => { await api.post(`/users/${u.id}/reactivate`); toast('Account reactivated'); setTick((t) => t + 1); }}>Reactivate</button> : <button className="btn danger sm" onClick={() => setSuspend(u)}>Suspend</button>)}
            {u.id !== me.id && <DeleteButton path={`/users/${u.id}`} what={u.full_name} goes="Their registrations, attendance and unpaid invoices go with them, and their sign-in is removed." onDone={() => setTick((t) => t + 1)} />}
          </span>
        )} />
      {form && <FormModal title={form === 'new' ? 'New user' : `Edit ${form.full_name}`} fields={fields(form === 'new')} initial={form === 'new' ? {} : form} onClose={() => setForm(null)}
        onSubmit={async (v) => { form === 'new' ? await api.post('/users', v) : await api.patch(`/users/${form.id}`, { full_name: v.full_name, phone: v.phone, organization_id: v.organization_id, ...(me.role === 'super_admin' ? { role: v.role, ...(v.role === 'instructor' ? { can_finalise_results: !!v.can_finalise_results } : {}) } : {}) }); toast(form === 'new' ? 'User created. They will receive an invitation.' : 'Saved'); setTick((t) => t + 1); }} />}
      {suspend && <ConfirmModal title={`Suspend ${suspend.full_name}?`} message="They are signed out of every device straight away and cannot sign in until reactivated." askReason="Reason" danger confirmLabel="Suspend"
        onClose={() => setSuspend(null)} onConfirm={async (reason) => { await api.post(`/users/${suspend.id}/suspend`, { reason }); toast('Account suspended'); setTick((t) => t + 1); }} />}
    </Card>
  );
}
