'use client';
import { useAuth } from '@/lib/auth';
import { Column, DataList } from '@/components/datalist';
import { Badge, PageHead } from '@/components/ui';
import { date, label } from '@/lib/format';
import { useOrgOptions } from '@/lib/options';

export default function CertificatesPage() {
  const { is } = useAuth();
  const seesOrg = is('super_admin', 'training_admin', 'auditor');
  const orgs = useOrgOptions(seesOrg);
  const columns: Column<any>[] = [
    { key: 'number', label: 'Certificate', render: (c) => <span className="mono">{c.number}</span>, href: (c) => `/certificates/${c.id}` },
    ...(is('trainee') ? [] : [{ key: 'trainee_name', label: 'Holder', render: (c: any) => <b style={{ fontWeight: 600 }}>{c.trainee_name}</b> }]),
    ...(seesOrg ? [{ key: 'organization_name', label: 'Organisation', render: (c: any) => c.organization_name ?? <span className="muted">Individual</span> }] : []),
    { key: 'course_title', label: 'Course' }, { key: 'issued_at', label: 'Issued', render: (c) => date(c.issued_at) }, { key: 'expires_at', label: 'Expires', render: (c) => (c.expires_at ? date(c.expires_at) : 'No expiry') }, { key: 'status', label: 'Status', render: (c) => <Badge value={c.status} /> },
  ];
  return (
    <>
      <PageHead title="Certificates" subtitle="Every certificate carries a unique number and a QR code anyone can use to confirm it is genuine. Expired and revoked certificates stay on record." />
      <DataList path="/certificates" columns={columns} searchPlaceholder="Search holder or number"
        filters={[{ name: 'status', label: 'Status', options: ['valid', 'expiring_soon', 'expired', 'revoked'].map((v) => ({ value: v, label: label(v) })) }, ...(seesOrg ? [{ name: 'organization_id', label: 'Organisation', options: orgs }] : [])]} empty={{ title: 'No certificates yet' }} />
    </>
  );
}
