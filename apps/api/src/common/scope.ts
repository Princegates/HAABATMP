import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthUser } from './auth.types';
import { Role } from './permissions';

export const isStaff = (u: AuthUser) => u.role === 'super_admin' || u.role === 'training_admin';
export const isReadOnlyAll = (u: AuthUser) => isStaff(u) || u.role === 'auditor';
/** Roles that may see every client's records. Everyone else is limited to their own organisation or themselves. */
export const seesAllClients = (u: AuthUser) => isReadOnlyAll(u) || u.role === 'finance_officer';

export function requireOrgScope(u: AuthUser): string {
  if (!u.organizationId) throw new ForbiddenException('Your account is not linked to an organisation');
  return u.organizationId;
}

/** Throws 404 (not 403) so the existence of another client's record is not revealed. */
export function assertSameOrg(u: AuthUser, orgId: string | null | undefined) {
  if (seesAllClients(u)) return;
  if (!orgId || orgId !== u.organizationId) throw new NotFoundException();
}

export function roleIn(u: AuthUser, ...roles: Role[]) {
  return roles.includes(u.role);
}
