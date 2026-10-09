'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api, useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Column, DataList } from '@/components/datalist';
import { FormModal } from '@/components/form';
import { useToast } from '@/components/toast';
import { Badge, Card, ConfirmModal, PageHead, Tabs, Tile } from '@/components/ui';
import { date, label } from '@/lib/format';
import { useCourseOptions, useOrgOptions } from '@/lib/options';

export default function CompliancePage() {
  const { can, is } = useAuth();
  const toast = useToast();
  const seesOrg = is('super_admin', 'training_admin', 'auditor');
  const orgs = useOrgOptions(seesOrg); const courses = useCourseOptions();
  const [tab, setTab] = useState('gaps');
  const [org, setOrg] = useState('');
  const overview = useApi<any>(`/compliance/overview${org ? `?organization_id=${org}` : ''}`);
  const reqs = useApi<any[]>(tab === 'req' ? '/compliance/requirements' : null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<any | null>(null);
  const o = overview.data;
  const gaps: Column<any>[] = [
    { key: 'full_name', label: 'Trainee', render: (g) => <b style={{ fontWeight: 600 }}>{g.full_name}</b>, href: (g) => (can('users:read') ? `/people/${g.trainee_id}` : undefined) }, ...(seesOrg ? [{ key: 'organization_name', label: 'Organisation', render: (g: any) => g.organization_name ?? <span className="muted">Individual</span> }] : []),
    { key: 'course_code', label: 'Required course', render: (g) => `${g.course_code} · ${g.course_title}` }, { key: 'issue', label: 'Issue', render: (g) => <Badge value={g.issue} /> },
    { key: 'certificate_number', label: 'Certificate', render: (g) => <span className="mono">{g.certificate_number ?? ''}</span> }, { key: 'expires_at', label: 'Expires', render: (g) => (g.expires_at ? date(g.expires_at) : '') },
  ];
  return (
    <>
      <PageHead title="Compliance" subtitle="Who is missing required training, whose certificate is about to lapse, and who has lapsed. A requirement says which people must hold a valid certificate for which course." />
      {seesOrg && <div style={{ marginBottom: 16 }}><select aria-label="Organisation" value={org} onChange={(e) => setOrg(e.target.value)} style={{ width: 'auto', minWidth: 240 }}><option value="">All organisations</option>{orgs.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></div>}
      {o && <div className="grid c4" style={{ marginBottom: 20 }}><Tile name="Missing training" value={o.missing} tone={o.missing ? 'danger' : 'ok'} /><Tile name="Expired" value={o.expired} tone={o.expired ? 'danger' : 'ok'} /><Tile name="Expiring soon" value={o.expiring_soon} tone={o.expiring_soon ? 'warn' : 'ok'} /><Tile name="In grace period" value={o.in_grace} tone={o.in_grace ? 'warn' : 'ok'} />
        <Tile name="Failed assessments" value={o.failed_assessments} /><Tile name="Attendance below minimum" value={o.attendance_deficiencies} /></div>}
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'gaps', label: 'Gaps' }, ...(can('compliance:read') ? [{ key: 'req', label: 'Requirements' }] : [])]} />
      {tab === 'gaps' && <DataList path="/compliance/gaps" columns={gaps} extra={{ organization_id: org || undefined }} search={false} filters={[{ name: 'issue', label: 'Issue', options: ['missing', 'expired', 'in_grace', 'expiring_soon'].map((v) => ({ value: v, label: label(v) })) }]} empty={{ title: 'No gaps found', hint: 'Everyone covered by a requirement holds a valid certificate. If no requirements exist yet, add some.' }} />}
      {tab === 'req' && (
        <div className="stack">
          {can('compliance:write') && <div><button className="btn" onClick={() => setAdding(true)}>Add requirement</button></div>}
          <Card flush>{!reqs.data ? <div className="empty muted">Loading…</div> : reqs.data.length === 0 ? <div className="empty muted">No requirements yet.</div> : (
            <table className="table"><thead><tr><th>Course</th><th>Applies to</th><th>Role</th><th className="num">Grace (days)</th><th /></tr></thead><tbody>{reqs.data.map((r) => <tr key={r.id}><td>{r.course_code} · {r.course_title}</td><td>{r.organization_name ?? 'Everyone'}</td><td>{r.aviation_role ?? 'Any'}</td><td className="num">{r.grace_days}</td><td className="actions">{can('compliance:write') && <button className="btn ghost sm" onClick={() => setRemoving(r)}>Remove</button>}</td></tr>)}</tbody></table>)}</Card>
          <p className="muted" style={{ fontSize: 13.5 }}>Role matches the aviation role on the trainee profile. A grace period keeps someone compliant for that many days after their certificate expires.</p>
        </div>
      )}
      {adding && <FormModal title="Add requirement" size="narrow" fields={[{ name: 'course_id', label: 'Course that must be held', type: 'select', required: true, options: courses, full: true }, { name: 'organization_id', label: 'Applies to', type: 'select', options: orgs, help: 'Leave empty for every trainee', full: true }, { name: 'aviation_role', label: 'Only for this aviation role', help: 'Optional, for example Ramp agent' }, { name: 'grace_days', label: 'Grace period (days)', type: 'number', min: 0 }]} initial={{ grace_days: 0 }} onClose={() => setAdding(false)} onSubmit={async (v) => { await api.post('/compliance/requirements', v); toast('Requirement added'); reqs.reload(); overview.reload(); }} />}
      {removing && <ConfirmModal title="Remove this requirement?" message="People will no longer be flagged for this course." danger confirmLabel="Remove" onClose={() => setRemoving(null)} onConfirm={async () => { await api.del(`/compliance/requirements/${removing.id}`); toast('Removed'); reqs.reload(); overview.reload(); }} />}
    </>
  );
}
