import { Body, Controller, Get, Module, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Actor, AuthUser } from '../common/auth.types';
import { AuditService } from '../common/audit.service';
import { Db } from '../common/db.service';
import { ActorCtx, CurrentUser, Require } from '../common/decorators';
import { assertSameOrg, seesAllClients } from '../common/scope';
import { pageQuery, parse, uuid } from '../common/validation';

const orgBody = z.object({
  name: z.string().trim().min(2).max(200),
  type: z.enum(['airline', 'airport', 'ground_handler', 'cargo_operator', 'security_organization', 'other']).default('other'),
  contact_name: z.string().trim().max(200).nullish(),
  contact_email: z.string().email().nullish(),
  contact_phone: z.string().trim().max(50).nullish(),
  address: z.string().trim().max(500).nullish(),
  billing_email: z.string().email().nullish(),
  billing_address: z.string().trim().max(500).nullish(),
  status: z.enum(['active', 'inactive']).default('active'),
});

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  @Get()
  @Require('orgs:read')
  async list(@CurrentUser() u: AuthUser, @Query() query: unknown) {
    const { q, limit, offset } = parse(pageQuery, query);
    const params: any[] = [];
    const where: string[] = [];
    if (!seesAllClients(u)) { params.push(u.organizationId); where.push(`o.id = $${params.length}`); }
    if (q) { params.push(`%${q}%`); where.push(`o.name ilike $${params.length}`); }
    const w = where.length ? `where ${where.join(' and ')}` : '';
    const rows = await this.db.query(
      `select o.*, (select count(*) from users x where x.organization_id = o.id and x.role = 'trainee') as trainee_count
         from organizations o ${w} order by o.name limit ${limit} offset ${offset}`, params);
    const total = (await this.db.one<{ n: number }>(`select count(*) n from organizations o ${w}`, params))!.n;
    return { data: rows, total };
  }

  @Get(':id')
  @Require('orgs:read')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    parse(uuid, id);
    assertSameOrg(u, id);
    const org = await this.db.one('select * from organizations where id = $1', [id]);
    if (!org) throw new NotFoundException();
    return org;
  }

  @Get(':id/summary')
  @Require('orgs:read')
  async summary(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    parse(uuid, id);
    assertSameOrg(u, id);
    return this.db.one(
      `select
         (select count(*) from users where organization_id = $1 and role = 'trainee' and status <> 'suspended') as trainees,
         (select count(*) from enrollments e join users t on t.id = e.trainee_id
            where t.organization_id = $1 and e.status in ('pending','confirmed')) as active_enrollments,
         (select count(*) from certificates c join users t on t.id = c.trainee_id
            where t.organization_id = $1 and c.status = 'valid' and (c.expires_at is null or c.expires_at >= current_date)) as valid_certificates,
         (select count(*) from certificates c join users t on t.id = c.trainee_id
            where t.organization_id = $1 and c.status = 'valid' and c.expires_at between current_date and current_date + 60) as expiring_60_days,
         (select coalesce(sum(total - amount_paid), 0) from invoices
            where organization_id = $1 and status in ('pending','partially_paid')) as outstanding_balance`, [id]);
  }

  @Post()
  @Require('orgs:write')
  async create(@Body() body: unknown, @ActorCtx() actor: Actor) {
    const d = parse(orgBody, body);
    return this.db.tx(async (q) => {
      const org = await q.one(
        `insert into organizations (name,type,contact_name,contact_email,contact_phone,address,billing_email,billing_address,status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
        [d.name, d.type, d.contact_name ?? null, d.contact_email ?? null, d.contact_phone ?? null, d.address ?? null, d.billing_email ?? null, d.billing_address ?? null, d.status]);
      await this.audit.log(q, actor, 'organization.create', 'organization', org.id, null, org);
      return org;
    });
  }

  @Patch(':id')
  @Require('orgs:write')
  async update(@Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const d = parse(orgBody.partial(), body);
    return this.db.tx(async (q) => {
      const before = await q.one('select * from organizations where id = $1 for update', [id]);
      if (!before) throw new NotFoundException();
      const merged = { ...before, ...d };
      const after = await q.one(
        `update organizations set name=$2,type=$3,contact_name=$4,contact_email=$5,contact_phone=$6,address=$7,
                billing_email=$8,billing_address=$9,status=$10 where id=$1 returning *`,
        [id, merged.name, merged.type, merged.contact_name, merged.contact_email, merged.contact_phone, merged.address, merged.billing_email, merged.billing_address, merged.status]);
      await this.audit.log(q, actor, 'organization.update', 'organization', id, before, after);
      return after;
    });
  }
}

@Module({ controllers: [OrganizationsController] })
export class OrganizationsModule {}
