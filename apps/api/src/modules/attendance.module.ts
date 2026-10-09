import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Module, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Actor, AuthUser } from '../common/auth.types';
import { AuditService } from '../common/audit.service';
import { attendanceStats } from '../common/attendance';
import { CryptoService } from '../common/crypto.service';
import { Db } from '../common/db.service';
import { ActorCtx, CurrentUser, Require } from '../common/decorators';
import { isStaff } from '../common/scope';
import { parse, uuid } from '../common/validation';

const WINDOW_MS = 30_000;       // the QR code changes every 30 seconds, so a screenshot is useless soon after
const EARLY_MS = 15 * 60_000;   // check-in opens 15 minutes before the session
const LATE_AFTER_MS = 15 * 60_000;

@Controller()
export class AttendanceController {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly crypto: CryptoService) {}

  @Get('sessions/:id/attendance')
  @Require('attendance:read')
  async roster(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    parse(uuid, id);
    const s = await this.sessionFor(u, id, false);
    const rows = await this.db.query(
      `select t.id as trainee_id, t.full_name, t.email, o.name as organization_name, a.status, a.method, a.marked_at, a.note
         from enrollments e join users t on t.id = e.trainee_id left join organizations o on o.id = t.organization_id
         left join attendance a on a.session_id = $1 and a.trainee_id = t.id
        where e.programme_id = $2 and e.status in ('confirmed','completed') order by t.full_name`, [id, s.programme_id]);
    return { session: s, roster: rows };
  }

  @Put('sessions/:id/attendance')
  @Require('attendance:write')
  async mark(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const { records } = parse(z.object({
      records: z.array(z.object({ trainee_id: uuid, status: z.enum(['present', 'absent', 'late', 'excused']), note: z.string().trim().max(500).nullish() })).min(1).max(500),
    }), body);
    const s = await this.sessionFor(u, id, true);
    if (new Date(s.starts_at) > new Date(Date.now() + EARLY_MS)) throw new ConflictException('This session has not started yet');
    return this.db.tx(async (q) => {
      const enrolled = new Set((await q.query<{ trainee_id: string }>(`select trainee_id from enrollments where programme_id = $1 and status in ('confirmed','completed')`, [s.programme_id])).map((r) => r.trainee_id));
      const bad = records.filter((r) => !enrolled.has(r.trainee_id));
      if (bad.length) throw new BadRequestException(`${bad.length} trainee(s) are not confirmed on this programme`);
      const before = await q.query('select trainee_id, status from attendance where session_id = $1', [id]);
      for (const r of records) {
        await q.query(
          `insert into attendance (session_id, trainee_id, status, method, marked_by, note) values ($1,$2,$3,'manual',$4,$5)
           on conflict (session_id, trainee_id) do update set status = excluded.status, method = 'manual', marked_by = excluded.marked_by, marked_at = now(), note = excluded.note`,
          [id, r.trainee_id, r.status, u.id, r.note ?? null]);
      }
      await this.audit.log(q, actor, 'attendance.mark', 'session', id, before, records.map((r) => ({ trainee_id: r.trainee_id, status: r.status })));
      return { saved: records.length };
    });
  }

  /** The instructor's screen shows this code; trainees scan it. */
  @Get('sessions/:id/qr')
  @Require('attendance:write')
  async qr(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    parse(uuid, id);
    await this.sessionFor(u, id, true);
    const s = await this.db.one<{ qr_secret: string }>('select qr_secret from sessions where id = $1', [id]);
    const win = Math.floor(Date.now() / WINDOW_MS);
    return { token: `${id}.${win}.${this.crypto.hmac(s!.qr_secret, `${id}.${win}`)}`, expires_in: Math.ceil(((win + 1) * WINDOW_MS - Date.now()) / 1000) };
  }

  @Post('attendance/qr-checkin')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async checkIn(@CurrentUser() u: AuthUser, @Body() body: unknown, @ActorCtx() actor: Actor) {
    const d = parse(z.object({ token: z.string().max(300), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional() }), body);
    if (u.role !== 'trainee') throw new ForbiddenException('Only trainees check in');
    const [sid, winStr, mac] = d.token.split('.');
    const win = Number(winStr);
    if (!sid || !mac || !Number.isInteger(win) || !uuidOk(sid)) throw new BadRequestException('That code is not valid');
    const s = await this.db.one<any>('select * from sessions where id = $1', [sid]);
    if (!s) throw new BadRequestException('That code is not valid');
    const current = Math.floor(Date.now() / WINDOW_MS);
    const okWindow = win === current || win === current - 1; // one window of grace for slow scans
    if (!okWindow || !this.crypto.safeEqual(mac, this.crypto.hmac(s.qr_secret, `${sid}.${win}`))) throw new BadRequestException('That code has expired. Scan the code on the screen again.');

    const now = Date.now();
    if (now < new Date(s.starts_at).getTime() - EARLY_MS || now > new Date(s.ends_at).getTime()) throw new ConflictException('Check-in is not open for this session');
    const enrolled = await this.db.one(`select 1 from enrollments where programme_id = $1 and trainee_id = $2 and status = 'confirmed'`, [s.programme_id, u.id]);
    if (!enrolled) throw new ForbiddenException('You are not confirmed on this programme');

    const status = now > new Date(s.starts_at).getTime() + LATE_AFTER_MS ? 'late' : 'present';
    return this.db.tx(async (q) => {
      const prev = await q.one<any>('select status from attendance where session_id = $1 and trainee_id = $2 for update', [sid, u.id]);
      if (prev && (prev.status === 'present' || prev.status === 'late')) return { status: prev.status, already: true };
      await q.query(
        `insert into attendance (session_id, trainee_id, status, method, marked_by, latitude, longitude) values ($1,$2,$3,'qr',$2,$4,$5)
         on conflict (session_id, trainee_id) do update set status = excluded.status, method = 'qr', marked_by = excluded.marked_by, marked_at = now(), latitude = excluded.latitude, longitude = excluded.longitude`,
        [sid, u.id, status, d.latitude ?? null, d.longitude ?? null]);
      await this.audit.log(q, actor, 'attendance.qr_checkin', 'session', sid, prev, { trainee_id: u.id, status });
      return { status, already: false };
    });
  }

  @Get('programmes/:id/attendance-summary')
  @Require('attendance:read')
  async summary(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    parse(uuid, id);
    const p = await this.db.one<any>('select id, lead_instructor_id from programmes where id = $1', [id]);
    if (!p) throw new NotFoundException();
    if (u.role === 'instructor' && p.lead_instructor_id !== u.id && !(await this.db.one('select 1 from sessions where programme_id = $1 and instructor_id = $2 limit 1', [id, u.id]))) throw new NotFoundException();
    const stats = await attendanceStats(this.db, id);
    const names = await this.db.query<{ id: string; full_name: string }>(`select t.id, t.full_name from enrollments e join users t on t.id = e.trainee_id where e.programme_id = $1`, [id]);
    const nameOf = new Map(names.map((n) => [n.id, n.full_name]));
    return stats.map((s) => ({ ...s, full_name: nameOf.get(s.trainee_id) })).sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)));
  }

  /** Staff see every session; instructors only their own (or those of a programme they lead). */
  private async sessionFor(u: AuthUser, id: string, forWrite: boolean) {
    const s = await this.db.one<any>(
      `select s.*, p.lead_instructor_id, p.code as programme_code, p.title as programme_title from sessions s join programmes p on p.id = s.programme_id where s.id = $1`, [id]);
    if (!s) throw new NotFoundException();
    if (u.role === 'instructor' && s.instructor_id !== u.id && s.lead_instructor_id !== u.id) throw new NotFoundException();
    if (forWrite && !isStaff(u) && u.role !== 'instructor') throw new ForbiddenException();
    return s;
  }
}

const uuidOk = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

@Module({ controllers: [AttendanceController] })
export class AttendanceModule {}
