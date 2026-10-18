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

/**
 * Headers that tell the API who the real client is. The shared secret proves the message comes from this app,
 * so the API can trust the address. Behind Cloudflare the real address is in cf-connecting-ip; otherwise the last
 * entry added by the hosting proxy is used (the leftmost can be forged by the visitor).
 */
export function clientHeaders(req: Request): Record<string, string> {
  const secret = process.env.PROXY_SHARED_SECRET;
  if (!secret) return {};
  const xff = (req.headers.get('x-forwarded-for') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  // Headers a visitor could forge are believed only while the origin lock (ORIGIN_LOCK_SECRET, see middleware.ts) is on and
  // TRUST_CLOUDFLARE=true: the lock guarantees every request came through our Cloudflare, which overwrites them.
  //  - x-haab-client-ip: set by our Cloudflare rule to ip.src. Preferred, because Render sits behind Cloudflare too, and its
  //    own Cloudflare layer can replace cf-connecting-ip with the address of ours.
  //  - cf-connecting-ip: used when the rule above is not set up.
  const trusted = process.env.TRUST_CLOUDFLARE === 'true' && !!process.env.ORIGIN_LOCK_SECRET;
  const own = trusted ? req.headers.get('x-haab-client-ip') : null;
  const cf = trusted ? req.headers.get('cf-connecting-ip') : null;
  const ip = own || cf || xff[xff.length - 1] || req.headers.get('x-real-ip');
  return ip ? { 'x-atmp-client-ip': ip, 'x-atmp-proxy-key': secret } : {};
}
