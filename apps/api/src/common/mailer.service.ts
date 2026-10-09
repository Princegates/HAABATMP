import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, Env } from '../config';
import { IntegrationsService } from './integrations.service';
import { SettingsService } from './settings.service';

@Injectable()
export class Mailer {
  private readonly log = new Logger(Mailer.name);
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly integrations: IntegrationsService,
    private readonly settings: SettingsService,
  ) {}

  /** Throws on failure so the outbox can retry. In development without a key the message is logged. */
  async send(to: string, subject: string, text: string): Promise<void> {
    const cfg = await this.integrations.resolve('email');
    if (!cfg.enabled || !cfg.values.api_key) {
      if (this.env.NODE_ENV === 'production') throw new Error('Email is not configured. A super administrator can set it up under API & Integrations.');
      this.log.log(`[mail:dev] to=${to} subject="${subject}"`);
      return;
    }
    const look = await this.settings.get<{ from_name: string; reply_to: string; signature: string }>('email');
    const rawFrom = cfg.values.from_address || this.env.MAIL_FROM;
    const from = rawFrom.includes('<') || !look.from_name ? rawFrom : `${look.from_name} <${rawFrom}>`;
    const body = look.signature ? `${text}\n\n${look.signature}` : text;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.values.api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text: body, ...(look.reply_to ? { reply_to: look.reply_to } : {}) }),
    });
    if (!res.ok) throw new Error(`mail provider ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  /** Always really sends (no development shortcut), so "Test connection" proves the key works. */
  async sendTest(to: string): Promise<void> {
    const cfg = await this.integrations.resolve('email');
    if (!cfg.values.api_key) throw new Error('No API key is configured');
    const rawFrom = cfg.values.from_address || this.env.MAIL_FROM;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.values.api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: rawFrom, to: [to], subject: 'HAAB platform: email test', text: 'This confirms outgoing email is working.' }),
    });
    if (!res.ok) throw new Error(`The provider answered ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
}
