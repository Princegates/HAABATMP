'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { api, download, useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/toast';
import { Badge, Card, ConfirmModal, ErrorNote, KV, Loading, PageHead } from '@/components/ui';
import { date } from '@/lib/format';

export default function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const toast = useToast();
  const { data: c, error, reload } = useApi<any>(`/certificates/${id}`);
  const [act, setAct] = useState<'revoke' | 'reissue' | null>(null);
  if (error) return <ErrorNote error={error} />;
  if (!c) return <Loading />;
  return (
    <>
      <PageHead title={c.number} crumbs={[{ label: 'Certificates', href: '/certificates' }, { label: c.number }]} subtitle={<><Badge value={c.status} /> · {c.course_title}</>}
        actions={<><button className="btn" onClick={() => download(`/certificates/${id}/pdf`, `${c.number}.pdf`).catch((e) => toast(e.message, 'error'))}>Download PDF</button>
          {can('certificates:revoke') && c.status !== 'revoked' && <><button className="btn outline" onClick={() => setAct('reissue')}>Reissue</button><button className="btn danger" onClick={() => setAct('revoke')}>Revoke</button></>}</>} />
      <div className="grid c2">
        <Card title="Certificate"><KV items={[['Holder', can('users:read') ? <Link key="h" href={`/people/${c.trainee_id}`}>{c.trainee_name}</Link> : c.trainee_name], ['Organisation', c.organization_name ?? 'Individual'], ['Course', `${c.course_code} · ${c.course_title}`], ['Programme', c.programme_code], ['Issued', date(c.issued_at)], ['Valid until', c.expires_at ? date(c.expires_at) : 'No expiry']]} /></Card>
        <Card title="Verification"><p className="muted">The printed certificate carries a QR code. Scanning it opens a public page that shows only the holder, course, dates and whether the certificate is valid, expired or revoked. It does not show contact or personal details.</p>
          {c.status === 'revoked' && <div className="alert danger" style={{ marginTop: 12 }}><b>Revoked{c.revoked_at ? ` on ${date(c.revoked_at)}` : ''}.</b> {c.revoke_reason}</div>}</Card>
      </div>
      {act && <ConfirmModal title={act === 'revoke' ? 'Revoke this certificate?' : 'Reissue this certificate?'} message={act === 'revoke' ? 'It will stop verifying straight away and the holder is told.' : 'The current certificate is revoked and a new one is issued under a new number, for example to correct a name.'} askReason="Reason" danger={act === 'revoke'} confirmLabel={act === 'revoke' ? 'Revoke' : 'Reissue'}
        onClose={() => setAct(null)} onConfirm={async (reason) => { const r = await api.post(`/certificates/${id}/${act}`, { reason }); toast(act === 'revoke' ? 'Revoked' : `Reissued as ${r.number}`); reload(); }} />}
    </>
  );
}
