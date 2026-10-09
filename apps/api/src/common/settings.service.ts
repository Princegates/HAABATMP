import { Injectable } from '@nestjs/common';
import { Db, Q } from './db.service';
import { PAGE_BY_KEY } from './settings.registry';

export interface TrainingSettings {
  default_pass_mark: number;
  default_min_attendance_pct: number;
  certificate_expiring_soon_days: number;
  enforce_maker_checker: boolean;
}
export interface FinanceSettings {
  currency: string;
  tax_rate: number;
  require_payment_before_confirmation: boolean;
  invoice_due_days: number;
}

@Injectable()
export class SettingsService {
  constructor(private readonly db: Db) {}

  async get<T = any>(key: string, q?: Q): Promise<T> {
    const row = await (q ?? this.db).one<{ value: T }>('select value from settings where key = $1', [key]);
    // stored values override the registry defaults, so a newly added field is never undefined
    return { ...(PAGE_BY_KEY.get(key)?.defaults ?? {}), ...((row?.value as object) ?? {}) } as T;
  }

  private mfaCache: { at: number; roles: Set<string> } | null = null;

  /** Roles that must use two-step sign-in. Cached for a few seconds because the guard asks on every request. */
  async mfaRoles(): Promise<Set<string>> {
    if (this.mfaCache && Date.now() - this.mfaCache.at < 5000) return this.mfaCache.roles;
    const s = await this.get<{ mfa_required_roles: string[] }>('security');
    this.mfaCache = { at: Date.now(), roles: new Set(s.mfa_required_roles ?? []) };
    return this.mfaCache.roles;
  }
  forgetMfaRoles() { this.mfaCache = null; }

  training(q?: Q) { return this.get<TrainingSettings>('training', q); }
  finance(q?: Q) { return this.get<FinanceSettings>('finance', q); }
}
