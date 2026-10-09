/**
 * Headers for calls made with the project's server key.
 * Legacy `service_role` keys are JWTs and go in both headers. The newer `sb_secret_...` keys are not JWTs,
 * so they must only be sent as `apikey`; sending one as a Bearer token is rejected.
 */
export function serviceHeaders(key: string | undefined): Record<string, string> {
  const k = key ?? '';
  return k.startsWith('sb_') ? { apikey: k } : { apikey: k, Authorization: `Bearer ${k}` };
}
