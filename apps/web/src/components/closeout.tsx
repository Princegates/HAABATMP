'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, ApiError, useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card, ErrorNote } from './ui';
import { useToast } from './toast';

interface Step { key: string; label: string; state: 'done' | 'todo' | 'waiting'; detail: string }
interface Closeout { programme: { status: string }; steps: Step[]; next: 'start' | 'complete' | 'mark' | 'recalculate' | 'finalise' | 'release' | 'done'; counts: Record<string, number> }

/** Where a programme stands on the way to released results, and the one thing to do next. */
export function CloseoutCard({ id, tick, onChange }: { id: string; tick: number; onChange: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error } = useApi<Closeout>(`/programmes/${id}/closeout?r=${tick}`);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;

  const go = async (work: () => Promise<string>) => {
    setBusy(true);
    try { toast(await work()); onChange(); } catch (e) { toast((e as ApiError).message, 'error'); }
    setBusy(false);
  };
  const finaliseAndRelease = () => go(async () => {
    const f = await api.post(`/programmes/${id}/results/finalise-all`);
    const r = await api.post(`/programmes/${id}/results/release`);
    const blocked = f.blocked?.length ? `. ${f.blocked.length} could not be finalised: ${f.blocked[0].reason}` : '';
    return `${f.finalised} finalised, ${r.released} released to trainees${blocked}`;
  });

  const canFinalise = can('results:finalise');
  const action = (() => {
    switch (data.next) {
      case 'start': return { text: 'Start the programme from the buttons at the top of the page, then come back here.' };
      case 'complete': return can('programmes:write')
        ? { label: 'Mark programme completed', run: () => go(async () => { await api.post(`/programmes/${id}/status`, { status: 'completed' }); return 'Completed. Results have been calculated.'; }) }
        : { text: 'A training administrator marks the programme completed.' };
      case 'mark': return { link: `/marking?programme_id=${id}`, label: 'Open the marking queue' };
      case 'recalculate': return can('results:finalise') || can('attempts:mark')
        ? { label: 'Recalculate results', run: () => go(async () => { const r = await api.post(`/programmes/${id}/results/compute`); return `${r.computed} results recalculated`; }) }
        : { text: 'A training administrator recalculates the results.' };
      case 'finalise': return canFinalise ? { label: 'Finalise and release all ready results', run: finaliseAndRelease } : { text: 'A training administrator finalises the results. Whoever marked someone\'s work cannot finalise it.' };
      case 'release': return canFinalise ? { label: 'Release results to trainees', run: () => go(async () => { const r = await api.post(`/programmes/${id}/results/release`); return `${r.released} released to trainees`; }) } : { text: 'A training administrator releases the results.' };
      default: return { text: 'Everything is done. Trainees can see their results and certificates.' };
    }
  })() as { label?: string; text?: string; run?: () => void; link?: string };

  return (
    <Card title="Close-out checklist" actions={data.next === 'done' ? <span className="badge ok">All done</span> : undefined}>
      <ol className="closeout">
        {data.steps.map((s) => (
          <li key={s.key} className={s.state}>
            <span className="mark" aria-hidden="true">{s.state === 'done' ? '✓' : s.state === 'todo' ? '!' : '•'}</span>
            <div><b>{s.label}</b><div className="muted">{s.detail}</div></div>
          </li>
        ))}
      </ol>
      <div className="row" style={{ marginTop: 14, alignItems: 'center', gap: 14 }}>
        {action.run && <button className="btn" disabled={busy} onClick={action.run}>{busy ? 'Working…' : action.label}</button>}
        {action.link && <Link href={action.link} className="btn">{action.label}</Link>}
        {action.text && <span className="muted">{action.text}</span>}
      </div>
    </Card>
  );
}
