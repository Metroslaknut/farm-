import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  IDENTITY_VERIFICATION_STATUSES,
  SELLER_VERIFICATION_STATUSES,
  SUBSCRIPTION_STATUSES,
  USER_STATUSES,
  type IdentityVerificationStatus,
  type SellerVerificationStatus,
  type SubscriptionStatus,
  type UserStatus,
} from '@farmplus/shared-types';

export interface UserAttrs {
  _id: Types.ObjectId;
  email?: string;
  phone?: string;
  passwordHash: string;
  displayName: string;
  avatarUrl?: string | null;
  locale?: string | null;
  status: UserStatus;
  /** Separate from `status`: see shared-types/admin.ts. */
  identityVerification: IdentityVerificationStatus;
  sellerVerification: SellerVerificationStatus;
  subscriptionStatus: SubscriptionStatus;
  emailVerifiedAt?: Date | null;
  phoneVerifiedAt?: Date | null;
  failedLoginCount: number;
  lockedUntil?: Date | null;
  passwordChangedAt?: Date | null;
  lastLoginAt?: Date | null;
  mfa: {
    enabled: boolean;
    /** AES-256-GCM encrypted TOTP secret. */
    secretEnc?: string | null;
    pendingSecretEnc?: string | null;
    /** SHA-256 hashes of unused recovery codes. */
    recoveryCodeHashes: string[];
    lastUsedStep: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserAttrs>(
  {
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String, required: true, trim: true },
    avatarUrl: { type: String, default: null },
    locale: { type: String, default: null },
    status: { type: String, enum: USER_STATUSES, required: true, index: true },
    identityVerification: {
      type: String,
      enum: IDENTITY_VERIFICATION_STATUSES,
      default: 'unverified',
    },
    sellerVerification: { type: String, enum: SELLER_VERIFICATION_STATUSES, default: 'none' },
    subscriptionStatus: { type: String, enum: SUBSCRIPTION_STATUSES, default: 'none' },
    emailVerifiedAt: { type: Date, default: null },
    phoneVerifiedAt: { type: Date, default: null },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    mfa: {
      enabled: { type: Boolean, default: false },
      secretEnc: { type: String, default: null },
      pendingSecretEnc: { type: String, default: null },
      recoveryCodeHashes: { type: [String], default: [] },
      lastUsedStep: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

userSchema.index({ createdAt: 1 }); // analytics: registrations by date
// Partial indexes: only index fields that are actually present.
userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
);
userSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: 'string' } } },
);

export type UserDoc = HydratedDocument<UserAttrs>;
export const User = model<UserAttrs>('User', userSchema);
