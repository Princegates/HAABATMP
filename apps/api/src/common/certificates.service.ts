import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ENV, Env } from '../config';
import { Actor } from './auth.types';
import { AuditService } from './audit.service';
import { createHash } from 'node:crypto';
import { renderCertificate } from './certificate-pdf';
import { renderSerially } from './pdf-queue';
import { StorageService } from './storage.service';
import { CryptoService } from './crypto.service';
import { Db, Q } from './db.service';
import { NotifyService } from './notify.service';
import { NumberingService } from './numbering.service';
import { SettingsService } from './settings.service';
import { addMonths, daysBetween, todayUtc } from './util';

export type CertStatus = 'valid' | 'expiring_soon' | 'expired' | 'revoked';

/** The single place the displayed status is derived. Stored status is only valid or revoked. */
export function certStatus(c: { status: string; expires_at: string | null }, soonDays: number, today = todayUtc()): CertStatus {
  if (c.status === 'revoked') return 'revoked';
  if (c.expires_at) {
    if (c.expires_at < today) return 'expired';
    if (daysBetween(today, c.expires_at) <= soonDays) return 'expiring_soon';
  }
  return 'valid';
}

@Injectable()
export class CertificatesService {
  constructor(
    private readonly db: Db, private readonly audit: AuditService, private readonly numbers: NumberingService,
    private readonly crypto: CryptoService, private readonly settings: SettingsService, private readonly notify: NotifyService,
    private readonly storage: StorageService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Issues the certificate for a passed enrolment. Safe to call twice: the live one is returned. */
  /** `keep` is for a reissue: the replacement carries the original dates, so correcting a certificate never renews it. */
  async issue(q: Q, enrollmentId: string, actor: Actor, keep?: { issued_at: string; expires_at: string | null }) {
    const live = await q.one<any>(`select * from certificates where enrollment_id = $1 and status = 'valid'`, [enrollmentId]);
    if (live) return live;
    const e = await q.one<any>(
      `select e.id, e.trainee_id, e.programme_id, p.course_id, c.validity_months, k.code as category_code, t.organization_id
         from enrollments e join programmes p on p.id = e.programme_id join courses c on c.id = p.course_id
         join course_categories k on k.id = c.category_id join users t on t.id = e.trainee_id where e.id = $1`, [enrollmentId]);
    if (!e) throw new NotFoundException('Enrolment not found');
    const issued = keep?.issued_at ?? todayUtc();
    const number = await this.numbers.certificate(q, e.category_code);
    const prev = await q.one<any>(`select id from certificates where trainee_id = $1 and course_id = $2 order by issued_at desc, created_at desc limit 1`, [e.trainee_id, e.course_id]);
    const tpl = await q.one<any>(
      `select id from certificate_templates where organization_id = $1 union all select id from certificate_templates where is_default limit 1`, [e.organization_id]);
    const row = await q.one<any>(
      `insert into certificates (number, verification_token, enrollment_id, trainee_id, course_id, programme_id, template_id, issued_at, expires_at, renewal_of, issued_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [number, this.crypto.token(32), enrollmentId, e.trainee_id, e.course_id, e.programme_id, tpl?.id ?? null, issued,
        keep ? keep.expires_at : e.validity_months ? addMonths(issued, e.validity_months) : null, prev?.id ?? null, actor.id]);
    await this.audit.log(q, actor, 'certificate.issue', 'certificate', row.id, null, { number, trainee_id: e.trainee_id, course_id: e.course_id, expires_at: row.expires_at });
    return row;
  }

  /** `notify: false` is for a reissue, which tells the trainee about the replacement instead. Nothing is sent about a certificate the trainee has not been shown yet. */
  async revoke(q: Q, certificateId: string, actor: Actor, reason: string, opts: { notify?: boolean } = {}) {
    const c = await q.one<any>('select * from certificates where id = $1 for update', [certificateId]);
    if (!c) throw new NotFoundException('Certificate not found');
    if (c.status === 'revoked') throw new ConflictException('This certificate is already revoked');
    const after = await q.one<any>(
      `update certificates set status = 'revoked', revoked_at = now(), revoked_by = $2, revoke_reason = $3 where id = $1 returning *`, [certificateId, actor.id, reason]);
    await this.audit.log(q, actor, 'certificate.revoke', 'certificate', certificateId, { status: c.status }, { status: 'revoked', reason });
    const shown = await q.one<any>('select 1 from results where enrollment_id = $1 and released', [c.enrollment_id]);
    if (opts.notify !== false && shown) await this.notify.notify({ userId: c.trainee_id, kind: 'certificate.revoked', subject: `Certificate ${c.number} revoked`,
      body: `Your certificate ${c.number} has been revoked. Reason: ${reason}. Contact HAAB if you believe this is a mistake.` }, q);
    return after;
  }

  private readonly inflight = new Map<string, Promise<Buffer>>();

  /**
   * The certificate as a PDF. The stored copy is kept under a key that contains a hash of everything printed on it, so a changed name,
   * title or template makes a new key and is never served from an old copy. Nothing is ever served stale, and older copies are simply unused.
   */
  async pdf(certificateId: string): Promise<{ file: Buffer; number: string }> {
    const c = await this.db.one<any>(
      `select c.*, t.full_name, co.title as course_title, co.code as course_code, co.duration_hours, p.start_date, p.end_date,
              co.pass_mark, co.min_attendance_pct, k.name as category_name, p.code as programme_code, p.location, po.name as partner_name,
              tp.heading, tp.signatory_name, tp.signatory_title, tp.footer_text, tp.accent_color
         from certificates c join users t on t.id = c.trainee_id join courses co on co.id = c.course_id join programmes p on p.id = c.programme_id
         join course_categories k on k.id = co.category_id
         left join organizations po on po.id = p.organization_id
         left join certificate_templates tp on tp.id = c.template_id where c.id = $1`, [certificateId]);
    if (!c) throw new NotFoundException();
    const mods = await this.db.query<{ title: string }>(`select title from course_modules where course_id = $1 order by position, created_at`, [c.course_id]);
    const org = await this.settings.get<{ name?: string }>('organization');
    const dates = c.start_date === c.end_date ? fmt(c.start_date) : `${fmt(c.start_date)} to ${fmt(c.end_date)}`;
    const view = {
      heading: c.heading ?? 'Certificate of Completion', holder: c.full_name, courseTitle: c.course_title, courseCode: c.course_code,
      trainingDates: dates, trainingHours: c.duration_hours, number: c.number, issuedAt: fmt(c.issued_at), expiresAt: c.expires_at ? fmt(c.expires_at) : null,
      signatoryName: c.signatory_name, signatoryTitle: c.signatory_title, footerText: c.footer_text, accent: c.accent_color ?? '#b8966e',
      issuer: org.name ?? 'HAAB Aviation Consultancy Services Ltd.', verifyUrl: `${this.env.PUBLIC_WEB_URL}/verify/${c.verification_token}`, logoPath: this.env.LOGO_PATH,
      category: c.category_name, programmeCode: c.programme_code, location: c.location, partner: c.partner_name,
      modules: mods.slice(0, 8).map((m) => m.title), moreModules: Math.max(0, mods.length - 8),
      passMark: c.pass_mark, minAttendance: c.min_attendance_pct,
    };
    const key = `certificates/${c.id}/${createHash('sha256').update(JSON.stringify(view)).digest('hex').slice(0, 32)}.pdf`;
    if (c.pdf_key === key) {
      try { return { file: await this.storage.get(key), number: c.number }; } catch { /* the stored copy is gone: make it again */ }
    }
    let pending = this.inflight.get(key);
    if (!pending) {
      // several people asking for the same certificate at once share one build
      pending = renderSerially(async () => {
        const file = await renderCertificate(view);
        try {
          await this.storage.put(key, file, 'application/pdf');
        } catch { /* already stored by another request or instance: the content is identical */ }
        await this.db.query('update certificates set pdf_key = $2 where id = $1', [c.id, key]);
        return file;
      }).finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    return { file: await pending, number: c.number };
  }

  /** Builds and stores the PDFs that do not have one yet. Run by the background job, so the work happens away from the web server. */
  async warmPdfs(limit = 40): Promise<number> {
    const todo = await this.db.query<{ id: string }>(`select id from certificates where pdf_key is null and status = 'valid' order by created_at limit $1`, [limit]);
    let done = 0;
    for (const c of todo) {
      try { await this.pdf(c.id); done++; } catch { /* leave it for the next run; a download builds it on demand */ }
    }
    return done;
  }
}

function fmt(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
}
