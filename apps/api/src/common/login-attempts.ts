/**
 * Remembers wrong passwords so one account cannot be guessed at. Counted two ways:
 *  - per person and address: 5 wrong passwords in 10 minutes pauses that person on that address, so one classroom's
 *    typing mistakes never affect each other;
 *  - per person from anywhere: 30 wrong passwords in 10 minutes pauses sign-in for that email, which stops a guessing
 *    attack spread over many addresses, yet is high enough that a stranger cannot cheaply lock someone out.
 * It lives in this server's memory and resets on restart; the identity provider has its own limits behind it.
 */
const WINDOW_MS = 10 * 60_000;
const PER_ADDRESS = 5;
const PER_EMAIL = 30;
const MAX_KEYS = 20_000;

interface Entry { count: number; first: number }

export class LoginAttempts {
  private readonly seen = new Map<string, Entry>();
  constructor(private readonly now: () => number = Date.now) {}

  private keys(email: string, ip: string | null) {
    const e = email.trim().toLowerCase();
    return { pair: `p|${ip ?? '?'}|${e}`, email: `e|${e}` };
  }

  private live(key: string): Entry | undefined {
    const hit = this.seen.get(key);
    if (hit && this.now() - hit.first > WINDOW_MS) { this.seen.delete(key); return undefined; }
    return hit;
  }

  /** Whole seconds until sign-in is allowed again, or 0 when it is allowed now. */
  retryAfter(email: string, ip: string | null): number {
    const k = this.keys(email, ip);
    const waits = [[k.pair, PER_ADDRESS], [k.email, PER_EMAIL]].map(([key, max]) => {
      const e = this.live(key as string);
      return e && e.count >= (max as number) ? Math.ceil((e.first + WINDOW_MS - this.now()) / 1000) : 0;
    });
    return Math.max(...waits);
  }

  /** Records a wrong password. Returns true when this attempt is the one that triggered a pause. */
  failed(email: string, ip: string | null): boolean {
    if (this.seen.size >= MAX_KEYS) this.seen.clear();
    const k = this.keys(email, ip);
    let paused = false;
    for (const [key, max] of [[k.pair, PER_ADDRESS], [k.email, PER_EMAIL]] as const) {
      const e = this.live(key) ?? { count: 0, first: this.now() };
      e.count++;
      this.seen.set(key, e);
      if (e.count === max) paused = true;
    }
    return paused;
  }

  /** A correct password clears the count for that person on that address (not the all-addresses count). */
  succeeded(email: string, ip: string | null) {
    this.seen.delete(this.keys(email, ip).pair);
  }
}
