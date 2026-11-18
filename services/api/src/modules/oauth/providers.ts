import { createHmac } from 'node:crypto';
import type { ApiEnv } from '@farmplus/config/server';
import type { OAuthProviderId } from '../../models';

/** What FARM+ keeps from a provider account. */
export interface OAuthProfile {
  subject: string;
  email: string | null;
  /** True only when the provider vouches for the address (Google `email_verified`). */
  emailVerified: boolean;
  name: string | null;
}

export class OAuthProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthProviderError';
  }
}

export interface OAuthProvider {
  id: OAuthProviderId;
  authorizeUrl(p: { state: string; codeChallenge: string; redirectUri: string }): string;
  /** Exchanges the authorization code server-to-server (with the client secret) and reads the profile. */
  exchange(p: { code: string; codeVerifier: string; redirectUri: string }): Promise<OAuthProfile>;
}

const TIMEOUT_MS = 10_000;

async function getJson(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new OAuthProviderError('The sign-in provider could not be reached');
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body)
    throw new OAuthProviderError(`The sign-in provider refused (${res.status})`);
  return body;
}
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

// ---------------------------------------------------------------------------
// Google (OpenID Connect, authorization code + PKCE)
// ---------------------------------------------------------------------------
export class GoogleProvider implements OAuthProvider {
  readonly id = 'google' as const;
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  authorizeUrl({
    state,
    codeChallenge,
    redirectUri,
  }: Parameters<OAuthProvider['authorizeUrl']>[0]) {
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.search = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return u.toString();
  }

  async exchange({ code, codeVerifier, redirectUri }: Parameters<OAuthProvider['exchange']>[0]) {
    const token = await getJson('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }),
    });
    const accessToken = str(token['access_token']);
    if (!accessToken) throw new OAuthProviderError('No access token from Google');
    // Read over TLS straight from Google with the token we just received: no ID token signature to trust from a third party.
    const me = await getJson('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const subject = str(me['sub']);
    if (!subject) throw new OAuthProviderError('Google did not return an account id');
    const email = str(me['email'])?.toLowerCase() ?? null;
    return {
      subject,
      email,
      emailVerified: Boolean(email) && me['email_verified'] === true,
      name: str(me['name']),
    };
  }
}

// ---------------------------------------------------------------------------
// Facebook Login (authorization code + PKCE; Graph calls signed with appsecret_proof)
// ---------------------------------------------------------------------------
const GRAPH = 'https://graph.facebook.com/v19.0';
export class FacebookProvider implements OAuthProvider {
  readonly id = 'facebook' as const;
  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
  ) {}

  authorizeUrl({
    state,
    codeChallenge,
    redirectUri,
  }: Parameters<OAuthProvider['authorizeUrl']>[0]) {
    const u = new URL('https://www.facebook.com/v19.0/dialog/oauth');
    u.search = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'public_profile,email',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }).toString();
    return u.toString();
  }

  async exchange({ code, codeVerifier, redirectUri }: Parameters<OAuthProvider['exchange']>[0]) {
    const tokenUrl = new URL(`${GRAPH}/oauth/access_token`);
    tokenUrl.search = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      redirect_uri: redirectUri,
      code,
      code_verifier: codeVerifier,
    }).toString();
    const token = await getJson(tokenUrl.toString());
    const accessToken = str(token['access_token']);
    if (!accessToken) throw new OAuthProviderError('No access token from Facebook');
    const meUrl = new URL(`${GRAPH}/me`);
    meUrl.search = new URLSearchParams({
      fields: 'id,name,email',
      access_token: accessToken,
      appsecret_proof: createHmac('sha256', this.appSecret).update(accessToken).digest('hex'),
    }).toString();
    const me = await getJson(meUrl.toString());
    const subject = str(me['id']);
    if (!subject) throw new OAuthProviderError('Facebook did not return an account id');
    // Facebook does not say whether the address was confirmed: never treated as verified.
    return {
      subject,
      email: str(me['email'])?.toLowerCase() ?? null,
      emailVerified: false,
      name: str(me['name']),
    };
  }
}

// ---------------------------------------------------------------------------
// Mock (development/tests only; refused in production by the env schema)
// ---------------------------------------------------------------------------
/**
 * The "provider" sends the browser straight back to the callback with a code that carries the profile:
 * `mock.<base64url(JSON profile)>`. Tests build their own codes; a plain `mock` code signs in a default dev profile.
 */
export class MockOAuthProvider implements OAuthProvider {
  constructor(readonly id: OAuthProviderId) {}

  authorizeUrl({ state, redirectUri }: Parameters<OAuthProvider['authorizeUrl']>[0]) {
    const u = new URL(redirectUri);
    u.searchParams.set('state', state);
    u.searchParams.set('code', 'mock');
    return u.toString();
  }

  async exchange({ code }: Parameters<OAuthProvider['exchange']>[0]): Promise<OAuthProfile> {
    if (code === 'mock')
      return {
        subject: `dev-${this.id}`,
        email: `dev-${this.id}@example.test`,
        emailVerified: this.id === 'google',
        name: `Dev ${this.id} user`,
      };
    if (code === 'mock.fail') throw new OAuthProviderError('Mock provider failure');
    try {
      const p = JSON.parse(Buffer.from(code.replace(/^mock\./, ''), 'base64url').toString('utf8'));
      return {
        subject: String(p.subject),
        email: p.email ? String(p.email).toLowerCase() : null,
        emailVerified: this.id === 'google' && p.emailVerified === true,
        name: p.name ? String(p.name) : null,
      };
    } catch {
      throw new OAuthProviderError('Bad mock code');
    }
  }
}

/** Providers configured in this environment (credentials set, or the mock in development/tests). */
export function createOAuthProviders(env: ApiEnv): Partial<Record<OAuthProviderId, OAuthProvider>> {
  if (env.OAUTH_MOCK)
    return { google: new MockOAuthProvider('google'), facebook: new MockOAuthProvider('facebook') };
  const out: Partial<Record<OAuthProviderId, OAuthProvider>> = {};
  if (env.OAUTH_GOOGLE_CLIENT_ID && env.OAUTH_GOOGLE_CLIENT_SECRET)
    out.google = new GoogleProvider(env.OAUTH_GOOGLE_CLIENT_ID, env.OAUTH_GOOGLE_CLIENT_SECRET);
  if (env.OAUTH_FACEBOOK_APP_ID && env.OAUTH_FACEBOOK_APP_SECRET)
    out.facebook = new FacebookProvider(env.OAUTH_FACEBOOK_APP_ID, env.OAUTH_FACEBOOK_APP_SECRET);
  return out;
}
