import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, JWTPayload, SignJWT } from 'jose';
import { ENV, Env } from '../config';

export interface Claims extends JWTPayload {
  email?: string;
  aal?: 'aal1' | 'aal2';
}

const DEV_ISSUER = 'haab-atmp-dev';

@Injectable()
export class TokenService {
  private readonly devKey: Uint8Array;
  private readonly supabaseSecret?: Uint8Array;
  private readonly jwks?: ReturnType<typeof createRemoteJWKSet>;
  private readonly supabaseIssuer?: string;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.devKey = new TextEncoder().encode(env.DEV_JWT_SECRET);
    if (env.AUTH_MODE === 'supabase') {
      // Supabase signs tokens with this issuer. Only tokens it issued for this project are accepted.
      this.supabaseIssuer = env.SUPABASE_JWT_ISSUER ?? `${(env.SUPABASE_URL ?? '').replace(/\/+$/, '')}/auth/v1`;
      if (env.SUPABASE_JWT_SECRET) this.supabaseSecret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
      else this.jwks = createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
    }
  }

  private lastIssuerWarning = 0;
  private readonly log = new Logger(TokenService.name);

  /** Once a minute at most: the expected and the received issuer, so a mismatch is easy to read in the host's logs. */
  private warnIssuer(received: string) {
    if (Date.now() - this.lastIssuerWarning < 60_000) return;
    this.lastIssuerWarning = Date.now();
    this.log.warn(`Token issuer is "${received}" but "${this.supabaseIssuer}" is expected. Set SUPABASE_JWT_ISSUER to the first value, then SUPABASE_JWT_ISSUER_MODE=enforce.`);
  }

  async verify(token: string): Promise<Claims> {
    try {
      if (this.env.AUTH_MODE === 'dev') {
        const { payload } = await jwtVerify(token, this.devKey, { issuer: DEV_ISSUER, algorithms: ['HS256'] });
        return payload as Claims;
      }
      const opts = { audience: 'authenticated' };
      const { payload } = this.supabaseSecret
        ? await jwtVerify(token, this.supabaseSecret, { ...opts, algorithms: ['HS256'] })
        : await jwtVerify(token, this.jwks!, opts);
      if (payload.iss !== this.supabaseIssuer) {
        if (this.env.SUPABASE_JWT_ISSUER_MODE === 'enforce') throw new Error('unexpected issuer');
        this.warnIssuer(String(payload.iss));
      }
      return payload as Claims;
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }
  }

  /** Development only. Production boots with AUTH_MODE=supabase and cannot mint tokens. */
  async signDev(userId: string, email: string, hours = 8): Promise<string> {
    if (this.env.AUTH_MODE !== 'dev') throw new Error('dev tokens are disabled');
    return new SignJWT({ email })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(DEV_ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${hours}h`)
      .sign(this.devKey);
  }
}
