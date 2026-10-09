'use client';
import { useState } from 'react';
import { api, ApiError, download } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Column, DataList } from '@/components/datalist';
import { useToast } from '@/components/toast';
import { Badge, ConfirmModal, Modal, PageHead } from '@/components/ui';
import { date, label } from '@/lib/format';

const UPLOAD: Record<string, string[]> = {
  super_admin: ['identification', 'certificate', 'licence', 'training_record', 'course_material', 'attendance', 'examination', 'instructor_qualification', 'financial', 'other'],
  training_admin: ['identification', 'certificate', 'licence', 'training_record', 'course_material', 'attendance', 'examination', 'instructor_qualification', 'other'],
  instructor: ['instructor_qualification', 'course_material', 'attendance', 'examination'], trainee: ['identification', 'licence', 'certificate', 'other'],
  org_admin: ['certificate', 'licence', 'training_record', 'other'], finance_officer: ['financial'], auditor: [],
};

function Upload({ onClose, onDone, cats }: { onClose: () => void; onDone: () => void; cats: string[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState(cats[0] ?? 'other');
  const [confidential, setConfidential] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Modal title="Upload a document" size="narrow" onClose={onClose} footer={<><button className="btn outline" onClick={onClose}>Cancel</button><button className="btn" disabled={!file || busy} onClick={async () => {
      setBusy(true); setErr(''); const fd = new FormData(); fd.append('file', file!); fd.append('category', category); fd.append('confidential', String(confidential));
      try { await api.upload('/documents', fd); onDone(); onClose(); } catch (e) { setErr((e as ApiError).message); setBusy(false); } }}>{busy ? 'Uploading…' : 'Upload'}</button></>}>
      <div className="stack">
        <div className="field"><label htmlFor="file">File</label><input id="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.pptx,.csv,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /><span className="help">PDF, images, Word, Excel, PowerPoint, CSV or text. Files are checked by their content, not just their name.</span></div>
        <div className="field"><label htmlFor="cat">Kind</label><select id="cat" value={category} onChange={(e) => setCategory(e.target.value)}>{cats.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></div>
        <label className="check"><input type="checkbox" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} /><span>Confidential. Downloads are recorded in the audit log.</span></label>
        {err && <div className="alert danger">{err}</div>}
      </div>
    </Modal>
  );
}

export default function DocumentsPage() {
  const { me, can } = useAuth();
  const toast = useToast();
  const [up, setUp] = useState(false);
  const [del, setDel] = useState<any | null>(null);
  const [tick, setTick] = useState(0);
  const cats = UPLOAD[me.role] ?? [];
  const columns: Column<any>[] = [
    { key: 'filename', label: 'File', render: (d) => <b style={{ fontWeight: 600 }}>{d.filename}</b> }, { key: 'category', label: 'Kind', render: (d) => label(d.category) }, { key: 'owner_name', label: 'Belongs to' },
    { key: 'size_bytes', label: 'Size', num: true, render: (d) => `${(d.size_bytes / 1024).toFixed(d.size_bytes > 1048576 ? 0 : 1)} KB` }, { key: 'created_at', label: 'Added', render: (d) => date(d.created_at) }, { key: 'confidential', label: '', render: (d) => (d.confidential ? <Badge tone="neutral">Confidential</Badge> : '') },
  ];
  return (
    <>
      <PageHead title="Documents" subtitle="Identification, licences, certificates and training records. What you can see depends on your role, and opening a confidential document is recorded." actions={cats.length > 0 && can('documents:write') && <button className="btn" onClick={() => setUp(true)}>Upload</button>} />
      <DataList path="/documents" columns={columns} refreshKey={tick} searchPlaceholder="Search file name" filters={[{ name: 'category', label: 'Kind', options: cats.concat(me.role === 'super_admin' || me.role === 'auditor' ? [] : []).map((c) => ({ value: c, label: label(c) })) }]} empty={{ title: 'No documents' }}
        actions={(d) => <span className="row" style={{ justifyContent: 'flex-end' }}><button className="btn outline sm" onClick={() => download(`/documents/${d.id}/download`, d.filename).catch((e: ApiError) => toast(e.message, 'error'))}>Download</button>{can('documents:delete') && <button className="btn ghost sm" onClick={() => setDel(d)}>Delete</button>}</span>} />
      {up && <Upload cats={cats} onClose={() => setUp(false)} onDone={() => { toast('Uploaded'); setTick((t) => t + 1); }} />}
      {del && <ConfirmModal title={`Delete ${del.filename}?`} message="The file is removed for good. The deletion is recorded in the audit log." danger confirmLabel="Delete" onClose={() => setDel(null)} onConfirm={async () => { await api.del(`/documents/${del.id}`); toast('Deleted'); setTick((t) => t + 1); }} />}
    </>
  );
}
