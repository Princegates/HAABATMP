'use client';
import Link from 'next/link';
import { useApi } from '@/lib/api';
import { Badge, Card, ErrorNote, Loading, PageHead } from '@/components/ui';
import { dateTime, pct } from '@/lib/format';

export default function ExamsPage() {
  const { data, error } = useApi<any[]>('/my/assessments');
  return (
    <>
      <PageHead title="My" accent="assessments" subtitle="Assessments for the programmes you are confirmed on. The clock runs on the server, so closing the page does not pause it." />
      <ErrorNote error={error} />{!data && !error && <Loading />}
      <div className="stack">
        {data?.length === 0 && <Card><div className="empty muted">No assessments are open to you right now.</div></Card>}
        {data?.map((a) => {
          const left = a.max_attempts - a.attempts_used;
          const closed = a.closes_at && new Date(a.closes_at) < new Date();
          const notOpen = a.opens_at && new Date(a.opens_at) > new Date();
          return (
            <Card key={a.id} title={a.title} actions={a.in_progress_attempt ? <Link href={`/exams/${a.id}`} className="btn">Resume</Link> : left > 0 && !closed && !notOpen ? <Link href={`/exams/${a.id}`} className="btn">Start</Link> : <Badge tone="neutral">{closed ? 'Closed' : notOpen ? 'Not open yet' : 'No attempts left'}</Badge>}>
              <div className="row wrap muted"><span>{a.programme_code}</span><span>{a.duration_minutes} minutes</span><span>Pass mark {a.pass_mark}%</span><span>Attempts used {a.attempts_used} of {a.max_attempts}</span>{a.closes_at && <span>Closes {dateTime(a.closes_at)}</span>}{a.opens_at && notOpen && <span>Opens {dateTime(a.opens_at)}</span>}{a.best_percentage !== null && <b>Best result {pct(a.best_percentage, 1)}</b>}</div>
              {a.in_progress_attempt && <div className="alert warn" style={{ marginTop: 12 }}>You have an attempt in progress. Resume it before the time runs out.</div>}
            </Card>
          );
        })}
      </div>
    </>
  );
}
