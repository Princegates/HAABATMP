const TZ = 'UTC'; // HAAB operates in Ghana (UTC+0 all year)

export function date(v?: string | Date | null) {
  if (!v) return '';
  const d = typeof v === 'string' ? new Date(v.length === 10 ? `${v}T00:00:00Z` : v) : v;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
}
export function time(v?: string | Date | null) {
  if (!v) return '';
  return new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}
export function dateTime(v?: string | Date | null) {
  return v ? `${date(v)}, ${time(v)}` : '';
}
export function money(n: number | string | null | undefined, currency = 'GHS') {
  const v = Number(n ?? 0);
  return `${currency} ${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export const num = (n: number | string | null | undefined) => Number(n ?? 0).toLocaleString('en-GB');
export const pct = (n: number | string | null | undefined, digits = 0) => (n === null || n === undefined || n === '' ? '' : `${Number(n).toFixed(digits)}%`);
export function label(s?: string | null) {
  if (!s) return '';
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
export const initials = (name?: string) => (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
export function isoDay(offset = 0) { return new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10); }
/** value for <input type="datetime-local"> in UTC */
export const toLocalInput = (v?: string | null) => (v ? new Date(v).toISOString().slice(0, 16) : '');
export const fromLocalInput = (v: string) => (v ? new Date(`${v}:00Z`).toISOString() : '');

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';
const TONES: Record<string, Tone> = {
  active: 'ok', valid: 'ok', paid: 'ok', pass: 'ok', confirmed: 'ok', completed: 'ok', present: 'ok', published: 'ok', marked: 'ok', open_for_registration: 'ok', sent: 'ok',
  pending: 'warn', partially_paid: 'warn', expiring_soon: 'warn', in_progress: 'warn', late: 'warn', waitlisted: 'warn', draft: 'warn', invited: 'warn', registration_closed: 'warn', submitted: 'warn', in_grace: 'warn', missing: 'danger',
  fail: 'danger', failed: 'danger', expired: 'danger', revoked: 'danger', cancelled: 'danger', absent: 'danger', suspended: 'danger', disqualified: 'danger', overdue: 'danger', refunded: 'info',
  ongoing: 'info', excused: 'info', closed: 'neutral', archived: 'neutral', inactive: 'neutral', retired: 'neutral', no_show: 'danger',
};
export const tone = (s?: string | null): Tone => TONES[s ?? ''] ?? 'neutral';
