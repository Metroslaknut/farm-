import { Schema, model, type Types } from 'mongoose';

export const VERIFICATION_PURPOSES = ['email_verify', 'phone_verify', 'password_reset'] as const;
export type VerificationPurpose = (typeof VERIFICATION_PURPOSES)[number];

export interface VerificationTokenAttrs {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  purpose: VerificationPurpose;
  /** SHA-256 of the token / OTP. */
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date | null;
  attempts: number;
}
const schema = new Schema<VerificationTokenAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    purpose: { type: String, enum: VERIFICATION_PURPOSES, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    usedAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'verification_tokens' },
);
schema.index({ userId: 1, purpose: 1 });
schema.index({ tokenHash: 1 });
export const VerificationToken = model<VerificationTokenAttrs>('VerificationToken', schema);
