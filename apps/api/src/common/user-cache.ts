import { Injectable } from '@nestjs/common';

/**
 * A few seconds of memory for "who is this signed-in person", so the sign-in check does not read the users table on every
 * request. Anything that changes a user (role, organisation, status, two-step sign-in, deletion) calls clear() right after it
 * commits, so on the same server the change is seen at once. Another server instance sees it within TTL_MS.
 */
const TTL_MS = 10_000;
const MAX_ENTRIES = 5_000;

@Injectable()
export class UserCache<T = any> {
  private readonly rows = new Map<string, { at: number; row: T }>();

  get(sub: string): T | null {
    const hit = this.rows.get(sub);
    if (!hit) return null;
    if (Date.now() - hit.at > TTL_MS) { this.rows.delete(sub); return null; }
    return hit.row;
  }

  set(sub: string, row: T) {
    if (this.rows.size >= MAX_ENTRIES) this.rows.clear();
    this.rows.set(sub, { at: Date.now(), row });
  }

  clear() { this.rows.clear(); }
}
