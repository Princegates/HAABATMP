import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, Module, NotFoundException,
  Param, Patch, Post, Put, Query,
} from '@nestjs/common';
import { z } from 'zod';
import { ENV, Env } from '../config';
import { Actor, AuthUser } from '../common/auth.types';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { Db, Q } from '../common/db.service';
import { ActorCtx, CurrentUser, Require } from '../common/decorators';
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
  organization_id: uuid.optional(),
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

const PUBLIC_COLS = `u.id, u.email, u.full_name, u.phone, u.role, u.organization_id, u.status, u.last_login_at, u.created_at, o.name as organization_name`;

@Controller()
export class UsersController {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
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
    if (f.role) { params.push(f.role); where.push(`u.role = $${params.length}`); }
    if (f.status) { params.push(f.status); where.push(`u.status = $${params.length}`); }
    if (f.organization_id) { params.push(f.organization_id); where.push(`u.organization_id = $${params.length}`); }
    if (f.q) { params.push(`%${f.q}%`); where.push(`(u.full_name ilike $${params.length} or u.email ilike $${params.length})`); }
    const w = where.length ? `where ${where.join(' and ')}` : '';
    const data = await this.db.query(
      `select ${PUBLIC_COLS} from users u left join organizations o on o.id = u.organization_id ${w}
        order by u.full_name limit ${f.limit} offset ${f.offset}`, params);
    const total = (await this.db.one<{ n: number }>(`select count(*) n from users u ${w}`, params))!.n;
    return { data, total };
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
    if (u.role === 'org_admin') orgId = u.organizationId; // client admins can only add to their own organisation
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
    return this.db.tx(async (q) => {
      const after = await q.one(
        `update users set full_name = coalesce($2, full_name), phone = case when $3 then $4 else phone end,
                organization_id = case when $5 then $6 else organization_id end, role = coalesce($7, role)
          where id = $1 returning id, email, full_name, phone, role, organization_id, status`,
        [id, d.full_name ?? null, 'phone' in d, d.phone ?? null, 'organization_id' in d, d.organization_id ?? null, d.role ?? null]);
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
      const res = await fetch(`${this.env.SUPABASE_URL}/auth/v1/invite`, {
        method: 'POST',
        headers: { apikey: this.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
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
