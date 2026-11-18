import type { Types } from 'mongoose';
import type { AppContext } from '../context';
import { randomOtp, randomToken, sha256Hex } from '../lib/crypto';
import { badRequest, conflict } from '../lib/errors';
import { User, VerificationToken, type UserDoc, type VerificationPurpose } from '../models';
import { recordAudit } from './audit.service';

const TTL_MS: Record<VerificationPurpose, number> = {
  email_verify: 24 * 60 * 60 * 1000,
  phone_verify: 10 * 60 * 1000,
  password_reset: 30 * 60 * 1000,
};
const MAX_OTP_ATTEMPTS = 5;

export class VerificationService {
  constructor(private readonly ctx: AppContext) {}

  /** Replace any outstanding token of this purpose and return the new plaintext secret (to be delivered, never stored). */
  private async issue(
    userId: Types.ObjectId,
    purpose: VerificationPurpose,
    secret: string,
  ): Promise<void> {
    await VerificationToken.deleteMany({ userId, purpose });
    await VerificationToken.create({
      userId,
      purpose,
      tokenHash: sha256Hex(secret),
      expiresAt: new Date(Date.now() + TTL_MS[purpose]),
    });
  }

  async sendVerification(user: UserDoc, channel: 'email' | 'phone'): Promise<void> {
    if (channel === 'email') {
      if (!user.email) throw badRequest('No email on this account', 'NO_EMAIL');
      if (user.emailVerifiedAt) throw conflict('Email already verified', 'ALREADY_VERIFIED');
      const secret = randomToken();
      await this.issue(user._id, 'email_verify', secret);
      await this.ctx.notifier.send({
        channel: 'email',
        to: user.email,
        template: 'verify_email',
        secret,
      });
    } else {
      if (!user.phone) throw badRequest('No phone number on this account', 'NO_PHONE');
      if (user.phoneVerifiedAt) throw conflict('Phone already verified', 'ALREADY_VERIFIED');
      const secret = randomOtp();
      await this.issue(user._id, 'phone_verify', secret);
      await this.ctx.notifier.send({
        channel: 'sms',
        to: user.phone,
        template: 'verify_phone',
        secret,
      });
    }
  }

  async sendPasswordReset(user: UserDoc): Promise<void> {
    const secret = randomToken();
    await this.issue(user._id, 'password_reset', secret);
    if (user.email) {
      await this.ctx.notifier.send({
        channel: 'email',
        to: user.email,
        template: 'password_reset',
        secret,
      });
    } else if (user.phone) {
      await this.ctx.notifier.send({
        channel: 'sms',
        to: user.phone,
        template: 'password_reset',
        secret,
      });
    }
  }

  /** Consume a long random token (email verification, password reset). Returns the user id, or null. */
  async consumeToken(
    purpose: 'email_verify' | 'password_reset',
    secret: string,
  ): Promise<Types.ObjectId | null> {
    const doc = await VerificationToken.findOneAndUpdate(
      { purpose, tokenHash: sha256Hex(secret), usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
    );
    return doc ? doc.userId : null;
  }

  async confirmEmail(secret: string): Promise<void> {
    const userId = await this.consumeToken('email_verify', secret);
    if (!userId) throw badRequest('Invalid or expired verification link', 'INVALID_VERIFICATION');
    await this.markVerified(userId, 'email');
  }

  /**
   * Phone OTPs are only 6 digits, so each code is bound to one account (looked up by phone)
   * and dies after MAX_OTP_ATTEMPTS wrong guesses.
   */
  async confirmPhone(phone: string, code: string): Promise<void> {
    const invalid = () => badRequest('Invalid or expired code', 'INVALID_VERIFICATION');
    const user = await User.findOne({ phone }).select('_id');
    if (!user) throw invalid();
    // Take one attempt from the budget atomically before comparing, so parallel guesses cannot all
    // pass a check made on the same stale count.
    const doc = await VerificationToken.findOneAndUpdate(
      {
        userId: user._id,
        purpose: 'phone_verify',
        usedAt: null,
        expiresAt: { $gt: new Date() },
        attempts: { $lt: MAX_OTP_ATTEMPTS },
      },
      { $inc: { attempts: 1 } },
    );
    if (!doc || doc.tokenHash !== sha256Hex(code)) throw invalid();
    const claimed = await VerificationToken.updateOne(
      { _id: doc._id, usedAt: null },
      { $set: { usedAt: new Date() } },
    );
    if (claimed.modifiedCount === 0) throw invalid(); // a parallel request already used it
    await this.markVerified(doc.userId, 'phone');
  }

  private async markVerified(userId: Types.ObjectId, channel: 'email' | 'phone'): Promise<void> {
    const field = channel === 'email' ? 'emailVerifiedAt' : 'phoneVerifiedAt';
    await User.updateOne({ _id: userId }, { $set: { [field]: new Date() } });
    // Verification activates accounts that were waiting for it (never reactivates suspended ones).
    await User.updateOne(
      { _id: userId, status: 'pending_verification' },
      { $set: { status: 'active' } },
    );
    await recordAudit({
      actorId: userId,
      action: `auth.${channel}_verified`,
      targetType: 'user',
      targetId: userId,
    });
  }
}
