'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Column, DataList } from '@/components/datalist';
import { Badge, Modal, PageHead } from '@/components/ui';
import { useToast } from '@/components/toast';
import { date, label, money } from '@/lib/format';
import { useOrgOptions } from '@/lib/options';

interface Item { description: string; quantity: string; unit_price: string }

function NewInvoice({ onClose }: { onClose: () => void }) {
  const orgs = useOrgOptions();
  const router = useRouter();
  const [org, setOrg] = useState('');
  const [po, setPo] = useState('');
  const [items, setItems] = useState<Item[]>([{ description: '', quantity: '1', unit_price: '' }]);
  const [err, setErr] = useState('');
  const total = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
  const valid = org && items.every((i) => i.description.trim().length >= 2 && Number(i.quantity) > 0 && i.unit_price !== '' && Number(i.unit_price) >= 0);
  const set = (n: number, patch: Partial<Item>) => setItems((p) => p.map((x, i) => (i === n ? { ...x, ...patch } : x)));
  return (
    <Modal title="New invoice" size="wide" onClose={onClose} footer={<><button className="btn outline" onClick={onClose}>Cancel</button><button className="btn" disabled={!valid} onClick={async () => { try { const inv = await api.post('/invoices', { organization_id: org, purchase_order: po || null, items: items.map((i) => ({ description: i.description, quantity: Number(i.quantity), unit_price: Number(i.unit_price) })) }); router.push(`/invoices/${inv.id}`); } catch (e) { setErr((e as ApiError).message); } }}>Create invoice</button></>}>
      <div className="stack">
        <div className="form-grid"><div className="field"><label htmlFor="org">Bill to</label><select id="org" value={org} onChange={(e) => setOrg(e.target.value)}><option value="">Choose a client…</option>{orgs.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
          <div className="field"><label htmlFor="po">Purchase order</label><input id="po" type="text" value={po} onChange={(e) => setPo(e.target.value)} /></div></div>
        <table className="table"><thead><tr><th>Description</th><th style={{ width: 90 }}>Qty</th><th style={{ width: 140 }}>Unit price</th><th className="num" style={{ width: 120 }}>Amount</th><th /></tr></thead><tbody>{items.map((it, n) => (
          <tr key={n}><td><input type="text" aria-label="Description" value={it.description} onChange={(e) => set(n, { description: e.target.value })} /></td><td><input type="number" aria-label="Quantity" min={0.01} step="any" value={it.quantity} onChange={(e) => set(n, { quantity: e.target.value })} /></td>
            <td><input type="number" aria-label="Unit price" min={0} step="0.01" value={it.unit_price} onChange={(e) => set(n, { unit_price: e.target.value })} /></td><td className="num">{money((Number(it.quantity) || 0) * (Number(it.unit_price) || 0), '')}</td>
            <td>{items.length > 1 && <button className="btn ghost sm" onClick={() => setItems((p) => p.filter((_, i) => i !== n))} aria-label="Remove line">Remove</button>}</td></tr>))}</tbody></table>
        <div className="row between"><button className="btn outline sm" onClick={() => setItems((p) => [...p, { description: '', quantity: '1', unit_price: '' }])}>Add a line</button><b>Subtotal {money(total)}</b></div>
        <p className="muted" style={{ fontSize: 13 }}>Tax is added from the Currency setting when the invoice is created.</p>
        {err && <div className="alert danger">{err}</div>}
      </div>
    </Modal>
  );
}

export default function InvoicesPage() {
  const { can, is } = useAuth();
  const seesOrg = is('super_admin', 'training_admin', 'auditor', 'finance_officer');
  const orgs = useOrgOptions(seesOrg);
  const [creating, setCreating] = useState(false);
  const columns: Column<any>[] = [
    { key: 'number', label: 'Invoice', render: (i) => <span className="mono">{i.number}</span>, href: (i) => `/invoices/${i.id}` },
    { key: 'client', label: 'Billed to', render: (i) => i.organization_name ?? i.trainee_name }, { key: 'programme_code', label: 'Programme' }, { key: 'issue_date', label: 'Issued', render: (i) => date(i.issue_date) },
    { key: 'due_date', label: 'Due', render: (i) => <span>{date(i.due_date)} {i.overdue && <Badge tone="danger">Overdue</Badge>}</span> }, { key: 'total', label: 'Total', num: true, render: (i) => money(i.total, i.currency) }, { key: 'balance', label: 'Balance', num: true, render: (i) => money(i.balance, i.currency) }, { key: 'status', label: 'Status', render: (i) => <Badge value={i.status} /> },
  ];
  return (
    <>
      <PageHead title="Invoices" subtitle="Raised automatically for each paid place, or manually for other work. Payments are recorded against an invoice by Finance." actions={can('invoices:write') && <button className="btn" onClick={() => setCreating(true)}>New invoice</button>} />
      <DataList path="/invoices" columns={columns} searchPlaceholder="Search invoice or client"
        filters={[{ name: 'status', label: 'Status', options: ['pending', 'partially_paid', 'paid', 'refunded', 'cancelled'].map((v) => ({ value: v, label: label(v) })) }, ...(seesOrg ? [{ name: 'organization_id', label: 'Client', options: orgs }] : []), { name: 'overdue', label: 'Overdue', options: [{ value: 'true', label: 'Overdue only' }] }]} empty={{ title: 'No invoices yet' }} />
      {creating && <NewInvoice onClose={() => setCreating(false)} />}
    </>
  );
}
