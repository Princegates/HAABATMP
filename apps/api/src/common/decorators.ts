import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { Actor, AuthUser } from './auth.types';
import { Permission } from './permissions';

export const IS_PUBLIC = 'isPublic';
export const PERMS = 'perms';
export const NO_MFA = 'noMfa';

export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Route needs at least one of these permissions. */
export const Require = (...perms: Permission[]) => SetMetadata(PERMS, perms);
/** Route is reachable by a privileged user who has not completed MFA yet (enrolment, status). */
export const AllowWithoutMfa = () => SetMetadata(NO_MFA, true);

export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<Request>().user as AuthUser;
});

export const ActorCtx = createParamDecorator((_d: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return {
    id: req.user?.id ?? null,
    email: req.user?.email ?? null,
    role: req.user?.role ?? null,
    ip: req.ip ?? null,
  };
});
