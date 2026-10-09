import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ENV, Env } from '../config';
import { Actor } from './auth.types';
import { AuditService } from './audit.service';
import { CryptoService } from './crypto.service';
import { Db } from './db.service';
import { INTEGRATION_BY_KEY, INTEGRATIONS, IntegrationDef } from './integrations.registry';

export interface Resolved {
  enabled: boolean;
  source: 'database' | 'environment' | 'none';
  values: Record<string, string>;
}

const TTL_MS = 20_000;

/**
 * Integration credentials. Super administrators manage them in the application; values are encrypted with the
 * host's master key. When nothing is stored the matching environment variables are used, so existing deployments
 * keep working. Secret values are never returned to the browser.
 */
@Injectable()
export class IntegrationsService {
  private readonly cache = new Map<string, { at: number; value: Resolved }>();

  constructor(
    private readonly db: Db, private readonly crypto: CryptoService, private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** For internal use: the decrypted values the platform needs to call the provider. */
  async resolve(key: string): Promise<Resolved> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const def = this.def(key);
    const row = await this.db.one<any>('select * from integrations where key = $1', [key]);
    let value: Resolved;
    if (row && (Object.keys(row.secrets).length || Object.keys(row.config).length)) {
      const values: Record<string, string> = {};
      for (const [k, v] of Object.entries(row.config)) values[k] = String(v);
      for (const [k, enc] of Object.entries<string>(row.secrets)) {
        try { values[k] = this.crypto.decrypt(enc); } catch { /* wrong master key: treat as unset rather than crash */ }
      }
      value = { enabled: row.enabled, source: 'database', values };
    } else {
      const values: Record<string, string> = {};
      for (const [field, envName] of Object.entries(def.env ?? {})) {
        const v = process.env[envName];
        if (v) values[field] = v;
      }
      value = Object.keys(values).length ? { enabled: true, source: 'environment', values } : { enabled: false, source: 'none', values: {} };
    }
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  /** For the browser: what is configured, without any secret value. */
  async overview() {
    const rows = new Map((await this.db.query<any>('select * from integrations')).map((r) => [r.key, r]));
    const out = [];
    for (const def of INTEGRATIONS) {
      const row = rows.get(def.key);
      const r = await this.resolve(def.key);
      out.push({
        key: def.key, title: def.title, description: def.description, status: def.status, testable: def.testable,
        enabled: r.enabled, source: r.source, secrets_updated_at: row?.secrets_updated_at ?? null,
        fields: def.fields.map((f) => {
          const v = r.values[f.name];
          return {
            name: f.name, label: f.label, type: f.type, help: f.help, required: f.required, options: f.options,
            configured: v !== undefined && v !== '',
            // secrets show only a short hint; everything else shows its value
            value: f.type === 'secret' ? undefined : v ?? null,
            hint: f.type === 'secret' && v ? (v.length >= 12 ? `ending ${v.slice(-4)}` : 'set') : undefined,
          };
        }),
      });
    }
    return out;
  }

  async save(key: string, input: { enabled?: boolean; config?: Record<string, unknown>; secrets?: Record<string, string | null> }, actor: Actor) {
    const def = this.def(key);
    const byName = new Map(def.fields.map((f) => [f.name, f]));
    const touched: string[] = [];
    const cleared: string[] = [];

    return this.db.tx(async (q) => {
      const row = await q.one<any>('select * from integrations where key = $1 for update', [key]);
      const config: Record<string, unknown> = { ...(row?.config ?? {}) };
      const secrets: Record<string, string> = { ...(row?.secrets ?? {}) };

      // moving from environment to the database keeps the values the host already supplies
      if (!row) {
        const current = await this.resolve(key);
        if (current.source === 'environment') {
          for (const [k, v] of Object.entries(current.values)) {
            if (byName.get(k)?.type === 'secret') secrets[k] = this.crypto.encrypt(v); else config[k] = v;
          }
        }
      }

      for (const [name, value] of Object.entries(input.config ?? {})) {
        const f = byName.get(name);
        if (!f || f.type === 'secret') throw new BadRequestException(`Unknown setting: ${name}`);
        if (value === null || value === '') { delete config[name]; cleared.push(name); continue; }
        if (f.type === 'number' && typeof value !== 'number') throw new BadRequestException(`${f.label} must be a number`);
        if (f.type === 'boolean' && typeof value !== 'boolean') throw new BadRequestException(`${f.label} must be true or false`);
        if (f.type === 'select' && !f.options?.some((o) => o.value === value)) throw new BadRequestException(`${f.label} has an unknown choice`);
        if ((f.type === 'text') && (typeof value !== 'string' || value.length > 300)) throw new BadRequestException(`${f.label} is too long`);
        config[name] = value;
        touched.push(name);
      }
      for (const [name, value] of Object.entries(input.secrets ?? {})) {
        const f = byName.get(name);
        if (!f || f.type !== 'secret') throw new BadRequestException(`Unknown secret: ${name}`);
        if (value === null) { delete secrets[name]; cleared.push(name); continue; }
        const v = value.trim();
        if (v.length < 4 || v.length > 500 || /\s/.test(v)) throw new BadRequestException(`${f.label} does not look like a valid key`);
        secrets[name] = this.crypto.encrypt(v);
        touched.push(name);
      }
      const enabled = input.enabled ?? row?.enabled ?? true;
      const missing = def.fields.filter((f) => f.required && !(f.type === 'secret' ? secrets[f.name] : config[f.name]));
      if (enabled && missing.length && def.status === 'active') throw new BadRequestException(`Required: ${missing.map((m) => m.label).join(', ')}`);

      await q.query(
        `insert into integrations (key, enabled, config, secrets, secrets_updated_at, updated_by)
         values ($1,$2,$3,$4, case when $5 then now() end, $6)
         on conflict (key) do update set enabled = excluded.enabled, config = excluded.config, secrets = excluded.secrets,
           secrets_updated_at = case when $5 then now() else integrations.secrets_updated_at end, updated_by = excluded.updated_by`,
        [key, enabled, JSON.stringify(config), JSON.stringify(secrets), touched.some((t) => byName.get(t)?.type === 'secret') || cleared.some((t) => byName.get(t)?.type === 'secret'), actor.id]);

      // The audit row names the fields that changed. It never contains a value.
      await this.audit.log(q, actor, 'integration.update', 'integration', key, { enabled: row?.enabled ?? null }, { enabled, fields_changed: touched, fields_cleared: cleared });

      // Tell the other super administrators: a credential change is exactly what an attacker would do.
      // Queued straight into the notifications tables: this service sits below the mailer, so it cannot depend on NotifyService.
      const others = await q.query<{ id: string; email: string }>(`select id, email from users where role = 'super_admin' and status = 'active' and id is distinct from $1`, [actor.id]);
      const subject = `Integration credentials changed: ${def.title}`;
      const body = `${actor.email ?? 'A super administrator'} changed the ${def.title} integration (${[...touched, ...cleared].join(', ') || 'status'}). If you do not recognise this, contact your security lead.`;
      for (const o of others) {
        await q.query(`insert into notifications (user_id, channel, kind, subject, body, status) values ($1,'in_app','integration.changed',$2,$3,'sent')`, [o.id, subject, body]);
        await q.query(`insert into notifications (user_id, to_email, channel, kind, subject, body, status) values ($1,$2,'email','integration.changed',$3,$4,'pending')`, [o.id, o.email, subject, body]);
      }
      return { ok: true };
    }).then((r) => { this.cache.delete(key); return r; });
  }

  private def(key: string): IntegrationDef {
    const d = INTEGRATION_BY_KEY.get(key);
    if (!d) throw new BadRequestException('Unknown integration');
    return d;
  }
}
