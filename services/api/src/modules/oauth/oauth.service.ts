import { createHash } from 'node:crypto';
import type { LoginResponse } from '@farmplus/shared-types';
import type { AppContext, RequestMeta } from '../../context';
import { randomToken, safeEqual, sha256Hex } from '../../lib/crypto';
import { badRequest, notFound, unauthorized } from '../../lib/errors';
import { hashPassword } from '../../lib/password';
import { OAuthFlow, OAuthIdentity, User, type OAuthProviderId, type UserDoc } from '../../models';
import { recordAudit } from '../../services/audit.service';
import type { AuthService } from '../../services/auth.service';
import { OAuthProviderError, type OAuthProfile, type OAuthProvider } from './providers';

const FLOW_TTL_MS = 10 * 60_000; // time to finish at Google/Facebook
const TICKET_TTL_MS = 2 * 60_000; // time for the app to exchange its ticket
const s256 = (value: string) => createHash('sha256').update(value).digest('base64url');

/** Why a sign-in ended without a ticket; sent back to the client as `?error=<code>` (never any detail). */
export type OAuthErrorCode =
  'cancelled' | 'provider_error' | 'account_exists' | 'account_suspended' | 'account_deactivated';

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 11000;
}

export class OAuthService {
  constructor(
    private readonly ctx: AppContext,
    private readonly auth: AuthService,
    private readonly providers: Partial<Record<OAuthProviderId, OAuthProvider>>,
  ) {}

  enabled(): OAuthProviderId[] {
    return Object.keys(this.providers) as OAuthProviderId[];
  }

  private provider(id: string): OAuthProvider {
    const p = this.providers[id as OAuthProviderId];
    if (!p) throw notFound('This sign-in option is not available');
    return p;
  }

  private redirectUri(id: OAuthProviderId): string {
    return `${this.ctx.env.API_PUBLIC_URL}/api/v1/auth/oauth/${id}/callback`;
  }

  /** Step 1: remember the attempt and send the browser to the provider. */
  async start(providerId: string, input: { returnTo: string; challenge: string }): Promise<string> {
    const provider = this.provider(providerId);
    // Exact match against the allow-list: a sign-in can never be sent to an arbitrary site (open redirect).
    if (!this.ctx.env.OAUTH_RETURN_URLS.includes(input.returnTo))
      throw badRequest('This return address is not allowed', 'RETURN_URL_NOT_ALLOWED');
    const state = randomToken(32);
    const codeVerifier = randomToken(48);
    await OAuthFlow.create({
      provider: provider.id,
      stateHash: sha256Hex(state),
      codeVerifier,
      returnTo: input.returnTo,
      clientChallenge: input.challenge,
      expiresAt: new Date(Date.now() + FLOW_TTL_MS),
    });
    return provider.authorizeUrl({
      state,
      codeChallenge: s256(codeVerifier),
      redirectUri: this.redirectUri(provider.id),
    });
  }

  /**
   * Step 2: the provider sends the browser back. Returns where to send it next: the app's return URL with a one-time
   * `ticket`, or with an `error` code. An unknown, used or expired state has no trusted return URL: that is a 400.
   */
  async callback(
    providerId: string,
    q: { state?: string | undefined; code?: string | undefined; error?: string | undefined },
    meta: RequestMeta,
  ): Promise<string> {
    const provider = this.provider(providerId);
    if (!q.state) throw badRequest('This sign-in link is not valid', 'INVALID_STATE');
    // Single use: the state is claimed atomically, so a replayed callback finds nothing.
    const flow = await OAuthFlow.findOneAndUpdate(
      {
        stateHash: sha256Hex(q.state),
        provider: provider.id,
        status: 'started',
        expiresAt: { $gt: new Date() },
      },
      { $set: { status: 'callback' } },
      { returnDocument: 'after' },
    );
    if (!flow)
      throw badRequest('This sign-in link has expired. Please try again.', 'INVALID_STATE');
    const back = (params: Record<string, string>) => {
      const u = new URL(flow.returnTo);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      return u.toString();
    };
    const fail = async (code: OAuthErrorCode) => {
      await OAuthFlow.updateOne({ _id: flow._id }, { $set: { status: 'failed' } });
      return back({ error: code });
    };

    if (q.error || !q.code) return fail('cancelled');
    let profile: OAuthProfile;
    try {
      profile = await provider.exchange({
        code: q.code,
        codeVerifier: flow.codeVerifier,
        redirectUri: this.redirectUri(provider.id),
      });
    } catch (error) {
      if (error instanceof OAuthProviderError) return fail('provider_error');
      throw error;
    }

    const resolved = await this.resolveUser(provider.id, profile, meta);
    if (typeof resolved === 'string') {
      await recordAudit({
        actorId: null,
        action: 'auth.oauth_refused',
        targetType: 'user',
        ip: meta.ip,
        metadata: { provider: provider.id, reason: resolved },
      });
      return fail(resolved);
    }
    const ticket = randomToken(32);
    await OAuthFlow.updateOne(
      { _id: flow._id, status: 'callback' },
      {
        $set: {
          status: 'ticketed',
          ticketHash: sha256Hex(ticket),
          userId: resolved._id,
          expiresAt: new Date(Date.now() + TICKET_TTL_MS),
        },
      },
    );
    return back({ ticket });
  }

  /**
   * Step 3: the app trades its ticket for a session. The ticket is single-use and only works with the verifier whose
   * hash was given at step 1, so a ticket intercepted from a URL or deep link is useless on another device.
   */
  async exchange(
    input: { ticket: string; verifier: string },
    meta: RequestMeta,
  ): Promise<LoginResponse> {
    const flow = await OAuthFlow.findOneAndUpdate(
      { ticketHash: sha256Hex(input.ticket), status: 'ticketed', expiresAt: { $gt: new Date() } },
      { $set: { status: 'used' } },
      { returnDocument: 'after' },
    );
    const invalid = () =>
      unauthorized('This sign-in has expired. Please try again.', 'INVALID_TICKET');
    if (!flow || !flow.userId || !safeEqual(s256(input.verifier), flow.clientChallenge))
      throw invalid();
    const user = await User.findById(flow.userId);
    if (!user) throw invalid();
    await OAuthIdentity.updateOne(
      { userId: user._id, provider: flow.provider },
      { $set: { lastUsedAt: new Date() } },
    );
    return this.auth.loginVerifiedUser(user, meta);
  }

  /**
   * Which FARM+ account this provider account signs into:
   *  1. an account already linked to it;
   *  2. an existing account with the same email — linked automatically ONLY for a Google-verified address that the
   *     FARM+ account has verified too (anything else could hand someone else's pre-registered account to the caller,
   *     or hand this account to whoever pre-registered the address); otherwise refused with `account_exists`;
   *  3. a new account. A Facebook address is not bound to it (Facebook does not say it was confirmed).
   */
  private async resolveUser(
    provider: OAuthProviderId,
    profile: OAuthProfile,
    meta: RequestMeta,
    retry = true,
  ): Promise<UserDoc | OAuthErrorCode> {
    const linked = await OAuthIdentity.findOne({ provider, subject: profile.subject });
    if (linked) {
      const user = await User.findById(linked.userId);
      if (user) return this.usable(user);
      await OAuthIdentity.deleteOne({ _id: linked._id }); // the account was removed: start over
    }

    if (profile.email) {
      const existing = await User.findOne({ email: profile.email });
      if (existing) {
        const canLink =
          provider === 'google' && profile.emailVerified && Boolean(existing.emailVerifiedAt);
        if (!canLink) return 'account_exists';
        const usable = this.usable(existing);
        if (typeof usable === 'string') return usable;
        await this.link(provider, profile, existing, meta, 'auth.oauth_linked');
        return existing;
      }
    }

    const bindEmail = provider === 'google' && profile.emailVerified ? profile.email : null;
    let user: UserDoc;
    try {
      user = await User.create({
        ...(bindEmail ? { email: bindEmail, emailVerifiedAt: new Date() } : {}),
        // No password: the account signs in through the provider. A random hash nobody knows keeps the field required;
        // the owner can set a password later with "forgot password" (when the account has an email or phone).
        passwordHash: await hashPassword(randomToken(32)),
        displayName: (profile.name ?? 'สมาชิก FARM+').slice(0, 80),
        status: 'active',
        passwordChangedAt: null,
      });
    } catch (error) {
      // The same address signed up at the same moment: resolve again against what now exists.
      if (isDuplicateKey(error) && retry) return this.resolveUser(provider, profile, meta, false);
      throw error;
    }
    await this.auth.grantDefaultRole(user._id);
    await this.link(provider, profile, user, meta, 'auth.oauth_register');
    return user;
  }

  private usable(user: UserDoc): UserDoc | OAuthErrorCode {
    if (user.status === 'suspended') return 'account_suspended';
    if (user.status === 'deactivated') return 'account_deactivated';
    return user;
  }

  private async link(
    provider: OAuthProviderId,
    profile: OAuthProfile,
    user: UserDoc,
    meta: RequestMeta,
    action: 'auth.oauth_linked' | 'auth.oauth_register',
  ): Promise<void> {
    try {
      await OAuthIdentity.create({
        provider,
        subject: profile.subject,
        userId: user._id,
        email: profile.email,
        emailVerified: profile.emailVerified,
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error; // linked by a parallel callback for the same account
      return;
    }
    await recordAudit({
      actorId: user._id,
      action,
      targetType: 'user',
      targetId: user._id,
      ip: meta.ip,
      metadata: { provider },
    });
  }
}
