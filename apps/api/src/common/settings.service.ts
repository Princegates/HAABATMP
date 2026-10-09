import { Injectable } from '@nestjs/common';
import { Db, Q } from './db.service';

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
    return (row?.value ?? {}) as T;
  }

  training(q?: Q) { return this.get<TrainingSettings>('training', q); }
  finance(q?: Q) { return this.get<FinanceSettings>('finance', q); }
}
