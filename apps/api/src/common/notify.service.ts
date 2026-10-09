import { Injectable, Logger } from '@nestjs/common';
import { Db, Q } from './db.service';
import { Mailer } from './mailer.service';

export interface NotifyInput {
  userId?: string | null;
  email?: string | null;
  kind: string;
  subject: string;
  body: string;
  /** Prevents duplicate reminders, for example expiry:<certificateId>:30 */
  dedupeKey?: string;
}

@Injectable()
export class NotifyService {
  private readonly log = new Logger(NotifyService.name);
  constructor(private readonly db: Db, private readonly mailer: Mailer) {}

  /** Queues an in-app notice and an email. Delivery happens in processOutbox(). */
  async notify(input: NotifyInput, q?: Q): Promise<void> {
    const runner = q ?? this.db;
    let email = input.email ?? null;
    if (!email && input.userId) {
      const u = await runner.one<{ email: string }>('select email from users where id = $1', [input.userId]);
      email = u?.email ?? null;
    }
    if (input.userId) {
      await runner.query(
        `insert into notifications (user_id, channel, kind, subject, body, status, dedupe_key)
         values ($1,'in_app',$2,$3,$4,'sent',$5) on conflict do nothing`,
        [input.userId, input.kind, input.subject, input.body, input.dedupeKey ? `app:${input.dedupeKey}` : null],
      );
    }
    if (email) {
      await runner.query(
        `insert into notifications (user_id, to_email, channel, kind, subject, body, status, dedupe_key)
         values ($1,$2,'email',$3,$4,$5,'pending',$6) on conflict do nothing`,
        [input.userId ?? null, email, input.kind, input.subject, input.body, input.dedupeKey ? `mail:${input.dedupeKey}` : null],
      );
    }
  }

  async processOutbox(batch = 50): Promise<{ sent: number; failed: number }> {
    const rows = await this.db.query<{ id: string; to_email: string; subject: string; body: string; attempts: number }>(
      `select id, to_email, subject, body, attempts from notifications
        where channel = 'email' and status = 'pending' and attempts < 5
        order by created_at limit $1 for update skip locked`,
      [batch],
    );
    let sent = 0;
    let failed = 0;
    for (const n of rows) {
      try {
        await this.mailer.send(n.to_email, n.subject, n.body);
        await this.db.query(`update notifications set status='sent', sent_at=now(), attempts=attempts+1, error=null where id=$1`, [n.id]);
        sent++;
      } catch (e: any) {
        const exhausted = n.attempts + 1 >= 5;
        await this.db.query(
          `update notifications set attempts=attempts+1, error=$2, status=$3 where id=$1`,
          [n.id, String(e.message).slice(0, 300), exhausted ? 'failed' : 'pending'],
        );
        failed++;
        this.log.warn(`email ${n.id} failed: ${e.message}`);
      }
    }
    return { sent, failed };
  }
}
