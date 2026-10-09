import { NextRequest, NextResponse } from 'next/server';
import { accessToken, API_URL, clearSession, sameOrigin, setSession } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** Sign in. The API's tokens are stored in httpOnly cookies and never returned to the page. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ message: 'Cross-site request refused' }, { status: 403 });
  const res = await fetch(`${API_URL}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: await req.text() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(body, { status: res.status });
  await setSession(body);
  const { access_token, refresh_token, ...safe } = body;
  return NextResponse.json(safe);
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ message: 'Cross-site request refused' }, { status: 403 });
  const token = await accessToken();
  if (token) await fetch(`${API_URL}/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => undefined);
  await clearSession();
  return NextResponse.json({ ok: true });
}
