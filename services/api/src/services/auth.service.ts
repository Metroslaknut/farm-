import type { Types } from 'mongoose';
import type {
  AuthTokens,
  AuthenticatedResponse,
  LoginResponse,
  PublicUser,
} from '@farmplus/shared-types';
import type { LoginInput, RegisterInput } from '@farmplus/validation';
import type { Actor, AppContext, RequestMeta } from '../context';
import { randomToken, sha256Hex } from '../lib/crypto';
import { conflict, forbidden, unauthorized } from '../lib/errors';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../lib/password';
import {
  RefreshToken,
  Role,
  Session,
  User,
  UserRole,
  VerificationToken,
  type UserDoc,
} from '../models';
import { DEFAULT_ROLE_KEY } from '../rbac/definitions';
import { recordAudit } from './audit.service';
import { MfaService } from './mfa.service';
import { revokeAllSessions, revokeSession } from './session.service';
import { loadPublicUser } from './user.service';
import { VerificationService } from './verification.service';

const MAX_FAILED_LOGINS = 10;
const LOCK_MS = 15 * 60 * 1000;
const INVALID_CREDENTIALS = () => unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000
  );
}

export class AuthService {
  readonly mfa: MfaService;
  readonly verification: VerificationService;

  constructor(private readonly ctx: AppContext) {
    this.mfa = new MfaService(ctx);
    this.verification = new VerificationService(ctx);
  }

  /** Creates an account with the default (non-privileged) role only. Self-service can never pick roles. */
  async register(input: RegisterInput, meta: RequestMeta): Promise<PublicUser> {
    const identity = [
      ...(input.email ? [{ email: input.email }] : []),
      ...(input.phone ? [{ phone: input.phone }] : []),
    ];
    if (await User.exists({ $or: identity })) {
      throw conflict('An account with these details already exists', 'ACCOUNT_EXISTS');
    }
    let user: UserDoc;
    try {
      user = await User.create({
        ...(input.email ? { email: input.email } : {}),
        ...(input.phone ? { phone: input.phone } : {}),
        passwordHash: await hashPassword(input.password),
        displayName: input.displayName,
        status: this.ctx.env.AUTH_REQUIRE_VERIFICATION ? 'pending_verification' : 'active',
        passwordChangedAt: new Date(),
      });
    } catch (error) {
      if (isDuplicateKey(error))
        throw conflict('An account with these details already exists', 'ACCOUNT_EXISTS');
      throw error;
    }
    await this.grantDefaultRole(user._id);
    if (this.ctx.env.AUTH_REQUIRE_VERIFICATION) {
      if (user.email) await this.verification.sendVerification(user, 'email');
      else await this.verification.sendVerification(user, 'phone');
    }
    await recordAudit({
      actorId: user._id,
      action: 'auth.register',
      targetType: 'user',
      targetId: user._id,
      ip: meta.ip,
    });
    return loadPublicUser(user);
  }

  async grantDefaultRole(userId: Types.ObjectId): Promise<void> {
    const role = await Role.findOne({ key: DEFAULT_ROLE_KEY });
    if (role)
      await UserRole.updateOne(
        { userId, roleId: role._id },
        { $setOnInsert: { grantedBy: null } },
        { upsert: true },
      );
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<LoginResponse> {
    const identifier = input.identifier.trim();
    const user = await User.findOne(
      identifier.includes('@') ? { email: identifier.toLowerCase() } : { phone: identifier },
    );
    if (!user) {
      await verifyAgainstDummy(input.password);
      throw INVALID_CREDENTIALS();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await verifyAgainstDummy(input.password);
      throw INVALID_CREDENTIALS();
    }
    if (!(await verifyPassword(input.password, user.passwordHash))) {
      await this.registerFailure(user, meta);
      throw INVALID_CREDENTIALS();
    }
    this.assertCanAuthenticate(user);

    if (user.mfa.enabled) {
      return { status: 'mfa_required', mfaToken: await this.ctx.signer.signMfa(String(user._id)) };
    }
    return this.finishLogin(user, false, meta);
  }

  /**
   * Sign-in already proven by an external identity (Google/Facebook): the same account checks as a password login,
   * and MFA still applies when the account has it.
   */
  async loginVerifiedUser(user: UserDoc, meta: RequestMeta): Promise<LoginResponse> {
    this.assertCanAuthenticate(user);
    if (user.mfa.enabled) {
      return { status: 'mfa_required', mfaToken: await this.ctx.signer.signMfa(String(user._id)) };
    }
    return this.finishLogin(user, false, meta);
  }

  async completeMfaLogin(
    mfaToken: string,
    code: string,
    meta: RequestMeta,
  ): Promise<AuthenticatedResponse> {
    const userId = await this.ctx.signer.verifyMfa(mfaToken);
    const user = await User.findById(userId);
    if (!user || !user.mfa.enabled || (user.lockedUntil && user.lockedUntil > new Date())) {
      throw INVALID_CREDENTIALS();
    }
    this.assertCanAuthenticate(user);
    if (!(await this.mfa.verifyCode(user, code))) {
      await this.registerFailure(user, meta);
      throw unauthorized('Invalid verification code', 'INVALID_MFA_CODE');
    }
    return this.finishLogin(user, true, meta);
  }

  assertCanAuthenticate(user: UserDoc): void {
    if (user.status === 'suspended')
      throw forbidden('This account is suspended', 'ACCOUNT_SUSPENDED');
    if (user.status === 'deactivated')
      throw forbidden('This account is deactivated', 'ACCOUNT_DEACTIVATED');
    if (user.status === 'pending_verification') {
      throw forbidden(
        'Verify your email or phone number before signing in',
        'ACCOUNT_NOT_VERIFIED',
      );
    }
  }

  private async registerFailure(user: UserDoc, meta: RequestMeta): Promise<void> {
    // Count atomically and decide on the stored count, not on the copy read before the password check:
    // parallel attempts would otherwise all see the same count and never reach the lock.
    const counted = await User.findOneAndUpdate(
      { _id: user._id },
      { $inc: { failedLoginCount: 1 } },
      { returnDocument: 'after', projection: { failedLoginCount: 1 } },
    );
    let lock = false;
    if ((counted?.failedLoginCount ?? 0) >= MAX_FAILED_LOGINS) {
      const locked = await User.updateOne(
        { _id: user._id, failedLoginCount: { $gte: MAX_FAILED_LOGINS } },
        { $set: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MS) } },
      );
      lock = locked.modifiedCount > 0; // only one of several concurrent attempts records the lock
    }
    await recordAudit({
      actorId: user._id,
      action: lock ? 'auth.account_locked' : 'auth.login_failed',
      targetType: 'user',
      targetId: user._id,
      ip: meta.ip,
    });
  }

  private async finishLogin(
    user: UserDoc,
    mfaVerified: boolean,
    meta: RequestMeta,
  ): Promise<AuthenticatedResponse> {
    await User.updateOne(
      { _id: user._id },
      { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } },
    );
    const tokens = await this.createSession(user._id, mfaVerified, meta);
    await recordAudit({
      actorId: user._id,
      action: 'auth.login',
      targetType: 'user',
      targetId: user._id,
      ip: meta.ip,
      metadata: { mfa: mfaVerified },
    });
    return { status: 'authenticated', user: await loadPublicUser(user), tokens };
  }

  private async issueRefreshToken(
    sessionId: Types.ObjectId,
    userId: Types.ObjectId,
    expiresAt: Date,
  ): Promise<string> {
    const token = randomToken(48);
    await RefreshToken.create({ sessionId, userId, tokenHash: sha256Hex(token), expiresAt });
    return token;
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.ctx.env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  }

  private async createSession(
    userId: Types.ObjectId,
    mfaVerified: boolean,
    meta: RequestMeta,
  ): Promise<AuthTokens> {
    const expiresAt = this.refreshExpiry();
    const session = await Session.create({
      userId,
      mfaVerified,
      expiresAt,
      ...(meta.ip ? { ip: meta.ip } : {}),
      ...(meta.userAgent ? { userAgent: meta.userAgent.slice(0, 300) } : {}),
    });
    return this.tokensFor(
      session._id,
      userId,
      await this.issueRefreshToken(session._id, userId, expiresAt),
    );
  }

  private async tokensFor(
    sessionId: Types.ObjectId,
    userId: Types.ObjectId,
    refreshToken: string,
  ): Promise<AuthTokens> {
    return {
      tokenType: 'Bearer',
      accessToken: await this.ctx.signer.signAccess({
        userId: String(userId),
        sessionId: String(sessionId),
      }),
      expiresIn: this.ctx.signer.accessTtlSeconds,
      refreshToken,
    };
  }

  /** Single-use rotation. Re-presenting a used token means it leaked: the whole session is revoked. */
  async refresh(refreshToken: string, meta: RequestMeta): Promise<AuthTokens> {
    const invalid = () => unauthorized('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
    const now = new Date();
    const doc = await RefreshToken.findOne({ tokenHash: sha256Hex(refreshToken) });
    if (!doc) throw invalid();
    const session = await Session.findById(doc.sessionId);
    if (!session || session.revokedAt || session.expiresAt <= now) throw invalid();

    const claimed = doc.rotatedAt
      ? null
      : await RefreshToken.findOneAndUpdate(
          { _id: doc._id, rotatedAt: null },
          { $set: { rotatedAt: now } },
        );
    if (!claimed) {
      await revokeSession(session._id, 'refresh_token_reuse');
      await recordAudit({
        actorId: session.userId,
        action: 'auth.refresh_reuse_detected',
        targetType: 'session',
        targetId: session._id,
        ip: meta.ip,
      });
      throw invalid();
    }
    if (doc.expiresAt <= now) throw invalid();

    const user = await User.findById(session.userId);
    if (!user || user.status !== 'active') {
      await revokeSession(session._id, 'account_inactive');
      throw invalid();
    }
    const expiresAt = this.refreshExpiry();
    await Session.updateOne(
      { _id: session._id },
      { $set: { lastUsedAt: now, expiresAt, ...(meta.ip ? { ip: meta.ip } : {}) } },
    );
    return this.tokensFor(
      session._id,
      user._id,
      await this.issueRefreshToken(session._id, user._id, expiresAt),
    );
  }

  async logout(actor: Actor): Promise<void> {
    await revokeSession(actor.sessionId, 'logout');
    await recordAudit({
      actorId: actor.userId,
      action: 'auth.logout',
      targetType: 'session',
      targetId: actor.sessionId,
      ip: actor.ip,
    });
  }

  /**
   * A separate session for another browser tab of the same person (the tab hand-off, QA #14). Refresh tokens are
   * single-use, so a tab cannot share its own: the new tab gets a new session with the same second-factor state, which
   * can be listed and revoked like any other.
   */
  async handoffSession(actor: Actor, meta: RequestMeta): Promise<AuthTokens> {
    const user = await User.findById(actor.userId);
    if (!user || user.status !== 'active') throw unauthorized('Account is not active');
    const tokens = await this.createSession(user._id, actor.mfaVerified, meta);
    await recordAudit({
      actorId: actor.userId,
      action: 'auth.session_handoff',
      targetType: 'session',
      targetId: actor.sessionId,
      ip: meta.ip,
      metadata: { mfa: actor.mfaVerified },
    });
    return tokens;
  }

  async logoutAll(actor: Actor): Promise<void> {
    await revokeAllSessions(actor.userId, 'logout_all');
    await recordAudit({
      actorId: actor.userId,
      action: 'auth.logout_all',
      targetType: 'user',
      targetId: actor.userId,
      ip: actor.ip,
    });
  }

  async forgotPassword(identifier: string): Promise<void> {
    const id = identifier.trim();
    const user = await User.findOne(id.includes('@') ? { email: id.toLowerCase() } : { phone: id });
    // Same response and similar work whether or not the account exists (no enumeration).
    if (user && user.status !== 'deactivated') await this.verification.sendPasswordReset(user);
  }

  /** Always silent: never reveals whether the account exists or is already verified. */
  async resendVerification(identifier: string): Promise<void> {
    const id = identifier.trim();
    const byEmail = id.includes('@');
    const user = await User.findOne(byEmail ? { email: id.toLowerCase() } : { phone: id });
    if (!user || user.status === 'suspended' || user.status === 'deactivated') return;
    const verified = byEmail ? user.emailVerifiedAt : user.phoneVerifiedAt;
    if (!verified) await this.verification.sendVerification(user, byEmail ? 'email' : 'phone');
  }

  async resetPassword(token: string, newPassword: string, meta: RequestMeta): Promise<void> {
    const userId = await this.verification.consumeToken('password_reset', token);
    if (!userId) throw unauthorized('Invalid or expired reset token', 'INVALID_RESET_TOKEN');
    await User.updateOne(
      { _id: userId },
      {
        $set: {
          passwordHash: await hashPassword(newPassword),
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
        },
      },
    );
    await revokeAllSessions(userId, 'password_reset');
    await recordAudit({
      actorId: userId,
      action: 'auth.password_reset',
      targetType: 'user',
      targetId: userId,
      ip: meta.ip,
    });
  }

  async changePassword(
    user: UserDoc,
    actor: Actor,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw unauthorized('Current password is incorrect', 'INVALID_CREDENTIALS');
    }
    user.passwordHash = await hashPassword(newPassword);
    user.passwordChangedAt = new Date();
    await user.save();
    // A reset link requested before the change must not be able to undo it.
    await VerificationToken.deleteMany({ userId: user._id, purpose: 'password_reset' });
    await revokeAllSessions(user._id, 'password_changed', actor.sessionId);
    await recordAudit({
      actorId: user._id,
      action: 'auth.password_changed',
      targetType: 'user',
      targetId: user._id,
      ip: actor.ip,
    });
  }
}
