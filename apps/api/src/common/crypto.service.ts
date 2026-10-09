import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ENV, Env } from '../config';

@Injectable()
export class CryptoService {
  private readonly key: Buffer | null;

  constructor(@Inject(ENV) env: Env) {
    if (env.DATA_ENCRYPTION_KEY) {
      const k = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
      if (k.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes, base64 encoded');
      this.key = k;
    } else {
      // development only (production refuses to boot without a key, see config.ts)
      this.key = Buffer.alloc(32, 7);
    }
  }

  /** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext>, all base64url. */
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key!, iv);
    const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
  }

  decrypt(payload: string): string {
    const [v, iv, tag, data] = payload.split('.');
    if (v !== 'v1' || !iv || !tag || !data) throw new Error('unrecognised ciphertext');
    const d = createDecipheriv('aes-256-gcm', this.key!, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
  }

  mask(value: string): string {
    return value.length <= 4 ? '****' : `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;
  }

  token(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  hmac(secret: string, data: string): string {
    return createHmac('sha256', secret).update(data).digest('base64url');
  }

  safeEqual(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }
}
