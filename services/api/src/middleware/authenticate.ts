import type { RequestHandler } from 'express';
import type { Actor, AppContext } from '../context';
import { unauthorized } from '../lib/errors';
import { Session, User } from '../models';
import { loadAccess } from '../rbac/access';

/**
 * Verifies an access token, then checks server-side state, so logout, suspension and role changes take effect
 * immediately instead of when the JWT expires. Shared by HTTP requests and realtime connections.
 */
export async function authenticateToken(
  ctx: Pick<AppContext, 'signer'>,
  token: string,
  ip?: string,
): Promise<Actor & { exp: number }> {
  const claims = await ctx.signer.verifyAccessWithExpiry(token);
  // Independent reads run together (one round trip instead of three); the checks below keep their order.
  const [session, user, access] = await Promise.all([
    Session.findById(claims.sessionId).lean(),
    User.findById(claims.userId).select('status').lean(),
    loadAccess(claims.userId),
  ]);
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt <= new Date() ||
    String(session.userId) !== claims.userId
  ) {
    throw unauthorized('Session is no longer valid', 'SESSION_REVOKED');
  }
  if (!user || user.status !== 'active')
    throw unauthorized('Account is not active', 'ACCOUNT_INACTIVE');

  return {
    userId: claims.userId,
    sessionId: claims.sessionId,
    mfaVerified: session.mfaVerified,
    access: access(session.mfaVerified),
    ...(ip ? { ip } : {}),
    exp: claims.exp,
  };
}

export function authenticate(ctx: AppContext): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get('authorization') ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match?.[1]) throw unauthorized();
    const { exp, ...actor } = await authenticateToken(ctx, match[1], req.ip);
    void exp; // the expiry only matters to long-lived connections
    req.actor = actor;
    next();
  };
}
