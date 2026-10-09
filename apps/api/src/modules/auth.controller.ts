import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { ENV, Env } from '../config';
import { Actor, AuthUser } from '../common/auth.types';
import { AuditService } from '../common/audit.service';
import { Db } from '../common/db.service';
import { SettingsService } from '../common/settings.service';
import { ActorCtx, AllowWithoutMfa, CurrentUser, Public } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';
import { TokenService } from '../common/token.service';
import { parse } from '../common/validation';
import { timingSafeEqual } from 'node:crypto';

const loginSchema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly db: Db,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('login')
  async login(@Body() body: unknown, @ActorCtx() actorBase: Actor) {
    const { email, password } = parse(loginSchema, body);
    const fail = async (why: string) => {
      await this.audit.log(null, { ...actorBase, email }, 'auth.login_failed', 'user', null, null, { reason: why });
      throw new UnauthorizedException('Incorrect email or password');
    };

    if (this.env.AUTH_MODE === 'dev') {
      const user = await this.db.one<any>('select * from users where lower(email) = lower($1)', [email]);
      const a = Buffer.from(password);
      const b = Buffer.from(this.env.DEV_PASSWORD);
      const ok = a.length === b.length && timingSafeEqual(a, b);
      if (!user || !ok || user.status === 'suspended') return fail(!user ? 'unknown user' : user.status === 'suspended' ? 'suspended' : 'bad password');
      await this.db.query(`update users set last_login_at = now(), status = case when status='invited' then 'active' else status end where id = $1`, [user.id]);
      await this.audit.log(null, { id: user.id, email: user.email, role: user.role, ip: actorBase.ip }, 'auth.login', 'user', user.id);
      return { access_token: await this.tokens.signDev(user.id, user.email), expires_in: 8 * 3600, mfa_required: false };
    }

    const res = await fetch(`${this.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: this.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return fail('rejected by identity provider');
    const session: any = await res.json();
    const claims = await this.tokens.verify(session.access_token);
    const user = await this.db.one<any>('select * from users where auth_user_id = $1', [claims.sub]);
    if (!user || user.status === 'suspended') return fail('not provisioned or suspended');
    await this.db.query(`update users set last_login_at = now(), status = case when status = 'invited' then 'active' else status end where id = $1`, [user.id]);
    await this.audit.log(null, { id: user.id, email: user.email, role: user.role, ip: actorBase.ip }, 'auth.login', 'user', user.id);
    const factors: any[] = session.user?.factors ?? [];
    const verifiedFactor = factors.find((f: any) => f.status === 'verified');
    // Required when the Super Admin's list names the role, or the person turned it on for themselves.
    const enrolled = user.mfa_enrolled || Boolean(verifiedFactor);
    const needsMfa = enrolled || (await this.settings.mfaRoles()).has(user.role);
    return {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      mfa_required: needsMfa && claims.aal !== 'aal2',
      mfa_enrolled: Boolean(verifiedFactor),
      mfa_factor_id: verifiedFactor?.id ?? null,
    };
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  async refresh(@Body() body: unknown) {
    if (this.env.AUTH_MODE !== 'supabase') throw new BadRequestException('Not available in development mode');
    const { refresh_token } = parse(z.object({ refresh_token: z.string().min(10) }), body);
    const res = await fetch(`${this.env.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: this.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token }),
    });
    if (!res.ok) throw new UnauthorizedException('Session expired, please sign in again');
    const s: any = await res.json();
    return { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in };
  }

  /**
   * "Forgotten password". Always answers the same way, whether or not the address is registered, so it cannot be
   * used to find out who has an account.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot')
  async forgot(@Body() body: unknown, @ActorCtx() actor: Actor) {
    const { email } = parse(z.object({ email: z.string().email().max(200) }), body);
    if (this.env.AUTH_MODE === 'supabase') {
      const user = await this.db.one<any>(`select id from users where lower(email) = lower($1) and status <> 'suspended' and auth_user_id is not null`, [email]);
      if (user) {
        await this.sendRecovery(email);
        await this.audit.log(null, { ...actor, email }, 'auth.password_reset_requested', 'user', user.id);
      }
    }
    return { ok: true, message: 'If that address is registered, a link to set a new password is on its way.' };
  }

  /** Lets a person choose a password from the emailed invitation or reset link. The link's own token authorises it. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('set-password')
  async setPassword(@Body() body: unknown, @ActorCtx() actor: Actor) {
    if (this.env.AUTH_MODE !== 'supabase') throw new BadRequestException('Passwords are managed by the identity provider. This is not available in development mode.');
    const { access_token, password } = parse(z.object({ access_token: z.string().min(20).max(4000), password: z.string().min(12, 'Use at least 12 characters').max(200) }), body);
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) throw new BadRequestException('Use letters and at least one number');
    const claims = await this.tokens.verify(access_token);
    const user = await this.db.one<any>('select id, email, role, status from users where auth_user_id = $1', [claims.sub]);
    if (!user || user.status === 'suspended') throw new UnauthorizedException('This link is not valid');
    const res = await fetch(`${this.env.SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT', headers: { apikey: this.env.SUPABASE_ANON_KEY!, Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const detail: any = await res.json().catch(() => ({}));
      throw new BadRequestException(detail?.msg ?? detail?.message ?? 'The password could not be set. The link may have expired. Ask for a new one.');
    }
    await this.audit.log(null, { id: user.id, email: user.email, role: user.role, ip: actor.ip }, 'auth.password_set', 'user', user.id);
    return { ok: true };
  }

  /** Used by the admin "send password reset" action. */
  async sendRecovery(email: string) {
    await fetch(`${this.env.SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(`${this.env.PUBLIC_WEB_URL}/set-password`)}`, {
      method: 'POST', headers: { apikey: this.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
    }).catch(() => undefined);
  }

  @AllowWithoutMfa()
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const org = user.organizationId
      ? await this.db.one<{ id: string; name: string }>('select id, name from organizations where id = $1', [user.organizationId])
      : null;
    return {
      id: user.id, email: user.email, full_name: user.fullName, role: user.role,
      organization: org,
      permissions: [...PERMISSIONS[user.role]],
      mfa_required: user.mfaEnrolled || (await this.settings.mfaRoles()).has(user.role),
      mfa_required_by_policy: (await this.settings.mfaRoles()).has(user.role),
      mfa_enrolled: user.mfaEnrolled,
      mfa_verified: user.mfa,
      mfa_available: this.env.AUTH_MODE === 'supabase',
    };
  }

  /** Starts TOTP enrolment (Supabase). The user must be signed in. */
  @AllowWithoutMfa()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/enroll')
  async mfaEnroll(@Req() req: Request, @CurrentUser() user: AuthUser, @ActorCtx() actor: Actor) {
    this.requireSupabase();
    // Someone who already has two-step sign-in must prove it before adding another device.
    if (user.mfaEnrolled && !user.mfa) throw new ForbiddenException({ message: 'Two-step sign-in is required for your account', code: 'MFA_REQUIRED' });
    const res = await fetch(`${this.env.SUPABASE_URL}/auth/v1/factors`, {
      method: 'POST',
      headers: this.userHeaders(req),
      body: JSON.stringify({ factor_type: 'totp', friendly_name: `HAAB ${new Date().toISOString()}` }),
    });
    if (!res.ok) throw new BadRequestException('Could not start MFA enrolment');
    const f: any = await res.json();
    await this.audit.log(null, actor, 'auth.mfa_enroll_started', 'user', user.id);
    return { factor_id: f.id, qr_svg: f.totp?.qr_code, secret: f.totp?.secret, uri: f.totp?.uri };
  }

  /** Completes enrolment or satisfies the second factor at sign-in. Returns a session upgraded to aal2. */
  @AllowWithoutMfa()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/verify')
  async mfaVerify(@Req() req: Request, @Body() body: unknown, @CurrentUser() user: AuthUser, @ActorCtx() actor: Actor) {
    this.requireSupabase();
    const { factor_id, code } = parse(z.object({ factor_id: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }), body);
    const headers = this.userHeaders(req);
    const ch = await fetch(`${this.env.SUPABASE_URL}/auth/v1/factors/${factor_id}/challenge`, { method: 'POST', headers, body: '{}' });
    if (!ch.ok) throw new BadRequestException('Could not start MFA challenge');
    const { id: challenge_id }: any = await ch.json();
    const vr = await fetch(`${this.env.SUPABASE_URL}/auth/v1/factors/${factor_id}/verify`, {
      method: 'POST', headers, body: JSON.stringify({ challenge_id, code }),
    });
    if (!vr.ok) {
      await this.audit.log(null, actor, 'auth.mfa_failed', 'user', user.id);
      throw new UnauthorizedException('That code was not accepted');
    }
    const s: any = await vr.json();
    await this.db.query('update users set mfa_enrolled = true where id = $1 and not mfa_enrolled', [user.id]);
    await this.audit.log(null, actor, 'auth.mfa_verified', 'user', user.id);
    return { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in };
  }

  /** Turns two-step sign-in off for the signed-in person, unless the Super Admin requires it for their role. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('mfa/disable')
  async mfaDisable(@Req() req: Request, @CurrentUser() user: AuthUser, @ActorCtx() actor: Actor) {
    this.requireSupabase();
    if ((await this.settings.mfaRoles()).has(user.role)) throw new BadRequestException('Your administrator requires two-step sign-in for your role');
    const headers = this.userHeaders(req);
    const me = await fetch(`${this.env.SUPABASE_URL}/auth/v1/user`, { headers });
    if (!me.ok) throw new BadRequestException('Could not read your sign-in details');
    const factors: any[] = ((await me.json()) as any).factors ?? [];
    for (const f of factors) {
      const r = await fetch(`${this.env.SUPABASE_URL}/auth/v1/factors/${f.id}`, { method: 'DELETE', headers });
      if (!r.ok) throw new BadRequestException('Could not remove the authenticator');
    }
    await this.db.query('update users set mfa_enrolled = false where id = $1', [user.id]);
    await this.audit.log(null, actor, 'auth.mfa_disabled', 'user', user.id);
    return { ok: true };
  }

  @Post('logout')
  async logout(@Req() req: Request, @CurrentUser() user: AuthUser, @ActorCtx() actor: Actor) {
    await this.audit.log(null, actor, 'auth.logout', 'user', user.id);
    if (this.env.AUTH_MODE === 'supabase') {
      await fetch(`${this.env.SUPABASE_URL}/auth/v1/logout`, { method: 'POST', headers: this.userHeaders(req) }).catch(() => undefined);
    }
    return { ok: true };
  }

  private requireSupabase() {
    if (this.env.AUTH_MODE !== 'supabase') throw new BadRequestException('MFA is handled by Supabase Auth and is not available in development mode');
  }
  private userHeaders(req: Request) {
    return { apikey: this.env.SUPABASE_ANON_KEY!, Authorization: req.headers.authorization!, 'Content-Type': 'application/json' };
  }
}
