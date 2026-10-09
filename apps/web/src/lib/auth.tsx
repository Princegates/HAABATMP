'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, ApiError } from './api';

export interface Me {
  id: string; email: string; full_name: string; role: Role; organization: { id: string; name: string } | null;
  permissions: string[]; mfa_required: boolean; mfa_required_by_policy: boolean; mfa_enrolled: boolean; mfa_verified: boolean; mfa_available: boolean;
}
export type Role = 'super_admin' | 'training_admin' | 'instructor' | 'trainee' | 'org_admin' | 'finance_officer' | 'auditor';

interface AuthCtx { me: Me; can: (...perms: string[]) => boolean; is: (...roles: Role[]) => boolean; signOut: () => Promise<void> }
const Ctx = createContext<AuthCtx | null>(null);
export const useAuth = () => { const c = useContext(Ctx); if (!c) throw new Error('useAuth outside AuthProvider'); return c; };

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super administrator', training_admin: 'Training administrator', instructor: 'Instructor', trainee: 'Trainee',
  org_admin: 'Client administrator', finance_officer: 'Finance officer', auditor: 'Auditor',
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    let live = true;
    api.get<Me>('/auth/me').then((m) => {
      if (!live) return;
      // privileged roles must finish the second factor before anything else
      if (m.mfa_required && !m.mfa_verified) { router.replace('/login?step=mfa'); return; }
      setMe(m);
    }).catch((e: ApiError) => {
      if (!live) return;
      if (e.status === 403 && e.code === 'MFA_REQUIRED') router.replace('/login?step=mfa');
      else if (e.status !== 401) setFailed(e.message);
    });
    return () => { live = false; };
  }, [router, path === '/' ? 'root' : 'app']);

  const signOut = useCallback(async () => {
    await fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' }).catch(() => undefined);
    window.location.href = '/login';
  }, []);

  const value = useMemo<AuthCtx | null>(() => me && {
    me, signOut,
    can: (...perms) => perms.some((p) => me.permissions.includes(p)),
    is: (...roles) => roles.includes(me.role),
  }, [me, signOut]);

  if (failed) return <div className="verify"><div className="alert danger"><b>The platform could not be reached.</b><div className="muted">{failed}</div></div></div>;
  if (!value) return <div className="verify"><span className="muted">Loading…</span></div>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
