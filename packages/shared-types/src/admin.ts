import type { AuditLogEntry, PublicUser, RoleSummary } from './auth';
import type { FarmAnimalTypeCount, FarmDetail, FarmMemberSummary, FarmStatus } from './farms';

/** Registration (application) lifecycle. Independent of user account status. */
export const REGISTRATION_STATUSES = [
  'PENDING',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/** What the applicant is applying for. */
export const REGISTRATION_TYPES = ['identity', 'farm_owner', 'seller'] as const;
export type RegistrationType = (typeof REGISTRATION_TYPES)[number];

/**
 * Four deliberately separate dimensions on a user — never merged into one "status":
 *  - account status:        `UserStatus` (can the account sign in?)
 *  - identity verification: who the person is
 *  - seller verification:   may they sell
 *  - subscription status:   billing state (written by the future billing module)
 */
export const IDENTITY_VERIFICATION_STATUSES = [
  'unverified',
  'pending',
  'verified',
  'rejected',
] as const;
export type IdentityVerificationStatus = (typeof IDENTITY_VERIFICATION_STATUSES)[number];

export const SELLER_VERIFICATION_STATUSES = [
  'none',
  'pending',
  'verified',
  'rejected',
  'suspended',
] as const;
export type SellerVerificationStatus = (typeof SELLER_VERIFICATION_STATUSES)[number];

export const SUBSCRIPTION_STATUSES = [
  'none',
  'active',
  'past_due',
  'cancelled',
  'expired',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface RegistrationDocument {
  kind: string;
  url: string;
}

export interface RegistrationSummary {
  id: string;
  type: RegistrationType;
  status: RegistrationStatus;
  applicant: { id: string; displayName: string; email?: string; phone?: string };
  businessName?: string;
  note?: string;
  documents: RegistrationDocument[];
  submittedAt: string;
  /** Set when a reviewer picked the registration up. */
  review?: { byId: string; at: string };
  /** Latest decision (approve / reject / suspend / reinstate). */
  decision?: {
    outcome: 'APPROVED' | 'REJECTED' | 'SUSPENDED';
    byId: string;
    at: string;
    reason: string;
  };
}

export interface AdminUser extends PublicUser {
  identityVerification: IdentityVerificationStatus;
  sellerVerification: SellerVerificationStatus;
  subscriptionStatus: SubscriptionStatus;
  lastLoginAt?: string;
}

export interface AdminUserDetail {
  user: AdminUser;
  activeSessions: number;
  registrations: RegistrationSummary[];
  /** Present only when the caller also holds `audit_logs.read`. */
  recentAudit?: AuditLogEntry[];
}

/** A farm owner as platform staff see it. `email` only for callers who may also read users (`users.read`). */
export interface AdminFarmOwner {
  id: string;
  displayName: string;
  email?: string;
}

/** One row of `GET /admin/farms` (read-only, platform staff with `farms.read` or `farms.manage`). */
export interface AdminFarmRow {
  id: string;
  name: string;
  status: FarmStatus;
  province?: string;
  owner: AdminFarmOwner | null;
  /** Every membership, the owner included. */
  memberCount: number;
  /** Animals not archived, in any status. */
  animalCount: number;
  createdAt: string;
  archivedAt?: string;
}

/** `GET /admin/farms/:id`: everything the read-only detail page shows, in one response. */
export interface AdminFarmDetail {
  /** Profile, contact, owner and per-status animal counts (the same shape as `GET /farms/:farmId`). */
  farm: FarmDetail;
  owner: AdminFarmOwner | null;
  members: FarmMemberSummary[];
  /** Per-type animal counts (the `GET /farms/:farmId/summary` cards). */
  animalsByType: FarmAnimalTypeCount[];
  /** Latest of: the farm's own last update, an animal change, an audited action on the farm. */
  lastActivityAt: string | null;
  /** Audited actions on the farm (archive/restore, members…); present only with `audit_logs.read`. */
  recentAudit?: AuditLogEntry[];
}

export interface AdminRoleSummary extends RoleSummary {
  id: string;
  userCount: number;
}

/** Each section is present only if the caller holds the permission needed to see it. */
export interface DashboardResponse {
  generatedAt: string;
  users?: {
    total: number;
    active: number;
    suspended: number;
    pendingVerification: number;
    newLast7Days: number;
  };
  registrations?: { byStatus: Record<RegistrationStatus, number> };
  signupsByDay?: { date: string; count: number }[];
  audit?: { eventsLast24h: number };
}

export interface SettingValue {
  key: string;
  value: string | number | boolean;
  default: string | number | boolean;
  description: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface SettingsResponse {
  settings: SettingValue[];
}
