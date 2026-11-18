import { SignJWT, jwtVerify } from 'jose';
import type { ApiEnv } from '@farmplus/config/server';
import { unauthorized } from './errors';

const ISSUER = 'farmplus-api';
const AUDIENCE = 'farmplus';

export interface AccessClaims {
  userId: string;
  sessionId: string;
}

export class TokenSigner {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    readonly accessTtlSeconds: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  static fromEnv(env: ApiEnv): TokenSigner {
    return new TokenSigner(env.JWT_ACCESS_SECRET, env.ACCESS_TOKEN_TTL_SECONDS);
  }

  private sign(
    claims: Record<string, unknown>,
    subject: string,
    ttlSeconds: number,
  ): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(this.key);
  }

  signAccess(claims: AccessClaims): Promise<string> {
    return this.sign(
      { typ: 'access', sid: claims.sessionId },
      claims.userId,
      this.accessTtlSeconds,
    );
  }

  signMfa(userId: string): Promise<string> {
    return this.sign({ typ: 'mfa' }, userId, 300);
  }

  private async verify(token: string, typ: 'access' | 'mfa') {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (payload['typ'] !== typ || !payload.sub) throw new Error('wrong token type');
      return payload;
    } catch {
      throw unauthorized('Invalid or expired token', 'INVALID_TOKEN');
    }
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    const payload = await this.verify(token, 'access');
    const sid = payload['sid'];
    if (typeof sid !== 'string') throw unauthorized('Invalid or expired token', 'INVALID_TOKEN');
    return { userId: payload.sub as string, sessionId: sid };
  }

  /** Like `verifyAccess`, plus the token's expiry (epoch seconds) — long-lived connections must not outlive it. */
  async verifyAccessWithExpiry(token: string): Promise<AccessClaims & { exp: number }> {
    const payload = await this.verify(token, 'access');
    const sid = payload['sid'];
    if (typeof sid !== 'string' || typeof payload.exp !== 'number')
      throw unauthorized('Invalid or expired token', 'INVALID_TOKEN');
    return { userId: payload.sub as string, sessionId: sid, exp: payload.exp };
  }

  async verifyMfa(token: string): Promise<string> {
    return (await this.verify(token, 'mfa')).sub as string;
  }
}
