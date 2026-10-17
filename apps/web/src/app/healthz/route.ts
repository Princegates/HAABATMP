export const dynamic = 'force-dynamic';

/** For the host's health check. Reveals nothing. */
export function GET() {
  return new Response('ok', { headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
}
