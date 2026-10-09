'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Column, DataList } from '@/components/datalist';
import { Badge, ErrorNote, KV, Loading, PageHead, Tabs, Tile } from '@/components/ui';
import { date, label, money } from '@/lib/format';

export default function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can, is } = useAuth();
  const org = useApi<any>(`/organizations/${id}`);
  const sum = useApi<any>(`/organizations/${id}/summary`);
  const [tab, setTab] = useState('trainees');
  if (org.error) return <ErrorNote error={org.error} />;
  if (!org.data) return <Loading />;
  const o = org.data; const s = sum.data;
  const trainees: Column<any>[] = [{ key: 'full_name', label: 'Name', render: (u) => <b style={{ fontWeight: 600 }}>{u.full_name}</b>, href: (u) => `/people/${u.id}` }, { key: 'email', label: 'Email' }, { key: 'status', label: 'Status', render: (u) => <Badge value={u.status} /> }, { key: 'last_login_at', label: 'Last sign-in', render: (u) => (u.last_login_at ? date(u.last_login_at) : 'Never') }];
  const regs: Column<any>[] = [{ key: 'trainee_name', label: 'Trainee' }, { key: 'programme_code', label: 'Programme', href: (e) => `/programmes/${e.programme_id}` }, { key: 'programme_title', label: 'Title' }, { key: 'start_date', label: 'Starts', render: (e) => date(e.start_date) }, { key: 'status', label: 'Status', render: (e) => <Badge value={e.status} /> }];
  const certs: Column<any>[] = [{ key: 'number', label: 'Certificate', render: (c) => <span className="mono">{c.number}</span>, href: (c) => `/certificates/${c.id}` }, { key: 'trainee_name', label: 'Holder' }, { key: 'course_title', label: 'Course' }, { key: 'expires_at', label: 'Expires', render: (c) => (c.expires_at ? date(c.expires_at) : 'No expiry') }, { key: 'status', label: 'Status', render: (c) => <Badge value={c.status} /> }];
  const inv: Column<any>[] = [{ key: 'number', label: 'Invoice', href: (i) => `/invoices/${i.id}` }, { key: 'issue_date', label: 'Issued', render: (i) => date(i.issue_date) }, { key: 'total', label: 'Total', num: true, render: (i) => money(i.total, i.currency) }, { key: 'balance', label: 'Balance', num: true, render: (i) => money(i.balance, i.currency) }, { key: 'status', label: 'Status', render: (i) => <Badge value={i.status} /> }];
  return (
    <>
      <PageHead title={o.name} crumbs={[{ label: 'Clients', href: '/clients' }, { label: o.name }]} subtitle={<>{label(o.type)} · <Badge value={o.status} /></>}
        actions={can('users:write') && <Link href={`/trainees?org=${id}`} className="btn outline">Open in trainees</Link>} />
      <div className="stack" style={{ gap: 20 }}>
        {s && <div className="grid c4"><Tile name="Trainees" value={s.trainees} /><Tile name="In training now" value={s.active_enrollments} /><Tile name="Valid certificates" value={s.valid_certificates} /><Tile name="Expiring in 60 days" value={s.expiring_60_days} tone={s.expiring_60_days ? 'warn' : 'ok'} /></div>}
        <div className="card card-body"><KV items={[['Contact', o.contact_name], ['Email', o.contact_email], ['Phone', o.contact_phone], ['Billing email', o.billing_email], ['Address', o.address], ['Outstanding', s ? money(s.outstanding_balance) : null]]} /></div>
        <div>
          <Tabs value={tab} onChange={setTab} tabs={[{ key: 'trainees', label: 'Trainees' }, { key: 'regs', label: 'Registrations' }, { key: 'certs', label: 'Certificates' }, ...(can('invoices:read') ? [{ key: 'inv', label: 'Invoices' }] : [])]} />
          {tab === 'trainees' && <DataList path="/users" extra={{ role: 'trainee', organization_id: id }} columns={trainees} empty={{ title: 'No trainees yet' }} />}
          {tab === 'regs' && <DataList path="/enrollments" extra={{ organization_id: id }} columns={regs} search={false} empty={{ title: 'No registrations yet' }} />}
          {tab === 'certs' && <DataList path="/certificates" extra={{ organization_id: id }} columns={certs} empty={{ title: 'No certificates yet' }} />}
          {tab === 'inv' && <DataList path="/invoices" extra={{ organization_id: id }} columns={inv} empty={{ title: 'No invoices' }} />}
        </div>
      </div>
    </>
  );
}
