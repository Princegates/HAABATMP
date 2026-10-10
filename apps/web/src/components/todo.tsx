'use client';
import Link from 'next/link';
import { useApi } from '@/lib/api';
import { Card } from './ui';

interface Item { key: string; label: string; count: number; href: string; hint: string; tone: 'warn' | 'info' }

/** The short list of things waiting on this person, each linking to where it is done. */
export function TodoCard() {
  const { data } = useApi<{ items: Item[] }>('/dashboard/todo');
  if (!data) return null;
  return (
    <Card title="To do" flush>
      {data.items.length === 0 ? (
        <div className="empty muted">Nothing is waiting on you. You are all caught up.</div>
      ) : (
        <ul className="todo">
          {data.items.map((i) => (
            <li key={i.key}>
              <Link href={i.href}>
                <span className={`count ${i.tone}`}>{i.count}</span>
                <span className="text"><b>{i.label}</b><span className="muted">{i.hint}</span></span>
                <span className="go" aria-hidden="true">{'›'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
