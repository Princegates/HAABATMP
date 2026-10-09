import { NextRequest, NextResponse } from 'next/server';
import { accessToken, API_URL, sameOrigin, setSession } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** Second factor: start enrolment (returns the QR code) or verify a code (upgrades the session). */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ message: 'Cross-site request refused' }, { status: 403 });
  const token = await accessToken();
  if (!token) return NextResponse.json({ message: 'Sign in required' }, { status: 401 });
  const input = await req.json().catch(() => ({}));
  const verify = input.action === 'verify';
  const res = await fetch(`${API_URL}/auth/mfa/${verify ? 'verify' : 'enroll'}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(verify ? { factor_id: input.factor_id, code: input.code } : {}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(body, { status: res.status });
  if (verify) { await setSession(body); return NextResponse.json({ ok: true }); }
  return NextResponse.json(body);
}
