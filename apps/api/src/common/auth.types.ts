import { Role } from './permissions';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  organizationId: string | null;
  mfaEnrolled: boolean; // the person has turned two-step sign-in on
  canFinalise?: boolean; // an instructor whom a Super Administrator has allowed to finalise results
  mfa: boolean; // true when the session was established with a second factor (aal2)
}

export interface Actor {
  id: string | null;
  email: string | null;
  role: string | null;
  ip: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}
