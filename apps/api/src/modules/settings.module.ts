import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, Module, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ENV, Env } from '../config';
import { Actor, AuthUser } from '../common/auth.types';
import { AuditService } from '../common/audit.service';
import { Db } from '../common/db.service';
import { ActorCtx, CurrentUser, Require } from '../common/decorators';
import { INTEGRATION_BY_KEY } from '../common/integrations.registry';
import { IntegrationsService } from '../common/integrations.service';
import { Mailer } from '../common/mailer.service';
import { PERMISSIONS, ROLES } from '../common/permissions';
import { PAGE_BY_KEY, SETTINGS_PAGES } from '../common/settings.registry';
import { SettingsService } from '../common/settings.service';
import { MalwareScanner } from '../common/storage.service';
import { parse } from '../common/validation';

@Controller('settings')
export class SettingsController {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly settings: SettingsService, @Inject(ENV) private readonly env: Env) {}

  /** The System Setting menu for the signed-in user. Items they cannot open are marked read-only or left out. */
  @Get('pages')
  pages(@CurrentUser() u: AuthUser) {
    const forms = SETTINGS_PAGES.filter((p) => this.canRead(u, p)).map((p) => ({
      key: p.key, title: p.title, description: p.description, kind: 'form' as const, status: p.status,
      can_edit: p.status === 'active' && p.writeRoles.includes(u.role),
    }));
    const extra = [
      { key: 'roles', title: 'Roles Permissions', description: 'Who can do what. Fixed in the platform and reviewed by security.', kind: 'roles' as const, status: 'active' as const, can_edit: false },
      { key: 'certificate_templates', title: 'Certificate Templates', description: 'Layouts and signatories for certificates.', kind: 'link' as const, status: 'active' as const, can_edit: ['super_admin', 'training_admin'].includes(u.role) },
      { key: 'users', title: 'Users', description: 'Create and manage accounts.', kind: 'link' as const, status: 'active' as const, can_edit: ['super_admin', 'training_admin'].includes(u.role) },
      ...(u.role === 'super_admin' ? [{ key: 'integrations', title: 'API & Integrations', description: 'Keys and connections to outside services.', kind: 'integrations' as const, status: 'active' as const, can_edit: true }] : []),
    ];
    // same order as the reference menu: General first, system and security pages last
    return [...forms.slice(0, 1), ...extra.slice(3), ...forms.slice(1), ...extra.slice(0, 3)];
  }

  @Get('roles')
  roles(@CurrentUser() u: AuthUser) {
    if (!PERMISSIONS[u.role].has('settings:read')) throw new ForbiddenException();
    const perms = [...new Set(ROLES.flatMap((r) => [...PERMISSIONS[r]]))].sort();
    return { roles: ROLES, matrix: perms.map((p) => ({ permission: p, roles: ROLES.filter((r) => PERMISSIONS[r].has(p)) })) };
  }

  @Get('pages/:key')
  async page(@CurrentUser() u: AuthUser, @Param('key') key: string) {
    const def = PAGE_BY_KEY.get(key);
    if (!def || !this.canRead(u, def)) throw new NotFoundException();
    const values = await this.settings.get(key);
    return { key: def.key, title: def.title, description: def.description, status: def.status, fields: def.fields, values, can_edit: def.status === 'active' && def.writeRoles.includes(u.role) };
  }

  @Put('pages/:key')
  async save(@CurrentUser() u: AuthUser, @Param('key') key: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    const def = PAGE_BY_KEY.get(key);
    if (!def || !this.canRead(u, def)) throw new NotFoundException();
    if (def.status !== 'active') throw new ConflictException('This setting is not available yet');
    if (!def.writeRoles.includes(u.role)) throw new ForbiddenException('You cannot change this setting');
    const schema = def.schema as z.ZodObject<any>;
    const patch = parse(schema.partial().strict(), body);
    return this.db.tx(async (q) => {
      const before = await this.settings.get(key, q);
      const after = { ...before, ...patch };
      await q.query(
        `insert into settings (key, value, updated_by) values ($1,$2,$3) on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
        [key, JSON.stringify(after), u.id]);
      await this.audit.log(q, actor, 'settings.update', 'settings', key, before, after);
      return after;
    });
  }

  /** Anyone who may read settings generally, plus the roles that own a page (finance owns payment methods and currency). */
  private canRead(u: AuthUser, def: { writeRoles: string[] }) {
    return PERMISSIONS[u.role].has('settings:read') || def.writeRoles.includes(u.role);
  }

  /** What the host provides. These start the application, so they are not editable here. */
  @Get('system-status')
  @Require('integrations:manage')
  async systemStatus() {
    let database = false;
    try { database = Boolean(await this.db.one('select 1')); } catch { /* reported as down */ }
    const host = (v?: string) => { try { return v ? new URL(v).host : null; } catch { return null; } };
    return {
      environment: this.env.NODE_ENV,
      database: { connected: database, note: 'Set by the host (DATABASE_URL).' },
      authentication: { mode: this.env.AUTH_MODE, provider_host: host(this.env.SUPABASE_URL), anon_key_set: Boolean(this.env.SUPABASE_ANON_KEY), service_key_set: Boolean(this.env.SUPABASE_SERVICE_ROLE_KEY), note: 'Needed to sign anyone in, so set by the host.' },
      encryption: { master_key_set: Boolean(this.env.DATA_ENCRYPTION_KEY), note: 'Protects stored credentials and ID numbers. Held by the host and never shown.' },
      storage: { driver: this.env.STORAGE_DRIVER, bucket: this.env.STORAGE_DRIVER === 'supabase' ? this.env.SUPABASE_STORAGE_BUCKET : null },
      mfa_required_for: this.env.MFA_ROLES.split(',').map((s) => s.trim()).filter(Boolean),
    };
  }
}

const integrationBody = z.object({
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  secrets: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
}).strict();

@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService, private readonly mailer: Mailer, private readonly scanner: MalwareScanner, private readonly audit: AuditService) {}

  @Get()
  @Require('integrations:manage')
  list() {
    return this.integrations.overview();
  }

  @Put(':key')
  @Require('integrations:manage')
  async save(@Param('key') key: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    const d = parse(integrationBody, body);
    await this.integrations.save(key, d as any, actor);
    return (await this.integrations.overview()).find((i) => i.key === key);
  }

  @Post(':key/test')
  @Require('integrations:manage')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async test(@Param('key') key: string, @CurrentUser() u: AuthUser, @ActorCtx() actor: Actor) {
    const def = INTEGRATION_BY_KEY.get(key);
    if (!def) throw new NotFoundException();
    if (!def.testable) throw new BadRequestException('This integration cannot be tested yet');
    let ok = false;
    let message = '';
    try {
      if (key === 'email') { await this.mailer.sendTest(u.email); ok = true; message = `A test email was sent to ${u.email}.`; }
      else if (key === 'malware_scan') { ok = await this.scanner.ping(); message = ok ? 'The scanner answered.' : 'The scanner did not give the expected answer.'; }
    } catch (e: any) { message = e.message ?? 'The test failed.'; }
    await this.audit.log(null, actor, 'integration.test', 'integration', key, null, { ok });
    return { ok, message };
  }
}

@Module({ controllers: [SettingsController, IntegrationsController] })
export class SettingsModule {}
