import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, Env } from '../config';

@Injectable()
export class Mailer {
  private readonly log = new Logger(Mailer.name);
  constructor(@Inject(ENV) private readonly env: Env) {}

  get configured() {
    return Boolean(this.env.RESEND_API_KEY);
  }

  /** Throws on failure so the outbox can retry. In development without a key the message is logged. */
  async send(to: string, subject: string, text: string): Promise<void> {
    if (!this.env.RESEND_API_KEY) {
      if (this.env.NODE_ENV === 'production') throw new Error('RESEND_API_KEY is not configured');
      this.log.log(`[mail:dev] to=${to} subject="${subject}"`);
      return;
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.env.MAIL_FROM, to: [to], subject, text }),
    });
    if (!res.ok) throw new Error(`mail provider ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
