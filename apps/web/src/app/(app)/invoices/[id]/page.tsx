'use client';
import { use, useState } from 'react';
import { api, ApiError, download, useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { FormModal } from '@/components/form';
import { useToast } from '@/components/toast';
import { Badge, Card, ConfirmModal, ErrorNote, KV, Loading, PageHead } from '@/components/ui';
import { date, dateTime, label, money } from '@/lib/format';

export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const toast = useToast();
  const { data: inv, error, reload } = useApi<any>(`/invoices/${id}`);
  const methods = useApi<{ values: { methods: { key: string; label: string; enabled: boolean }[] } }>(can('payments:write') ? '/settings/pages/payment_methods' : null);
  const [pay, setPay] = useState(false);
  const [refund, setRefund] = useState<any | null>(null);
  const [cancel, setCancel] = useState(false);
  if (error) return <ErrorNote error={error} />;
  if (!inv) return <Loading />;
  const balance = Number(inv.total) - Number(inv.amount_paid);
  const open = !['cancelled', 'refunded'].includes(inv.status);
  const dl = (path: string, name: string) => download(path, name).catch((e: ApiError) => toast(e.message, 'error'));
  return (
    <>
      <PageHead title={inv.number} crumbs={[{ label: 'Invoices', href: '/invoices' }, { label: inv.number }]} subtitle={<><Badge value={inv.status} /> · issued {date(inv.issue_date)} · due {date(inv.due_date)}</>}
        actions={<><button className="btn outline" onClick={() => dl(`/invoices/${id}/pdf`, `${inv.number}.pdf`)}>Download PDF</button>
          {can('payments:write') && open && balance > 0 && <button className="btn" onClick={() => setPay(true)}>Record payment</button>}
          {can('invoices:write') && open && Number(inv.amount_paid) === 0 && <button className="btn danger" onClick={() => setCancel(true)}>Cancel invoice</button>}</>} />
      <div className="stack" style={{ gap: 20 }}>
        <div className="grid c2">
          <Card title="Summary"><KV items={[['Billed to', inv.organization_name ?? inv.trainee_name], ['Programme', inv.programme_code], ['Subtotal', money(inv.subtotal, inv.currency)], [`Tax (${inv.tax_rate}%)`, Number(inv.tax_rate) ? money(inv.tax_amount, inv.currency) : null], ['Total', <b key="t">{money(inv.total, inv.currency)}</b>], ['Paid', money(inv.amount_paid, inv.currency)], ['Balance', <b key="b" style={{ color: balance > 0 ? 'var(--warn)' : 'var(--ok)' }}>{money(balance, inv.currency)}</b>], ['Purchase order', inv.purchase_order], ['Notes', inv.notes]]} /></Card>
          <Card title="Lines" flush><table className="table"><tbody>{inv.items.map((i: any) => <tr key={i.id}><td>{i.description}</td><td className="num">{i.quantity} × {money(i.unit_price, '')}</td><td className="num">{money(i.quantity * i.unit_price, inv.currency)}</td></tr>)}</tbody></table></Card>
        </div>
        <Card title="Payments" flush>
          {inv.payments.length === 0 ? <div className="empty muted">No payments recorded.</div> : (
            <table className="table"><thead><tr><th>Receipt</th><th>Received</th><th>Method</th><th>Reference</th><th className="num">Amount</th><th>Status</th><th>Recorded by</th><th /></tr></thead><tbody>{inv.payments.map((p: any) => (
              <tr key={p.id}><td className="mono">{p.receipt_number}</td><td>{dateTime(p.received_at)}</td><td>{label(p.method)}</td><td>{p.reference}</td><td className="num">{money(p.amount, inv.currency)}</td><td><Badge value={p.status} /></td><td className="muted">{p.recorded_by_name}</td>
                <td className="actions"><button className="btn ghost sm" onClick={() => dl(`/payments/${p.id}/receipt`, `${p.receipt_number}.pdf`)}>Receipt</button>{can('payments:write') && p.status === 'paid' && <button className="btn ghost sm" onClick={() => setRefund(p)}>Refund</button>}</td></tr>))}</tbody></table>)}
        </Card>
      </div>
      {pay && <FormModal title="Record a payment" size="narrow" fields={[{ name: 'amount', label: `Amount (balance ${money(balance, inv.currency)})`, type: 'number', required: true, min: 0.01, step: 0.01 }, { name: 'method', label: 'Method', type: 'select', required: true, options: (methods.data?.values.methods ?? []).filter((m) => m.enabled).map((m) => ({ value: m.key, label: m.label })) }, { name: 'reference', label: 'Reference', help: 'Bank reference, mobile money number or cheque number' }, { name: 'note', label: 'Note', type: 'textarea', full: true }]} initial={{ amount: balance, method: 'bank_transfer' }}
        onClose={() => setPay(false)} onSubmit={async (v) => { await api.post(`/invoices/${id}/payments`, v); toast('Payment recorded'); reload(); }} />}
      {refund && <ConfirmModal title="Refund this payment?" message={`${money(refund.amount, inv.currency)} received on ${date(refund.received_at)}. The invoice balance goes back up. Send the money back outside the platform.`} askReason="Reason" danger confirmLabel="Refund" onClose={() => setRefund(null)} onConfirm={async (reason) => { await api.post(`/payments/${refund.id}/refund`, { reason }); toast('Refunded'); reload(); }} />}
      {cancel && <ConfirmModal title="Cancel this invoice?" askReason="Reason" danger confirmLabel="Cancel invoice" onClose={() => setCancel(false)} onConfirm={async (reason) => { await api.post(`/invoices/${id}/cancel`, { reason }); toast('Invoice cancelled'); reload(); }} />}
    </>
  );
}
