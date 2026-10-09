import { cookies } from 'next/headers';

export const API_URL = process.env.API_URL ?? 'http://localhost:4000';
export const ACCESS = 'atmp_at';
export const REFRESH = 'atmp_rt';

/** Tokens live only in httpOnly cookies. Browser scripts never see them, so an XSS bug cannot steal a session. */
export async function setSession(tokens: { access_token: string; refresh_token?: string; expires_in?: number }) {
  const jar = await cookies();
  const base = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/' };
  jar.set(ACCESS, tokens.access_token, { ...base, maxAge: tokens.expires_in ?? 3600 });
  if (tokens.refresh_token) jar.set(REFRESH, tokens.refresh_token, { ...base, maxAge: 60 * 60 * 24 * 30 });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(ACCESS);
  jar.delete(REFRESH);
}

export async function accessToken() {
  return (await cookies()).get(ACCESS)?.value;
}
export async function refreshToken() {
  return (await cookies()).get(REFRESH)?.value;
}

/** Cross-site POSTs are refused: the Origin header, when present, must be this site. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.get('host'); } catch { return false; }
}
