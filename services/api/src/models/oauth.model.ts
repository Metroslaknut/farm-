import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export const OAUTH_PROVIDERS = ['google', 'facebook'] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number];

/** A Google/Facebook account linked to a FARM+ user (one provider account → one user). */
export interface OAuthIdentityAttrs {
  _id: Types.ObjectId;
  provider: OAuthProviderId;
  /** The provider's stable account id (Google `sub`, Facebook `id`). */
  subject: string;
  userId: Types.ObjectId;
  /** The email the provider reported at link time (informational; never used to look the user up). */
  email: string | null;
  emailVerified: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
const identitySchema = new Schema<OAuthIdentityAttrs>(
  {
    provider: { type: String, enum: OAUTH_PROVIDERS, required: true },
    subject: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    email: { type: String, default: null },
    emailVerified: { type: Boolean, default: false },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'oauth_identities' },
);
identitySchema.index({ provider: 1, subject: 1 }, { unique: true });
identitySchema.index({ userId: 1 });
export const OAuthIdentity = model<OAuthIdentityAttrs>('OAuthIdentity', identitySchema);

/**
 * One social sign-in attempt, from "start" to the client exchanging its one-time ticket. Short-lived (TTL index).
 * Secrets are stored as SHA-256 hashes only; the PKCE verifier sent to the provider is single-use and expires with it.
 */
export const OAUTH_FLOW_STATUSES = ['started', 'callback', 'ticketed', 'used', 'failed'] as const;
export interface OAuthFlowAttrs {
  _id: Types.ObjectId;
  provider: OAuthProviderId;
  stateHash: string;
  /** PKCE verifier for the provider's token endpoint. */
  codeVerifier: string;
  /** Exact return URL (from OAUTH_RETURN_URLS). */
  returnTo: string;
  /** base64url(SHA-256(client verifier)): binds the ticket to the device that started the sign-in. */
  clientChallenge: string;
  status: (typeof OAUTH_FLOW_STATUSES)[number];
  ticketHash: string | null;
  userId: Types.ObjectId | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
const flowSchema = new Schema<OAuthFlowAttrs>(
  {
    provider: { type: String, enum: OAUTH_PROVIDERS, required: true },
    stateHash: { type: String, required: true },
    codeVerifier: { type: String, required: true },
    returnTo: { type: String, required: true },
    clientChallenge: { type: String, required: true },
    status: { type: String, enum: OAUTH_FLOW_STATUSES, default: 'started' },
    ticketHash: { type: String, default: null },
    userId: { type: Schema.Types.ObjectId, default: null },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true, collection: 'oauth_flows' },
);
flowSchema.index({ stateHash: 1 }, { unique: true });
flowSchema.index(
  { ticketHash: 1 },
  { unique: true, partialFilterExpression: { ticketHash: { $type: 'string' } } },
);
export type OAuthFlowDoc = HydratedDocument<OAuthFlowAttrs>;
export const OAuthFlow = model<OAuthFlowAttrs>('OAuthFlow', flowSchema);
