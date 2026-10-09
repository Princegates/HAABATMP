import { NextRequest, NextResponse } from 'next/server';
import { accessToken, API_URL, refreshToken, sameOrigin, setSession } from '@/lib/server';

export const dynamic = 'force-dynamic';

async function forward(req: NextRequest, path: string[], token?: string) {
  const url = `${API_URL}/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const headers: Record<string, string> = {};
  const type = req.headers.get('content-type');
  if (type) headers['content-type'] = type;
  if (token) headers.authorization = `Bearer ${token}`;
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  return fetch(url, { method: req.method, headers, body: hasBody ? await req.arrayBuffer() : undefined, redirect: 'manual' });
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!['GET', 'HEAD'].includes(req.method) && !sameOrigin(req)) return NextResponse.json({ message: 'Cross-site request refused' }, { status: 403 });
  const { path } = await ctx.params;
  // Sign-in, refresh and MFA go through /api/session so tokens only ever live in httpOnly cookies, never in page scripts.
  if (/^auth\/(login|refresh|mfa)/.test(path.join('/'))) return NextResponse.json({ message: 'Not found' }, { status: 404 });
  let token = await accessToken();
  let res = await forward(req, path, token);

  // an expired access token is renewed once with the refresh token, then the request is retried
  let renewed: { access_token: string; refresh_token?: string; expires_in?: number } | null = null;
  if (res.status === 401 && token) {
    const rt = await refreshToken();
    if (rt) {
      const r = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: rt }) });
      if (r.ok) { renewed = await r.json(); res = await forward(req, path, renewed!.access_token); }
    }
  }
  if (renewed) await setSession(renewed);

  const out = new Headers();
  for (const h of ['content-type', 'content-disposition', 'cache-control', 'x-content-type-options']) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  if (!out.has('cache-control')) out.set('cache-control', 'no-store');
  return new NextResponse(res.status === 204 ? null : res.body, { status: res.status, headers: out });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
