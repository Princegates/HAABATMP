'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { qs, useApi } from '@/lib/api';
import { Empty, ErrorNote, Loading, useDebounced } from './ui';

export interface Column<T> { key: string; label: string; render?: (row: T) => React.ReactNode; num?: boolean; href?: (row: T) => string | undefined; width?: number }
export interface FilterDef { name: string; label: string; options: { value: string; label: string }[] }

/**
 * A paged, searchable, filterable table over any list endpoint that returns { data, total }.
 * Every list in the platform uses it, so search, paging and empty states behave the same everywhere.
 */
export function DataList<T extends { id?: string }>({ path, columns, filters, extra, pageSize = 25, search = true, searchPlaceholder = 'Search', actions, empty, refreshKey, toolbar }: {
  path: string; columns: Column<T>[]; filters?: FilterDef[]; extra?: Record<string, string | undefined>; pageSize?: number; search?: boolean; searchPlaceholder?: string;
  actions?: (row: T, reload: () => void) => React.ReactNode; empty?: { title: string; hint?: string }; refreshKey?: number; toolbar?: React.ReactNode;
}) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [dq, JSON.stringify(vals), JSON.stringify(extra), path]);
  const url = useMemo(() => `${path}${qs({ limit: pageSize, offset: page * pageSize, q: dq, ...vals, ...extra })}`, [path, pageSize, page, dq, vals, extra]);
  const { data, error, loading, reload } = useApi<{ data: T[]; total?: number }>(url);
  useEffect(() => { if (refreshKey) reload(); }, [refreshKey, reload]);
  const rows = data?.data ?? [];
  const total = data?.total ?? rows.length;
  const hasMore = data?.total !== undefined ? (page + 1) * pageSize < total : rows.length === pageSize;

  return (
    <div className="card">
      {(search || filters?.length || toolbar) && (
        <div className="toolbar">
          {search && <input type="search" placeholder={searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} aria-label={searchPlaceholder} />}
          {filters?.map((f) => (
            <select key={f.name} value={vals[f.name] ?? ''} onChange={(e) => setVals((p) => ({ ...p, [f.name]: e.target.value }))} aria-label={f.label}>
              <option value="">{f.label}: all</option>{f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ))}
          <div className="grow" />{toolbar}
        </div>
      )}
      <ErrorNote error={error} />
      <div className="table-wrap">
        <table className="table">
          <thead><tr>{columns.map((c) => <th key={c.key} className={c.num ? 'num' : ''} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}{actions && <th />}</tr></thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.id ?? i}>
                {columns.map((c) => {
                  const content = c.render ? c.render(row) : String((row as any)[c.key] ?? '');
                  const href = c.href?.(row);
                  return <td key={c.key} className={c.num ? 'num' : ''}>{href ? <Link href={href}>{content}</Link> : content}</td>;
                })}
                {actions && <td className="actions">{actions(row, reload)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading && !rows.length && <Loading />}
      {!loading && !error && rows.length === 0 && <Empty title={empty?.title ?? 'Nothing here yet'}>{empty?.hint ?? (dq || Object.values(vals).some(Boolean) ? 'Try a different search or filter.' : undefined)}</Empty>}
      {(page > 0 || hasMore) && (
        <div className="pager">
          <span>{data?.total !== undefined ? `${page * pageSize + 1}–${Math.min(total, (page + 1) * pageSize)} of ${total.toLocaleString('en-GB')}` : `Page ${page + 1}`}</span>
          <span className="row"><button className="btn outline sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button><button className="btn outline sm" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>Next</button></span>
        </div>
      )}
    </div>
  );
}
