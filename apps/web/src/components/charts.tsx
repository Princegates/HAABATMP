'use client';
import { useState } from 'react';

const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];
const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n * 10) / 10));
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });

/** Grouped bars over time. Values are shown on hover and listed in a table for screen readers. */
export function BarChart({ data, series, height = 220 }: { data: { month: string; [k: string]: number | string }[]; series: { key: string; label: string }[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640; const H = height; const L = 44; const B = 26; const T = 10;
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const bw = (W - L) / data.length;
  const gw = Math.min(bw * 0.7, 36 * series.length);
  const sw = gw / series.length;
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map((s) => s.label).join(' and ') + ' by month'}>
        {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).map((v) => {
          const y = H - B - (v / top) * (H - B - T);
          return <g key={v}><line x1={L} x2={W} y1={y} y2={y} stroke="var(--grid)" /><text x={L - 6} y={y + 3.5} textAnchor="end">{compact(v)}</text></g>;
        })}
        {data.map((d, i) => {
          const x = L + i * bw + (bw - gw) / 2;
          return (
            <g key={d.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={L + i * bw} y={0} width={bw} height={H - B} fill="transparent" />
              {series.map((s, j) => {
                const v = Number(d[s.key]) || 0; const h = (v / top) * (H - B - T);
                return <rect key={s.key} x={x + j * sw} y={H - B - h} width={Math.max(2, sw - 2)} height={h} fill={COLORS[j]} opacity={hover === null || hover === i ? 1 : 0.55} />;
              })}
              <text x={L + i * bw + bw / 2} y={H - 8} textAnchor="middle">{monthLabel(d.month)}</text>
            </g>
          );
        })}
        {hover !== null && (
          <g pointerEvents="none">
            <rect x={Math.min(W - 150, Math.max(L, L + hover * bw - 40))} y={4} width={146} height={16 + series.length * 16} fill="var(--chrome-bg)" stroke="var(--chrome-line)" />
            <text x={Math.min(W - 150, Math.max(L, L + hover * bw - 40)) + 8} y={19} style={{ fill: 'var(--chrome-text)', fontWeight: 600 }}>{data[hover].month}</text>
            {series.map((s, j) => <text key={s.key} x={Math.min(W - 150, Math.max(L, L + hover * bw - 40)) + 8} y={35 + j * 15} style={{ fill: 'var(--chrome-text)' }}>{s.label}: {Number(data[hover][s.key]).toLocaleString('en-GB')}</text>)}
          </g>
        )}
      </svg>
      <Legend items={series.map((s, j) => ({ label: s.label, color: COLORS[j] }))} />
      <table className="sr-only"><caption>{series.map((s) => s.label).join(', ')}</caption><tbody>{data.map((d) => <tr key={d.month}><th>{d.month}</th>{series.map((s) => <td key={s.key}>{String(d[s.key])}</td>)}</tr>)}</tbody></table>
    </div>
  );
}

export function LineChart({ data, series, height = 220 }: { data: { month: string; [k: string]: number | string }[]; series: { key: string; label: string }[]; height?: number }) {
  const W = 640; const H = height; const L = 44; const B = 26; const T = 10;
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)));
  const step = niceStep(max / 4); const top = Math.ceil(max / step) * step;
  const x = (i: number) => L + (i * (W - L - 8)) / Math.max(1, data.length - 1);
  const y = (v: number) => H - B - (v / top) * (H - B - T);
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map((s) => s.label).join(' and ') + ' trend'}>
        {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).map((v) => <g key={v}><line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke="var(--grid)" /><text x={L - 6} y={y(v) + 3.5} textAnchor="end">{compact(v)}</text></g>)}
        {data.map((d, i) => <text key={d.month} x={x(i)} y={H - 8} textAnchor="middle">{monthLabel(d.month)}</text>)}
        {series.map((s, j) => (
          <g key={s.key}>
            <polyline fill="none" stroke={COLORS[j]} strokeWidth="2" points={data.map((d, i) => `${x(i)},${y(Number(d[s.key]) || 0)}`).join(' ')} />
            {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(Number(d[s.key]) || 0)} r="3" fill={COLORS[j]}><title>{`${d.month} ${s.label}: ${d[s.key]}`}</title></circle>)}
          </g>
        ))}
      </svg>
      <Legend items={series.map((s, j) => ({ label: s.label, color: COLORS[j] }))} />
    </div>
  );
}

/** Half-donut breakdown, the pattern used for category and client splits on the reference dashboard. */
export function HalfDonut({ data, height = 190 }: { data: { label: string; value: number }[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const rows = data.filter((d) => d.value > 0);
  const total = rows.reduce((s, d) => s + d.value, 0);
  const cx = 160; const cy = 150; const R = 130; const r = 78;
  if (!total) return <div className="empty muted" style={{ padding: '32px 0' }}>No data yet</div>;
  let angle = Math.PI;
  const arcs = rows.map((d, i) => {
    const a0 = angle; const a1 = angle + (d.value / total) * Math.PI; angle = a1;
    const p = (a: number, rad: number) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    const [x0, y0] = p(a0, R); const [x1, y1] = p(a1, R); const [x2, y2] = p(a1, r); const [x3, y3] = p(a0, r);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return { i, d, path: `M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${large} 0 ${x3},${y3} Z` };
  });
  return (
    <div>
      <svg className="chart" viewBox="0 0 320 170" style={{ maxHeight: height }} role="img" aria-label="Breakdown">
        {arcs.map((a) => <path key={a.i} d={a.path} fill={COLORS[a.i % COLORS.length]} stroke="var(--surface)" strokeWidth="2" opacity={hover === null || hover === a.i ? 1 : 0.5} onMouseEnter={() => setHover(a.i)} onMouseLeave={() => setHover(null)}><title>{`${a.d.label}: ${a.d.value}`}</title></path>)}
        <text x={cx} y={cy - 18} textAnchor="middle" style={{ fontFamily: 'var(--font-display)', fontSize: 30, fill: 'var(--text)', fontVariantNumeric: 'lining-nums', fontFeatureSettings: "'lnum' 1" }}>{hover !== null ? rows[hover].value : total}</text>
        <text x={cx} y={cy - 2} textAnchor="middle">{hover !== null ? rows[hover].label.slice(0, 22) : 'in total'}</text>
      </svg>
      <Legend items={rows.map((d, i) => ({ label: `${d.label} (${d.value})`, color: COLORS[i % COLORS.length] }))} />
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return <div className="legend">{items.map((it) => <span key={it.label}><i style={{ background: it.color }} />{it.label}</span>)}</div>;
}

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
