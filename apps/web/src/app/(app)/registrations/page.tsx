'use client';
import { useState } from 'react';
import { api, ApiError, useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { FormModal } from '@/components/form';
import { Badge, Card, ConfirmModal, Empty, ErrorNote, Loading, PageHead, Tabs } from '@/components/ui';
import { useToast } from '@/components/toast';
import { date } from '@/lib/format';
import { useOrgOptions } from '@/lib/options';

export default function RegistrationsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const orgs = useOrgOptions();
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const { data, error, reload } = useApi<{ data: any[] }>(`/registrations?status=${tab}`);
  const [approve, setApprove] = useState<any | null>(null);
  const [reject, setReject] = useState<any | null>(null);
  const rows = data?.data;
  return (
    <>
      <PageHead title="Registration" accent="requests" subtitle="Trainees who asked for an account from the sign-in page. Approving sends them an invitation email." />
      <Card>
        <Tabs value={tab} onChange={(t) => setTab(t as typeof tab)} tabs={[{ key: 'pending', label: 'Waiting' }, { key: 'approved', label: 'Approved' }, { key: 'rejected', label: 'Rejected' }]} />
        {error ? <ErrorNote error={error} /> : !rows ? <Loading /> : rows.length === 0 ? <Empty title={tab === 'pending' ? 'No requests are waiting' : 'Nothing here'} /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Name</th><th>Email</th><th>Employer / organisation</th><th>Asked</th>{tab !== 'pending' && <th>Decision</th>}<th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td><b style={{ fontWeight: 600 }}>{r.full_name}</b>{r.phone && <div className="muted" style={{ fontSize: 12.5 }}>{r.phone}</div>}</td>
                <td>{r.email}</td><td>{r.organisation_text || <span className="muted">Not given</span>}</td><td>{date(r.created_at)}</td>
                {tab !== 'pending' && <td><Badge value={r.status} />{r.decided_by_name && <div className="muted" style={{ fontSize: 12.5 }}>{r.decided_by_name}, {date(r.decided_at)}</div>}{r.reject_reason && <div className="muted" style={{ fontSize: 12.5 }}>{r.reject_reason}</div>}</td>}
                <td style={{ textAlign: 'right' }}>{tab === 'pending' && can('users:write') && <span className="row" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn sm" onClick={() => setApprove(r)}>Approve</button><button className="btn outline sm" onClick={() => setReject(r)}>Reject</button></span>}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
      {approve && <FormModal title={`Approve ${approve.full_name}`} size="narrow" submitLabel="Approve and send invitation" onClose={() => setApprove(null)}
        fields={[{ name: 'organization_id', label: 'Client organisation', type: 'select', options: orgs, help: `They wrote: ${approve.organisation_text || 'nothing'}. Leave empty for an individual with no client.` }]}
        onSubmit={async (v) => { try { await api.post(`/registrations/${approve.id}/approve`, { organization_id: v.organization_id || null }); toast('Approved. The invitation has been sent.'); reload(); } catch (e) { throw e as ApiError; } }} />}
      {reject && <ConfirmModal title={`Reject ${reject.full_name}`} danger confirmLabel="Reject request" askReason="Reason" minReason={3}
        message="No email is sent. The reason is kept in the audit log." onClose={() => setReject(null)}
        onConfirm={async (reason) => { await api.post(`/registrations/${reject.id}/reject`, { reason }); toast('Request rejected'); reload(); }} />}
    </>
  );
}
