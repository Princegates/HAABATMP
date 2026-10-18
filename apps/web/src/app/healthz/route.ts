import { NextRequest } from 'next/server';
import { pickClientIp } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** Constant-time compare of the lock header with the secret. */
function hasLock(req: Request): boolean {
  const secret = process.env.ORIGIN_LOCK_SECRET;
  if (!secret) return false;
  const sent = req.headers.get('x-origin-lock') ?? '';
  let diff = sent.length ^ secret.length;
  for (let i = 0; i < secret.length; i++) diff |= (sent.charCodeAt(i) || 0) ^ secret.charCodeAt(i);
  return diff === 0;
}

/**
 * For the host's health check: reveals nothing. With ?diag=1 it also answers, but only to a request that carries the origin
 * lock secret (so only one that came through our own Cloudflare), which settings the app sees. Yes or no only, never an address.
 */
export function GET(req: NextRequest) {
  const plain = { headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } };
  if (req.nextUrl.searchParams.get('diag') !== '1' || !hasLock(req)) return new Response('ok', plain);
  const h = (name: string) => req.headers.has(name);
  const picked = pickClientIp(req);
  return Response.json({
    status: 'ok',
    release: (process.env.RENDER_GIT_COMMIT ?? 'unknown').slice(0, 7),
    origin_lock_on: true,
    trust_cloudflare_on: process.env.TRUST_CLOUDFLARE === 'true',
    proxy_secret_set: !!process.env.PROXY_SHARED_SECRET,
    request_has: { 'x-haab-client-ip': h('x-haab-client-ip'), 'cf-connecting-ip': h('cf-connecting-ip'), 'x-forwarded-for': h('x-forwarded-for') },
    address_taken_from: picked.source,
  }, { headers: { 'cache-control': 'no-store' } });
}
