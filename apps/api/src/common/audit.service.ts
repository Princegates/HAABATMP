import { Injectable } from '@nestjs/common';
import { Db, Q } from './db.service';
import { Actor } from './auth.types';

@Injectable()
export class AuditService {
  constructor(private readonly db: Db) {}

  /**
   * Pass the transaction's `q` so the audit row commits or rolls back with the change it describes.
   * Sensitive fields are stripped before storage.
   */
  async log(
    q: Q | null,
    actor: Actor,
    action: string,
    entityType: string,
    entityId: string | null,
    before: unknown = null,
    after: unknown = null,
  ): Promise<void> {
    const runner = q ?? this.db;
    await runner.query(
      `insert into audit_logs (actor_id, actor_email, actor_role, action, entity_type, entity_id, ip, before_data, after_data)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        actor.id, actor.email, actor.role, action, entityType, entityId, actor.ip,
        before == null ? null : JSON.stringify(redact(before)),
        after == null ? null : JSON.stringify(redact(after)),
      ],
    );
  }
}

const SENSITIVE = /(password|secret|token|id_number|qr_secret)/i;
function redact(v: any): any {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, SENSITIVE.test(k) ? '[redacted]' : redact(val)]));
  }
  return v;
}
