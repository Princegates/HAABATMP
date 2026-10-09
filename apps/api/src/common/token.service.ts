import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
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

  constructor(@Inject(ENV) private readonly env: Env) {
    this.devKey = new TextEncoder().encode(env.DEV_JWT_SECRET);
    if (env.AUTH_MODE === 'supabase') {
      if (env.SUPABASE_JWT_SECRET) this.supabaseSecret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
      else this.jwks = createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
    }
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
