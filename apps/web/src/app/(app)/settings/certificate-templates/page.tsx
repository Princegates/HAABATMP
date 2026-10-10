'use client';
import { useState } from 'react';
import { api, useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { FieldDef, FormModal } from '@/components/form';
import { Badge, Card, ErrorNote, Loading } from '@/components/ui';
import { useToast } from '@/components/toast';
import { useOrgOptions } from '@/lib/options';
import { DeleteButton } from '@/components/delete';

export default function TemplatesPage() {
  const { can } = useAuth();
  const { data, error, reload } = useApi<any[]>('/certificate-templates');
  const orgs = useOrgOptions();
  const toast = useToast();
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const fields: FieldDef[] = [
    { name: 'name', label: 'Template name', required: true }, { name: 'heading', label: 'Heading on the certificate', required: true },
    { name: 'signatory_name', label: 'Signatory name' }, { name: 'signatory_title', label: 'Signatory title' },
    { name: 'organization_id', label: 'Only for this client', type: 'select', options: orgs, help: 'Leave empty for everyone' },
    { name: 'accent_color', label: 'Line colour (hex)', help: 'For example #b8966e' },
    { name: 'footer_text', label: 'Footer text', type: 'textarea', full: true },
  ];
  return (
    <Card title="Certificate Templates" actions={can('certificates:issue') && <button className="btn sm" onClick={() => setEditing('new')}>New template</button>} flush>
      <div style={{ padding: '14px 20px' }} className="muted">Certificates always print on white with the HAAB logo, a QR code and a unique number. Templates control the heading, signatory and accent line. A client-specific template is used for that client's trainees.</div>
      <ErrorNote error={error} />{!data && !error && <Loading />}
      {data && <table className="table"><thead><tr><th>Name</th><th>Heading</th><th>Signatory</th><th>Colour</th><th /><th /></tr></thead><tbody>
        {data.map((t) => <tr key={t.id}><td><b style={{ fontWeight: 600 }}>{t.name}</b></td><td>{t.heading}</td><td>{t.signatory_name} <span className="muted">{t.signatory_title}</span></td>
          <td><span style={{ display: 'inline-block', width: 14, height: 14, background: t.accent_color, verticalAlign: -2, marginRight: 8 }} />{t.accent_color}</td>
          <td>{t.is_default && <Badge tone="info">Default</Badge>}{t.organization_id && <Badge tone="neutral">Client</Badge>}</td>
          <td className="actions">{can('certificates:issue') && <button className="btn outline sm" onClick={() => setEditing(t)}>Edit</button>}{!t.is_default && <DeleteButton path={`/certificate-templates/${t.id}`} what={t.name} goes="Certificates already issued keep their number and fall back to the default design." onDone={reload} />}</td></tr>)}
      </tbody></table>}
      {editing && <FormModal title={editing === 'new' ? 'New certificate template' : 'Edit template'} fields={fields} initial={editing === 'new' ? { heading: 'Certificate of Completion', accent_color: '#b8966e' } : editing}
        onClose={() => setEditing(null)} onSubmit={async (v) => { editing === 'new' ? await api.post('/certificate-templates', v) : await api.patch(`/certificate-templates/${editing.id}`, v); toast('Template saved'); reload(); }} />}
    </Card>
  );
}
