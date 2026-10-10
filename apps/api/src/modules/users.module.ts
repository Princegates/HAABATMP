import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, Module, NotFoundException,
  Param, Patch, Post, Put, Query, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { readTraineeSheet } from '../common/trainee-sheet';
import { z } from 'zod';
import { ENV, Env } from '../config';
import { Actor, AuthUser } from '../common/auth.types';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { Db, Q } from '../common/db.service';
import { ActorCtx, CurrentUser, Public, Require } from '../common/decorators';
import { serviceHeaders } from '../common/supabase';
import { NotifyService } from '../common/notify.service';
import { SettingsService } from '../common/settings.service';
import { Throttle } from '@nestjs/throttler';
import { CAN_CREATE_ROLES, ROLES, Role } from '../common/permissions';
import { isStaff, seesAllClients } from '../common/scope';
import { isoDate, pageQuery, parse, uuid } from '../common/validation';

const profileBody = z.object({
  employer: z.string().trim().max(200).nullish(),
  aviation_role: z.string().trim().max(200).nullish(),
  licence_number: z.string().trim().max(100).nullish(),
  licence_expiry: isoDate.nullish(),
  nationality: z.string().trim().max(100).nullish(),
  date_of_birth: isoDate.nullish(),
  id_type: z.string().trim().max(50).nullish(),
  id_number: z.string().trim().max(100).nullish(),
  qualifications: z.string().trim().max(3000).nullish(),
  emergency_contact: z.string().trim().max(300).nullish(),
});
const instructorBody = z.object({
  employment_type: z.enum(['employee', 'associate']).default('associate'),
  qualifications: z.string().trim().max(3000).nullish(),
  specialties: z.string().trim().max(1000).nullish(),
  accreditation_body: z.string().trim().max(200).nullish(),
  accreditation_expiry: isoDate.nullish(),
});
const createBody = z.object({
  email: z.string().email().max(200),
  full_name: z.string().trim().min(2).max(200),
  phone: z.string().trim().max(50).nullish(),
  role: z.enum(ROLES),
  organization_id: uuid.nullish(),
  profile: profileBody.optional(),
  instructor_profile: instructorBody.optional(),
});
const listQuery = pageQuery.extend({
  role: z.enum(ROLES).optional(),
  organization_id: z.union([uuid, z.literal('none')]).optional(), // 'none' = individuals with no organisation
  group: z.enum(['staff', 'client']).optional(), // HAAB staff or client-side users
  status: z.enum(['invited', 'active', 'suspended']).optional(),
});
const importBody = z.object({
  organization_id: uuid.nullish(),
  rows: z.array(z.object({
    email: z.string().email().max(200),
    full_name: z.string().trim().min(2).max(200),
    phone: z.string().trim().max(50).nullish(),
    aviation_role: z.string().trim().max(200).nullish(),
    employer: z.string().trim().max(200).nullish(),
  })).min(1).max(500),
});

/** Only these roles belong to a client organisation. Everyone else is HAAB staff. */
const CLIENT_ROLES: Role[] = ['trainee', 'org_admin'];
const PUBLIC_COLS = `u.id, u.email, u.full_name, u.phone, u.role, u.organization_id, u.status, u.last_login_at, u.created_at, o.name as organization_name`;

@Controller()
export class UsersController {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService,
    private readonly notify: NotifyService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ---------------------------------------------------------------- list / read

  @Get('users')
  @Require('users:read')
  async list(@CurrentUser() u: AuthUser, @Query() query: unknown) {
    const f = parse(listQuery, query);
    const params: any[] = [];
    const where: string[] = [];
    if (!seesAllClients(u)) {
      params.push(u.organizationId); where.push(`u.organization_id = $${params.length}`);
      where.push(`u.role = 'trainee'`); // client admins only ever see their own people
    }
    if (f.group === 'staff') where.push(`u.role not in ('trainee','org_admin')`);
    if (f.group === 'client') where.push(`u.role in ('trainee','org_admin')`);
    if (f.role) { params.push(f.role); where.push(`u.role = $${params.length}`); }
    if (f.status) { params.push(f.status); where.push(`u.status = $${params.length}`); }
    if (f.organization_id === 'none') { if (seesAllClients(u)) where.push('u.organization_id is null'); }
    else if (f.organization_id) { params.push(f.organization_id); where.push(`u.organization_id = $${params.length}`); }
    if (f.q) { params.push(`%${f.q}%`); where.push(`(u.full_name ilike $${params.length} or u.email ilike $${params.length})`); }
    const w = where.length ? `where ${where.join(' and ')}` : '';
    const data = await this.db.query(
      `select ${PUBLIC_COLS} from users u left join organizations o on o.id = u.organization_id ${w}
        order by o.name nulls last, u.full_name limit ${f.limit} offset ${f.offset}`, params);
    const total = (await this.db.one<{ n: number }>(`select count(*) n from users u ${w}`, params))!.n;
    return { data, total };
  }

  /** Trainee counts per organisation, plus individuals with none. Client admins only ever get their own row. */
  @Get('users/by-organization')
  @Require('users:read')
  async byOrganization(@CurrentUser() u: AuthUser) {
    const own = seesAllClients(u) ? null : u.organizationId;
    const orgs = await this.db.query(
      `select o.id as organization_id, o.name, o.type, o.status,
              count(t.id) filter (where t.status <> 'suspended') as trainees,
              count(t.id) filter (where t.status = 'invited') as invited
         from organizations o left join users t on t.organization_id = o.id and t.role = 'trainee'
        where ($1::uuid is null or o.id = $1) group by o.id order by o.name`, [own]);
    const individuals = own ? null : await this.db.one<{ n: number }>(`select count(*) n from users where role = 'trainee' and organization_id is null and status <> 'suspended'`);
    return { organizations: orgs, individuals: individuals?.n ?? null };
  }

  @Get('users/:id')
  @Require('users:read')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    parse(uuid, id);
    return this.load(u, id);
  }

  @Get('users/:id/profile')
  @Require('users:read')
  async getProfile(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('reveal') reveal: string | undefined, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const target = await this.load(u, id);
    return this.readProfile(target, reveal === 'true' && isStaff(u), actor);
  }

  @Put('users/:id/profile')
  @Require('users:write')
  async putProfile(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const target = await this.load(u, id);
    this.assertManageable(u, target);
    return this.db.tx(async (q) => {
      const result = await this.writeProfile(q, target.id, target.role, body);
      await this.audit.log(q, actor, 'user.profile_update', 'user', id, null, result);
      return result;
    });
  }

  /** The signed-in user's own trainee profile. */
  @Get('profile')
  async myProfile(@CurrentUser() u: AuthUser, @ActorCtx() actor: Actor) {
    const target = await this.db.one<any>('select * from users where id = $1', [u.id]);
    return this.readProfile(target, false, actor);
  }

  @Put('profile')
  async updateMyProfile(@CurrentUser() u: AuthUser, @Body() body: unknown, @ActorCtx() actor: Actor) {
    if (u.role !== 'trainee') throw new ForbiddenException('Only trainees edit their own profile here');
    return this.db.tx(async (q) => {
      const result = await this.writeProfile(q, u.id, 'trainee', body);
      await this.audit.log(q, actor, 'user.profile_update_self', 'user', u.id, null, result);
      return result;
    });
  }

  // ---------------------------------------------------------------- create / update

  @Post('users')
  @Require('users:write')
  async create(@CurrentUser() u: AuthUser, @Body() body: unknown, @ActorCtx() actor: Actor) {
    const d = parse(createBody, body);
    if (!CAN_CREATE_ROLES[u.role].includes(d.role)) throw new ForbiddenException(`You cannot create ${d.role} accounts`);
    let orgId = d.organization_id ?? null;
    if (!CLIENT_ROLES.includes(d.role)) {
      if (orgId) throw new BadRequestException('HAAB staff do not belong to a client organisation');
    } else if (u.role === 'org_admin') orgId = u.organizationId; // client admins can only add to their own organisation
    if (d.role === 'org_admin' && !orgId) throw new BadRequestException('An organisation administrator needs an organisation');
    if (orgId) await this.assertOrgExists(orgId);

    return this.db.tx(async (q) => {
      const user = await this.insertUser(q, { email: d.email, full_name: d.full_name, phone: d.phone ?? null, role: d.role, organization_id: orgId, created_by: u.id });
      if (d.role === 'trainee') await this.writeProfile(q, user.id, 'trainee', d.profile ?? {});
      if (d.role === 'instructor') await this.writeProfile(q, user.id, 'instructor', d.instructor_profile ?? {});
      await this.audit.log(q, actor, 'user.create', 'user', user.id, null, user);
      return user;
    });
  }

  // ---------------------------------------------------------------- trainee registration requests

  @Public()
  @Get('registration/status')
  async registrationStatus() {
    const s = await this.settings.get<{ enabled: boolean; notice: string }>('registration');
    return { enabled: s.enabled, notice: s.enabled ? s.notice : '' };
  }

  /** Public. Always answers the same way, so it cannot be used to find out who already has an account. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('registration')
  async requestAccount(@Body() body: unknown, @ActorCtx() actor: Actor) {
    const s = await this.settings.get<{ enabled: boolean }>('registration');
    if (!s.enabled) throw new NotFoundException();
    const d = parse(z.object({
      email: z.string().trim().email().max(200), full_name: z.string().trim().min(2).max(200),
      phone: z.string().trim().max(50).optional(), organisation: z.string().trim().max(200).optional(),
      website: z.string().max(200).optional(), // hidden field; only automated form-fillers complete it
    }), body);
    const reply = { ok: true, message: 'Thank you. Your request has been received. If it is approved, you will get an email with a link to choose your password.' };
    if (d.website) return reply;
    if (await this.db.one('select 1 from users where lower(email) = lower($1)', [d.email])) return reply;
    const pending = await this.db.one<{ n: number }>(`select count(*) n from registration_requests where status = 'pending'`);
    if ((pending?.n ?? 0) >= 500) return reply; // never let the queue grow without bound
    const row = await this.db.one<{ id: string }>(
      `insert into registration_requests (email, full_name, phone, organisation_text) values ($1,$2,$3,$4)
       on conflict (lower(email)) where status = 'pending' do nothing returning id`,
      [d.email, d.full_name, d.phone ?? null, d.organisation ?? null]);
    if (row) {
      await this.audit.log(null, { ...actor, email: d.email }, 'registration.request', 'registration_request', row.id, null, { full_name: d.full_name, organisation: d.organisation ?? null });
      const admins = await this.db.query<{ id: string }>(`select id from users where role in ('super_admin','training_admin') and status = 'active' limit 10`);
      for (const a of admins) {
        await this.notify.notify({ userId: a.id, kind: 'registration.request', subject: 'New trainee registration request',
          body: `${d.full_name} (${d.email}) has asked for a trainee account. Review it under Trainees > Registration requests.`, dedupeKey: `registration:${row.id}:${a.id}` });
      }
    }
    return reply;
  }

  @Get('registrations')
  @Require('users:write')
  async registrations(@CurrentUser() u: AuthUser, @Query() query: unknown) {
    if (!isStaff(u)) throw new ForbiddenException();
    const { status } = parse(z.object({ status: z.enum(['pending', 'approved', 'rejected']).default('pending') }), query);
    const data = await this.db.query(
      `select r.id, r.email, r.full_name, r.phone, r.organisation_text, r.status, r.reject_reason, r.created_at, r.decided_at, d.full_name as decided_by_name
         from registration_requests r left join users d on d.id = r.decided_by where r.status = $1 order by r.created_at desc limit 200`, [status]);
    return { data, total: data.length };
  }

  @Post('registrations/:id/approve')
  @Require('users:write')
  async approveRegistration(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    if (!isStaff(u)) throw new ForbiddenException();
    parse(uuid, id);
    const { organization_id } = parse(z.object({ organization_id: uuid.nullish() }), body);
    if (organization_id) await this.assertOrgExists(organization_id);
    return this.db.tx(async (q) => {
      const r = await q.one<any>('select * from registration_requests where id = $1 for update', [id]);
      if (!r) throw new NotFoundException();
      if (r.status !== 'pending') throw new ConflictException('This request has already been decided');
      const user = await this.insertUser(q, { email: r.email, full_name: r.full_name, phone: r.phone, role: 'trainee', organization_id: organization_id ?? null, created_by: u.id });
      await q.query(`insert into trainee_profiles (user_id, employer) values ($1,$2) on conflict (user_id) do nothing`, [user.id, r.organisation_text]);
      await q.query(`update registration_requests set status = 'approved', decided_by = $2, decided_at = now(), user_id = $3 where id = $1`, [id, u.id, user.id]);
      await this.audit.log(q, actor, 'registration.approve', 'registration_request', id, { status: 'pending' }, { status: 'approved', user_id: user.id, organization_id: organization_id ?? null });
      return user;
    });
  }

  @Post('registrations/:id/reject')
  @Require('users:write')
  async rejectRegistration(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    if (!isStaff(u)) throw new ForbiddenException();
    parse(uuid, id);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(500) }), body);
    return this.db.tx(async (q) => {
      const r = await q.one<any>('select * from registration_requests where id = $1 for update', [id]);
      if (!r) throw new NotFoundException();
      if (r.status !== 'pending') throw new ConflictException('This request has already been decided');
      await q.query(`update registration_requests set status = 'rejected', decided_by = $2, decided_at = now(), reject_reason = $3 where id = $1`, [id, u.id, reason]);
      await this.audit.log(q, actor, 'registration.reject', 'registration_request', id, { status: 'pending' }, { status: 'rejected', reason });
      return { ok: true };
    });
  }

  // ---------------------------------------------------------------- register trainees from an Excel list

  /** What the "Register trainees" screen offers: clients to attach people to, and the programmes this person may register them on. */
  @Get('trainees/register-options')
  @Require('trainees:register')
  async registerOptions(@CurrentUser() u: AuthUser) {
    const organizations = await this.db.query(`select id, name from organizations where status = 'active' order by name`);
    const open = `p.status in ('open_for_registration','registration_closed','ongoing')`;
    const programmes = isStaff(u)
      ? await this.db.query(`select p.id, p.code, p.title, p.start_date, p.end_date, p.organization_id from programmes p where ${open} order by p.start_date`)
      : await this.db.query(
          `select p.id, p.code, p.title, p.start_date, p.end_date, p.organization_id from programmes p
            where ${open} and (p.lead_instructor_id = $1 or exists (select 1 from sessions s where s.programme_id = p.id and s.instructor_id = $1)) order by p.start_date`, [u.id]);
    return { organizations, programmes };
  }

  /**
   * An Excel or CSV list of trainees. Without commit=true it only reads the file and says what would happen.
   * New people get an account and an invitation. People who already have a trainee account are not duplicated; their
   * ids come back too, so the screen can register everyone on a programme in the next step.
   */
  @Post('trainees/import-file')
  @Require('trainees:register')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async importTraineeFile(@CurrentUser() u: AuthUser, @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined, @Body() body: unknown, @ActorCtx() actor: Actor) {
    const d = parse(z.object({ organization_id: z.union([uuid, z.literal('')]).optional(), programme_id: z.union([uuid, z.literal('')]).optional(), commit: z.enum(['true', 'false']).default('false') }), body);
    const orgId = d.organization_id || null;
    const programmeId = d.programme_id || null;
    if (!file) throw new BadRequestException('Choose an Excel file (.xlsx) to upload');
    if (!/\.(xlsx|csv)$/i.test(file.originalname)) throw new BadRequestException('Only Excel .xlsx or CSV files are accepted. In Excel choose File > Save As > Excel Workbook (.xlsx).');
    if (orgId) await this.assertOrgExists(orgId);
    if (programmeId) {
      const p = await this.db.one<any>(`select id, status, lead_instructor_id from programmes where id = $1`, [programmeId]);
      if (!p) throw new BadRequestException('Unknown programme');
      if (!isStaff(u)) {
        const mine = p.lead_instructor_id === u.id || (await this.db.one('select 1 from sessions where programme_id = $1 and instructor_id = $2 limit 1', [programmeId, u.id]));
        if (!mine) throw new ForbiddenException('You can only register trainees on programmes you teach');
      }
    }
    let rows;
    try { rows = await readTraineeSheet(file.buffer, file.originalname); } catch (e: any) { throw new BadRequestException(e.message); }

    const found = await this.db.query<{ id: string; email: string; role: string; organization_id: string | null; status: string }>(
      `select id, lower(email) as email, role, organization_id, status from users where lower(email) = any($1::text[])`, [rows.map((r) => r.email).filter(Boolean)]);
    const byEmail = new Map(found.map((f) => [f.email, f]));
    const seen = new Set<string>();
    const items = rows.map((r) => {
      let status: 'new' | 'existing' | 'invalid' | 'duplicate' = 'new';
      const notes: string[] = [...r.problems];
      let existingId: string | null = null;
      if (r.problems.length) status = 'invalid';
      else if (seen.has(r.email)) { status = 'duplicate'; notes.push('This email appears twice in the file'); }
      else {
        const ex = byEmail.get(r.email);
        if (ex) {
          if (ex.role !== 'trainee') { status = 'invalid'; notes.push('This email belongs to someone who is not a trainee'); }
          else if (ex.status === 'suspended') { status = 'invalid'; notes.push('This trainee account is suspended'); }
          else { status = 'existing'; existingId = ex.id; notes.push(ex.organization_id === orgId ? 'Already has an account' : 'Already has an account, kept as it is'); }
        }
      }
      if (r.email) seen.add(r.email);
      return { ...r, status, notes, existing_id: existingId };
    });
    const summary = {
      total: items.length, new: items.filter((i) => i.status === 'new').length, existing: items.filter((i) => i.status === 'existing').length,
      skipped: items.filter((i) => i.status === 'invalid' || i.status === 'duplicate').length,
    };
    if (d.commit !== 'true') return { ...summary, rows: items, can_import: summary.new + summary.existing > 0 };

    const created: { id: string; email: string }[] = [];
    const failed: { email: string; reason: string }[] = [];
    for (const i of items.filter((x) => x.status === 'new')) {
      try {
        await this.db.tx(async (q) => {
          if (await q.one('select 1 from users where lower(email) = $1', [i.email])) throw new ConflictException('exists');
          const user = await this.insertUser(q, { email: i.email, full_name: i.full_name, phone: i.phone, role: 'trainee', organization_id: orgId, created_by: u.id });
          await this.writeProfile(q, user.id, 'trainee', { employer: i.employer, aviation_role: i.aviation_role });
          created.push({ id: user.id, email: user.email });
        });
      } catch (e: any) {
        failed.push({ email: i.email, reason: e instanceof ConflictException ? 'an account with this email already exists' : (e.response?.message ?? e.message ?? 'failed') });
      }
    }
    const trainee_ids = [...created.map((c) => c.id), ...items.filter((x) => x.status === 'existing').map((x) => x.existing_id!)];
    await this.audit.log(null, actor, 'trainee.import_file', 'user', null, null, { file: file.originalname.slice(0, 120), organization_id: orgId, programme_id: programmeId, created: created.length, existing: summary.existing, skipped: summary.skipped, failed: failed.length });
    return { ...summary, created: created.length, failed, trainee_ids };
  }

  @Post('users/import')
  @Require('users:write')
  async bulkImport(@CurrentUser() u: AuthUser, @Body() body: unknown, @ActorCtx() actor: Actor) {
    const d = parse(importBody, body);
    let orgId = d.organization_id ?? null;
    if (u.role === 'org_admin') orgId = u.organizationId;
    if (orgId) await this.assertOrgExists(orgId);
    if (!CAN_CREATE_ROLES[u.role].includes('trainee')) throw new ForbiddenException();

    const created: any[] = [];
    const skipped: { email: string; reason: string }[] = [];
    const warnings: { email: string; warning: string }[] = [];
    const seen = new Set<string>();
    for (const row of d.rows) {
      const key = row.email.toLowerCase();
      if (seen.has(key)) { skipped.push({ email: row.email, reason: 'duplicate row in file' }); continue; }
      seen.add(key);
      try {
        await this.db.tx(async (q) => {
          if (await q.one('select 1 from users where lower(email) = $1', [key])) throw new ConflictException('exists');
          const same = await q.one(
            'select 1 from users where lower(full_name) = lower($1) and organization_id is not distinct from $2', [row.full_name, orgId]);
          if (same) warnings.push({ email: row.email, warning: 'Someone with the same name already exists in this organisation' });
          const user = await this.insertUser(q, { email: row.email, full_name: row.full_name, phone: row.phone ?? null, role: 'trainee', organization_id: orgId, created_by: u.id });
          await this.writeProfile(q, user.id, 'trainee', { employer: row.employer, aviation_role: row.aviation_role });
          created.push({ id: user.id, email: user.email });
        });
      } catch (e: any) {
        skipped.push({ email: row.email, reason: e instanceof ConflictException ? 'an account with this email already exists' : (e.message ?? 'failed') });
      }
    }
    await this.audit.log(null, actor, 'user.bulk_import', 'user', null, null, { organization_id: orgId, created: created.length, skipped: skipped.length });
    return { created, skipped, warnings };
  }

  @Patch('users/:id')
  @Require('users:write')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const d = parse(z.object({
      full_name: z.string().trim().min(2).max(200),
      phone: z.string().trim().max(50).nullable(),
      organization_id: uuid.nullable(),
      role: z.enum(ROLES),
    }).partial(), body);
    const target = await this.load(u, id);
    this.assertManageable(u, target);
    if (d.role && d.role !== target.role) {
      if (u.role !== 'super_admin') throw new ForbiddenException('Only a super administrator can change roles');
      if (target.role === 'super_admin') await this.assertNotLastSuperAdmin(id);
    }
    if (d.organization_id !== undefined && u.role === 'org_admin') throw new ForbiddenException();
    const newRole = (d.role ?? target.role) as Role;
    if (!CLIENT_ROLES.includes(newRole) && d.organization_id) throw new BadRequestException('HAAB staff do not belong to a client organisation');
    if (newRole === 'org_admin' && (d.organization_id === null || (d.organization_id === undefined && !target.organization_id))) throw new BadRequestException('A client administrator needs an organisation');
    const staffNow = !CLIENT_ROLES.includes(newRole);
    return this.db.tx(async (q) => {
      const after = await q.one(
        `update users set full_name = coalesce($2, full_name), phone = case when $3 then $4 else phone end,
                organization_id = case when $5 then $6 else organization_id end, role = coalesce($7, role)
          where id = $1 returning id, email, full_name, phone, role, organization_id, status`,
        [id, d.full_name ?? null, 'phone' in d, d.phone ?? null, staffNow || 'organization_id' in d, staffNow ? null : d.organization_id ?? null, d.role ?? null]);
      await this.audit.log(q, actor, 'user.update', 'user', id, pickUser(target), after);
      return after;
    });
  }

  @Post('users/:id/suspend')
  @Require('users:write')
  async suspend(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(500) }), body);
    if (id === u.id) throw new BadRequestException('You cannot suspend your own account');
    const target = await this.load(u, id);
    this.assertManageable(u, target);
    if (target.role === 'super_admin') await this.assertNotLastSuperAdmin(id);
    return this.setStatus(id, 'suspended', target, actor, 'user.suspend', reason);
  }

  /** Emails the person a link to choose a new password. Nothing about their old password is revealed or changed. */
  @Post('users/:id/send-reset')
  @Require('users:write')
  async sendReset(@CurrentUser() u: AuthUser, @Param('id') id: string, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const target = await this.load(u, id);
    this.assertManageable(u, target);
    if (target.status === 'suspended') throw new BadRequestException('This account is suspended');
    if (this.env.AUTH_MODE === 'supabase') {
      const res = await fetch(`${this.env.SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(`${this.env.PUBLIC_WEB_URL}/set-password`)}`, {
        method: 'POST', headers: { apikey: this.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: target.email }),
      });
      if (!res.ok) throw new BadRequestException('The reset email could not be sent');
    }
    await this.audit.log(null, actor, 'user.password_reset_sent', 'user', id, null, { email: target.email });
    return { ok: true, note: this.env.AUTH_MODE === 'supabase' ? undefined : 'Development mode: nothing was sent.' };
  }

  /** For a lost phone: removes the person's authenticator so they can sign in with a password and set it up again. */
  @Post('users/:id/reset-mfa')
  @Require('users:write')
  async resetMfa(@CurrentUser() u: AuthUser, @Param('id') id: string, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const target = await this.load(u, id);
    this.assertManageable(u, target);
    if (id === u.id) throw new BadRequestException('Ask another administrator to reset your two-step sign-in');
    if (this.env.AUTH_MODE === 'supabase' && target.auth_user_id) {
      const base = `${this.env.SUPABASE_URL}/auth/v1/admin/users/${target.auth_user_id}/factors`;
      const headers = serviceHeaders(this.env.SUPABASE_SERVICE_ROLE_KEY);
      const list = await fetch(base, { headers });
      if (!list.ok) throw new BadRequestException('Could not read this person\'s authenticators');
      for (const f of (await list.json()) as any[]) {
        const r = await fetch(`${base}/${f.id}`, { method: 'DELETE', headers });
        if (!r.ok) throw new BadRequestException('Could not remove the authenticator');
      }
    }
    await this.db.query('update users set mfa_enrolled = false where id = $1', [id]);
    await this.audit.log(null, actor, 'user.mfa_reset', 'user', id, null, { email: target.email });
    return { ok: true };
  }

  @Post('users/:id/reactivate')
  @Require('users:write')
  async reactivate(@CurrentUser() u: AuthUser, @Param('id') id: string, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const target = await this.load(u, id);
    this.assertManageable(u, target);
    return this.setStatus(id, target.last_login_at ? 'active' : 'invited', target, actor, 'user.reactivate');
  }

  // ---------------------------------------------------------------- helpers

  private async setStatus(id: string, status: string, before: any, actor: Actor, action: string, reason?: string) {
    return this.db.tx(async (q) => {
      const after = await q.one('update users set status = $2 where id = $1 returning id, email, full_name, role, status', [id, status]);
      await this.audit.log(q, actor, action, 'user', id, { status: before.status }, { status, reason });
      return after;
    });
  }

  private async load(u: AuthUser, id: string) {
    const params: any[] = [id];
    let scope = '';
    if (!seesAllClients(u)) { params.push(u.organizationId); scope = `and u.organization_id = $2 and u.role = 'trainee'`; }
    const row = await this.db.one<any>(`select ${PUBLIC_COLS} from users u left join organizations o on o.id = u.organization_id where u.id = $1 ${scope}`, params);
    if (!row) throw new NotFoundException();
    return row;
  }

  /** Staff may only manage roles they are allowed to create; client admins stay inside their organisation. */
  private assertManageable(u: AuthUser, target: { role: Role; organization_id: string | null }) {
    if (!CAN_CREATE_ROLES[u.role].includes(target.role)) throw new ForbiddenException('You cannot manage this kind of account');
    if (u.role === 'org_admin' && target.organization_id !== u.organizationId) throw new NotFoundException();
  }

  private async assertNotLastSuperAdmin(id: string) {
    const n = await this.db.one<{ n: number }>(`select count(*) n from users where role = 'super_admin' and status <> 'suspended' and id <> $1`, [id]);
    if (!n || n.n < 1) throw new BadRequestException('There must always be at least one active super administrator');
  }

  private async assertOrgExists(id: string) {
    if (!(await this.db.one('select 1 from organizations where id = $1', [id]))) throw new BadRequestException('Unknown organisation');
  }

  private async insertUser(q: Q, d: { email: string; full_name: string; phone: string | null; role: Role; organization_id: string | null; created_by: string }) {
    let authUserId: string | null = null;
    if (this.env.AUTH_MODE === 'supabase') {
      // Invite-only: the identity provider emails the invitation. There is no public sign-up.
      const res = await fetch(`${this.env.SUPABASE_URL}/auth/v1/invite?redirect_to=${encodeURIComponent(`${this.env.PUBLIC_WEB_URL}/set-password`)}`, {
        method: 'POST',
        headers: { ...serviceHeaders(this.env.SUPABASE_SERVICE_ROLE_KEY), 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: d.email }),
      });
      if (!res.ok) throw new BadRequestException('The invitation could not be sent');
      authUserId = ((await res.json()) as any).id ?? null;
    }
    try {
      return await q.one<any>(
        `insert into users (email, full_name, phone, role, organization_id, status, auth_user_id, created_by)
         values ($1,$2,$3,$4,$5,'invited',$6,$7) returning id, email, full_name, phone, role, organization_id, status`,
        [d.email, d.full_name, d.phone, d.role, d.organization_id, authUserId, d.created_by]);
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictException('An account with this email already exists');
      throw e;
    }
  }

  private async writeProfile(q: Q, userId: string, role: Role, body: unknown) {
    if (role === 'trainee') {
      const p = parse(profileBody, body);
      const enc = p.id_number ? this.crypto.encrypt(p.id_number) : undefined;
      const row = await q.one(
        `insert into trainee_profiles (user_id, employer, aviation_role, licence_number, licence_expiry, nationality, date_of_birth, id_type, id_number_enc, qualifications, emergency_contact)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict (user_id) do update set employer=excluded.employer, aviation_role=excluded.aviation_role, licence_number=excluded.licence_number,
           licence_expiry=excluded.licence_expiry, nationality=excluded.nationality, date_of_birth=excluded.date_of_birth, id_type=excluded.id_type,
           id_number_enc=coalesce(excluded.id_number_enc, trainee_profiles.id_number_enc), qualifications=excluded.qualifications, emergency_contact=excluded.emergency_contact
         returning user_id, employer, aviation_role, licence_number, licence_expiry, nationality, date_of_birth, id_type, qualifications, emergency_contact`,
        [userId, p.employer ?? null, p.aviation_role ?? null, p.licence_number ?? null, p.licence_expiry ?? null, p.nationality ?? null, p.date_of_birth ?? null, p.id_type ?? null, enc ?? null, p.qualifications ?? null, p.emergency_contact ?? null]);
      return row;
    }
    if (role === 'instructor') {
      const p = parse(instructorBody, body);
      return q.one(
        `insert into instructor_profiles (user_id, employment_type, qualifications, specialties, accreditation_body, accreditation_expiry)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (user_id) do update set employment_type=excluded.employment_type, qualifications=excluded.qualifications,
           specialties=excluded.specialties, accreditation_body=excluded.accreditation_body, accreditation_expiry=excluded.accreditation_expiry
         returning *`,
        [userId, p.employment_type, p.qualifications ?? null, p.specialties ?? null, p.accreditation_body ?? null, p.accreditation_expiry ?? null]);
    }
    return null;
  }

  private async readProfile(target: any, reveal: boolean, actor: Actor) {
    if (target.role === 'instructor') return this.db.one('select * from instructor_profiles where user_id = $1', [target.id]);
    if (target.role !== 'trainee') return null;
    const p = await this.db.one<any>('select * from trainee_profiles where user_id = $1', [target.id]);
    if (!p) return null;
    const { id_number_enc, ...rest } = p;
    let id_number: string | null = null;
    if (id_number_enc) {
      const plain = this.crypto.decrypt(id_number_enc);
      id_number = reveal ? plain : this.crypto.mask(plain);
      if (reveal) await this.audit.log(null, actor, 'user.id_number_viewed', 'user', target.id);
    }
    return { ...rest, id_number };
  }
}

function pickUser(u: any) {
  return { id: u.id, email: u.email, full_name: u.full_name, phone: u.phone, role: u.role, organization_id: u.organization_id, status: u.status };
}

@Module({ controllers: [UsersController] })
export class UsersModule {}
