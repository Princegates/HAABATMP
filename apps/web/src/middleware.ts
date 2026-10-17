import { NextRequest, NextResponse } from 'next/server';

/**
 * Origin lock. When ORIGIN_LOCK_SECRET is set, only requests that carry it are served. Cloudflare adds the header to every
 * request it forwards (a Transform Rule), so visitors who go round Cloudflare to the app's onrender.com address get a 403 and
 * never reach the firewall-free side door. Unset, nothing changes, so this can be deployed first and switched on later.
 * /healthz is exempt so the host's health check keeps working; it returns nothing but "ok".
 */
export function middleware(req: NextRequest) {
  const secret = process.env.ORIGIN_LOCK_SECRET;
  if (!secret || req.nextUrl.pathname === '/healthz') return NextResponse.next();
  const sent = req.headers.get('x-origin-lock') ?? '';
  let diff = sent.length ^ secret.length;
  for (let i = 0; i < secret.length; i++) diff |= (sent.charCodeAt(i) || 0) ^ secret.charCodeAt(i);
  if (diff !== 0) return new NextResponse('Forbidden', { status: 403, headers: { 'cache-control': 'no-store' } });
  return NextResponse.next();
}

// everything except Next's own static files, which carry no data
export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
