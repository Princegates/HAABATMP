'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { label } from '@/lib/format';
import { Modal } from './ui';

const LINK_KINDS = ['video', 'pdf', 'presentation', 'document', 'audio', 'image', 'scorm', 'link'];
const FILE_KINDS = ['pdf', 'presentation', 'document', 'video', 'audio', 'image'];

/** Add learning material to a module, either as a link or as a file uploaded straight from the computer. */
export function AddMaterialModal({ moduleId, onClose, onDone }: { moduleId: string; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<'link' | 'file'>('file');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('pdf');
  const [url, setUrl] = useState('');
  const [required, setRequired] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ready = title.trim().length >= 2 && (mode === 'link' ? /^https?:\/\//i.test(url.trim()) : !!file);

  const save = async () => {
    setBusy(true); setErr('');
    try {
      if (mode === 'link') await api.post(`/modules/${moduleId}/materials`, { title: title.trim(), kind, url: url.trim(), required });
      else {
        const fd = new FormData(); fd.append('title', title.trim()); fd.append('kind', kind); fd.append('required', String(required)); fd.append('file', file!);
        await api.upload(`/modules/${moduleId}/materials/upload`, fd);
      }
      onDone(); onClose();
    } catch (e) { setErr((e as ApiError).message); setBusy(false); }
  };

  return (
    <Modal title="Add learning material" onClose={onClose} footer={<><button className="btn outline" onClick={onClose}>Cancel</button><button className="btn" disabled={!ready || busy} onClick={save}>{busy ? 'Saving…' : 'Add'}</button></>}>
      <div className="stack">
        <div className="row" role="tablist" aria-label="How to add it">
          <button role="tab" aria-selected={mode === 'file'} className={`btn sm ${mode === 'file' ? '' : 'outline'}`} onClick={() => { setMode('file'); if (kind === 'link' || kind === 'scorm') setKind('pdf'); }}>Upload a file</button>
          <button role="tab" aria-selected={mode === 'link'} className={`btn sm ${mode === 'link' ? '' : 'outline'}`} onClick={() => setMode('link')}>Add a link</button>
        </div>
        <div className="field"><label htmlFor="am-title">Title</label><input id="am-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example: Week 1 slides" autoFocus /></div>
        <div className="field"><label htmlFor="am-kind">Kind</label>
          <select id="am-kind" value={kind} onChange={(e) => setKind(e.target.value)}>{(mode === 'file' ? FILE_KINDS : LINK_KINDS).map((k) => <option key={k} value={k}>{label(k)}</option>)}</select></div>
        {mode === 'link'
          ? <div className="field"><label htmlFor="am-url">Link</label><input id="am-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /><span className="help">A web address that starts with https://</span></div>
          : <div className="field"><label htmlFor="am-file">File</label><input id="am-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /><span className="help">PDF, Word, PowerPoint, Excel, image or text. Checked and virus-scanned before it is saved.</span></div>}
        <label className="check"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /><span>Trainees must complete this</span></label>
        {err && <div className="alert danger">{err}</div>}
      </div>
    </Modal>
  );
}
