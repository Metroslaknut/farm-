import { Schema, model, type Types } from 'mongoose';

export interface SessionAttrs {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  mfaVerified: boolean;
  userAgent?: string;
  ip?: string;
  createdAt: Date;
  lastUsedAt: Date;
  /** Absolute session lifetime; document is removed by the TTL index afterwards. */
  expiresAt: Date;
  revokedAt?: Date | null;
  revokedReason?: string;
}
const sessionSchema = new Schema<SessionAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    mfaVerified: { type: Boolean, default: false },
    userAgent: { type: String, maxlength: 300 },
    ip: { type: String },
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String },
  },
  { collection: 'sessions' },
);
export const Session = model<SessionAttrs>('Session', sessionSchema);

export interface RefreshTokenAttrs {
  _id: Types.ObjectId;
  sessionId: Types.ObjectId;
  userId: Types.ObjectId;
  /** SHA-256 of the opaque token. The token itself is never stored. */
  tokenHash: string;
  expiresAt: Date;
  /** Set when exchanged for a new token; presenting it again signals theft. */
  rotatedAt?: Date | null;
  createdAt: Date;
}
const refreshTokenSchema = new Schema<RefreshTokenAttrs>(
  {
    sessionId: { type: Schema.Types.ObjectId, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    rotatedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'refresh_tokens' },
);
export const RefreshToken = model<RefreshTokenAttrs>('RefreshToken', refreshTokenSchema);
