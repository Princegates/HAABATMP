'use client';
import { useMemo, useState } from 'react';

export interface PickItem { value: string; label: string; group?: string; sub?: string }

/** A searchable checklist, optionally grouped (trainees are grouped by their organisation). */
export function ChecklistPicker({ items, selected, onChange, placeholder = 'Search', max = 300 }: { items: PickItem[]; selected: string[]; onChange: (v: string[]) => void; placeholder?: string; max?: number }) {
  const [q, setQ] = useState('');
  const set = useMemo(() => new Set(selected), [selected]);
  const shown = items.filter((i) => `${i.label} ${i.sub ?? ''} ${i.group ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const groups = useMemo(() => {
    const m = new Map<string, PickItem[]>();
    for (const i of shown.slice(0, max)) { const g = i.group ?? ''; m.set(g, [...(m.get(g) ?? []), i]); }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [shown, max]);
  const toggle = (v: string) => onChange(set.has(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <div className="card" style={{ background: 'var(--surface)' }}>
      <div className="toolbar"><input type="search" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} aria-label={placeholder} /><span className="muted" style={{ fontSize: 13 }}>{selected.length} selected</span>
        {shown.length > 0 && <button type="button" className="btn ghost sm" onClick={() => onChange([...new Set([...selected, ...shown.map((s) => s.value)])])}>Select all shown</button>}
        {selected.length > 0 && <button type="button" className="btn ghost sm" onClick={() => onChange([])}>Clear</button>}</div>
      <div style={{ maxHeight: 320, overflow: 'auto' }}>
        {groups.length === 0 && <div className="empty muted">Nothing matches.</div>}
        {groups.map(([g, list]) => (
          <div key={g}>
            {g && <div className="label" style={{ padding: '10px 16px 4px', background: 'var(--surface-2)' }}>{g}</div>}
            {list.map((i) => (
              <label key={i.value} className="check" style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
                <input type="checkbox" checked={set.has(i.value)} onChange={() => toggle(i.value)} /><span>{i.label}{i.sub && <span className="muted" style={{ display: 'block', fontSize: 12.5 }}>{i.sub}</span>}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
