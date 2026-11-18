import { randomBytes } from 'node:crypto';
import type { MfaEnableResponse, MfaSetupResponse } from '@farmplus/shared-types';
import type { Actor, AppContext } from '../context';
import { decryptSecret, encryptSecret, sha256Hex } from '../lib/crypto';
import { conflict, forbidden, unauthorized } from '../lib/errors';
import { verifyPassword } from '../lib/password';
import { otpauthUrl, generateTotpSecret, verifyTotp } from '../lib/totp';
import { Role, Session, User, UserRole, type UserDoc } from '../models';
import { recordAudit } from './audit.service';
import { revokeAllSessions } from './session.service';

const RECOVERY_CODE_COUNT = 10;
const normalizeRecovery = (code: string): string => code.trim().toLowerCase();

export class MfaService {
  constructor(private readonly ctx: AppContext) {}

  async setup(user: UserDoc): Promise<MfaSetupResponse> {
    if (user.mfa.enabled) throw conflict('MFA is already enabled', 'MFA_ALREADY_ENABLED');
    const secret = generateTotpSecret();
    user.mfa.pendingSecretEnc = encryptSecret(secret, this.ctx.mfaKey);
    await user.save();
    const account = user.email ?? user.phone ?? String(user._id);
    return { secret, otpauthUrl: otpauthUrl(secret, account, this.ctx.env.MFA_ISSUER) };
  }

  async enable(user: UserDoc, code: string, actor: Actor): Promise<MfaEnableResponse> {
    if (user.mfa.enabled) throw conflict('MFA is already enabled', 'MFA_ALREADY_ENABLED');
    if (!user.mfa.pendingSecretEnc) throw conflict('Start MFA setup first', 'MFA_SETUP_REQUIRED');
    const secret = decryptSecret(user.mfa.pendingSecretEnc, this.ctx.mfaKey);
    const step = verifyTotp(secret, code);
    if (step === null) throw unauthorized('Invalid verification code', 'INVALID_MFA_CODE');

    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const hex = randomBytes(5).toString('hex');
      return `${hex.slice(0, 5)}-${hex.slice(5)}`;
    });
    user.mfa.enabled = true;
    user.mfa.secretEnc = user.mfa.pendingSecretEnc;
    user.mfa.pendingSecretEnc = null;
    user.mfa.lastUsedStep = step;
    user.mfa.recoveryCodeHashes = recoveryCodes.map((c) => sha256Hex(c));
    await user.save();
    await Session.updateOne({ _id: actor.sessionId }, { $set: { mfaVerified: true } });
    await recordAudit({
      actorId: user._id,
      action: 'auth.mfa_enabled',
      targetType: 'user',
      targetId: user._id,
      ip: actor.ip,
    });
    return { recoveryCodes };
  }

  async disable(user: UserDoc, password: string, code: string, actor: Actor): Promise<void> {
    if (!user.mfa.enabled) throw conflict('MFA is not enabled', 'MFA_NOT_ENABLED');
    const adminRoles = await Role.find({
      _id: { $in: (await UserRole.find({ userId: user._id })).map((l) => l.roleId) },
      requiresMfa: true,
    });
    if (adminRoles.length > 0) {
      throw forbidden(
        'MFA cannot be disabled while you hold an administrator role',
        'MFA_REQUIRED_BY_ROLE',
      );
    }
    if (
      !(await verifyPassword(password, user.passwordHash)) ||
      !(await this.verifyCode(user, code))
    ) {
      throw unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');
    }
    user.mfa.enabled = false;
    user.mfa.secretEnc = null;
    user.mfa.pendingSecretEnc = null;
    user.mfa.recoveryCodeHashes = [];
    await user.save();
    await revokeAllSessions(user._id, 'mfa_disabled', actor.sessionId);
    await recordAudit({
      actorId: user._id,
      action: 'auth.mfa_disabled',
      targetType: 'user',
      targetId: user._id,
      ip: actor.ip,
    });
  }

  /** Accepts a TOTP code (single-use per step) or a recovery code (single-use). */
  async verifyCode(user: UserDoc, raw: string): Promise<boolean> {
    const code = raw.trim();
    if (/^\d{6}$/.test(code)) {
      if (!user.mfa.secretEnc) return false;
      const step = verifyTotp(decryptSecret(user.mfa.secretEnc, this.ctx.mfaKey), code);
      if (step === null) return false;
      // Atomic replay protection: a step can only ever be accepted once.
      const res = await User.updateOne(
        { _id: user._id, 'mfa.lastUsedStep': { $lt: step } },
        { $set: { 'mfa.lastUsedStep': step } },
      );
      return res.modifiedCount === 1;
    }
    const hash = sha256Hex(normalizeRecovery(code));
    const res = await User.updateOne(
      { _id: user._id, 'mfa.recoveryCodeHashes': hash },
      { $pull: { 'mfa.recoveryCodeHashes': hash } },
    );
    return res.modifiedCount === 1;
  }
}
