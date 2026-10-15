import { TokenService } from './token.service';

/**
 * Rate limits count requests per signed-in person rather than per network address. A classroom or an office shares one
 * address, so counting by address would lock a whole class out in the middle of an exam. The token is checked, not just
 * read, so nobody can pick another bucket by inventing a user id. Anything without a valid token (sign-in, registration,
 * certificate checks) is still counted by address.
 */
export function rateLimitTracker(tokens: TokenService) {
  return async (req: Record<string, any>): Promise<string> => {
    const header = req.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ') && header.length < 4200) {
      try {
        const claims = await tokens.verify(header.slice(7));
        if (claims.sub) {
          req.claims = claims; // the sign-in check reuses it, so the token is verified once per request
          return `user:${claims.sub}`;
        }
      } catch { /* an invalid or expired token is counted by address like any other visitor */ }
    }
    return req.ip;
  };
}
