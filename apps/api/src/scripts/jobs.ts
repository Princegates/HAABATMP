/**
 * Scheduled maintenance. Run every 15 minutes (a Render cron job): `node dist/scripts/jobs.js`.
 * Every step is idempotent, so running it twice, or two overlapping runs, is harmless.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AuditService } from '../common/audit.service';
import { Db } from '../common/db.service';
import { NotifyService } from '../common/notify.service';
import { SettingsService } from '../common/settings.service';
import { AssessmentsController } from '../modules/assessments.module';

const SYSTEM = { id: null, email: 'system@scheduler', role: 'system', ip: null } as const;

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const db = app.get(Db);
  const audit = app.get(AuditService);
  const notify = app.get(NotifyService);
  const settings = app.get(SettingsService);
  const report: Record<string, number> = {};

  // 1. close registration after the deadline, start programmes on their start date
  const closed = await db.query<{ id: string; code: string }>(
    `update programmes set status = 'registration_closed' where status = 'open_for_registration' and registration_deadline < current_date returning id, code`);
  for (const p of closed) await audit.log(null, SYSTEM, 'programme.registration_closed', 'programme', p.id, { status: 'open_for_registration' }, { status: 'registration_closed', by: 'deadline' });
  report.registration_closed = closed.length;
  const started = await db.query<{ id: string }>(`update programmes set status = 'ongoing' where status = 'registration_closed' and start_date <= current_date returning id`);
  for (const p of started) await audit.log(null, SYSTEM, 'programme.ongoing', 'programme', p.id, { status: 'registration_closed' }, { status: 'ongoing', by: 'start date' });
  report.started = started.length;

  // 2. attempts whose clock ran out while the trainee was away
  report.attempts_closed = await app.get(AssessmentsController, { strict: false }).sweepExpiredAttempts();

  // 3. certificate expiry reminders to the holder and to their client's administrators
  const n = await settings.get<{ expiry_reminder_days: number[]; notify_certificates: boolean; notify_session_reminders: boolean }>('notifications');
  let reminders = 0;
  if (n.notify_certificates) {
    for (const days of n.expiry_reminder_days ?? []) {
      const due = await db.query<any>(
        `select c.id, c.number, c.expires_at, t.id as trainee_id, t.organization_id, t.full_name, co.title from certificates c join users t on t.id = c.trainee_id join courses co on co.id = c.course_id
          where c.status = 'valid' and c.expires_at = current_date + $1::int`, [days]);
      for (const c of due) {
        const subject = `Certificate expires in ${days} days: ${c.title}`;
        await notify.notify({ userId: c.trainee_id, kind: 'certificate.expiring', subject, dedupeKey: `expiry:${c.id}:${days}:${c.trainee_id}`,
          body: `Your certificate ${c.number} for "${c.title}" expires on ${c.expires_at}. Contact HAAB to book refresher training.` });
        reminders++;
        if (c.organization_id) {
          const admins = await db.query<{ id: string }>(`select id from users where role = 'org_admin' and organization_id = $1 and status = 'active'`, [c.organization_id]);
          for (const a of admins) {
            await notify.notify({ userId: a.id, kind: 'certificate.expiring', subject: `${c.full_name}: ${subject}`, dedupeKey: `expiry:${c.id}:${days}:${a.id}`,
              body: `${c.full_name}'s certificate ${c.number} for "${c.title}" expires on ${c.expires_at}.` });
            reminders++;
          }
        }
      }
    }
  }
  report.expiry_reminders = reminders;

  // 4. a reminder the day before a session
  let sessionReminders = 0;
  if (n.notify_session_reminders) {
    const sessions = await db.query<any>(
      `select s.id, s.title, s.starts_at, p.title as programme, e.trainee_id from sessions s join programmes p on p.id = s.programme_id
         join enrollments e on e.programme_id = p.id and e.status = 'confirmed'
        where s.starts_at between now() + interval '12 hours' and now() + interval '36 hours' and p.status <> 'cancelled'`);
    for (const s of sessions) {
      await notify.notify({ userId: s.trainee_id, kind: 'session.reminder', subject: `Tomorrow: ${s.title}`, dedupeKey: `session:${s.id}:${s.trainee_id}`,
        body: `Reminder: "${s.title}" (${s.programme}) starts at ${new Date(s.starts_at).toISOString().replace('T', ' ').slice(0, 16)} UTC.` });
      sessionReminders++;
    }
  }
  report.session_reminders = sessionReminders;

  // 5. send queued email last so everything created above goes out in this run
  const mail = await notify.processOutbox(100);
  report.emails_sent = mail.sent;
  report.emails_failed = mail.failed;

  console.log(JSON.stringify({ at: new Date().toISOString(), ...report }));
  await app.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
