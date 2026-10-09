import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ENV, Env } from '../config';
import { Db } from './db.service';
import { IS_PUBLIC, NO_MFA, PERMS } from './decorators';
import { Permission, PERMISSIONS, Role } from './permissions';
import { TokenService } from './token.service';
import { AuthUser } from './auth.types';

interface UserRow {
  id: string; email: string; full_name: string; role: Role; organization_id: string | null; status: string; auth_user_id: string | null;
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly mfaRoles: Set<string>;

  constructor(
    private readonly reflector: Reflector,
    private readonly db: Db,
    private readonly tokens: TokenService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.mfaRoles = new Set(env.MFA_ROLES.split(',').map((s) => s.trim()).filter(Boolean));
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const handler = ctx.getHandler();
    const cls = ctx.getClass();
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [handler, cls])) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Sign in required');
    const claims = await this.tokens.verify(header.slice(7));

    const user = await this.resolveUser(claims.sub!, claims.email);
    const mfa = this.env.AUTH_MODE === 'dev' ? true : claims.aal === 'aal2';
    const authUser: AuthUser = {
      id: user.id, email: user.email, fullName: user.full_name, role: user.role,
      organizationId: user.organization_id, mfa,
    };
    req.user = authUser;

    // Privileged roles must have completed a second factor before touching anything else.
    if (this.mfaRoles.has(user.role) && !mfa && !this.reflector.getAllAndOverride<boolean>(NO_MFA, [handler, cls])) {
      throw new ForbiddenException({ message: 'Multi-factor authentication is required for your role', code: 'MFA_REQUIRED' });
    }

    const needed = this.reflector.getAllAndOverride<Permission[]>(PERMS, [handler, cls]);
    if (needed?.length) {
      const granted = PERMISSIONS[user.role];
      if (!needed.some((p) => granted.has(p))) throw new ForbiddenException('You do not have permission to do this');
    }
    return true;
  }

  private async resolveUser(sub: string, email?: string): Promise<UserRow> {
    let user: UserRow | null;
    if (this.env.AUTH_MODE === 'dev') {
      user = await this.db.one<UserRow>('select * from users where id = $1', [sub]);
    } else {
      // Matched by the identity id stored when the invitation was sent. Never by email address: anyone can type an
      // email into a sign-up form, so an email match would let them take over an invited person's profile.
      user = await this.db.one<UserRow>('select * from users where auth_user_id = $1', [sub]);
    }
    if (!user) throw new ForbiddenException('This account has not been provisioned. Contact your administrator.');
    if (user.status === 'suspended') throw new ForbiddenException('This account is suspended');
    return user;
  }
}
