export const ROLE_KEYS = [
  'super_admin',
  'admin',
  'registration_admin',
  'finance_admin',
  'moderator',
  'support',
  'farm_owner',
  'seller',
  'buyer',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** Roles whose permissions require an MFA-verified session. */
export const ADMIN_ROLE_KEYS = [
  'super_admin',
  'admin',
  'registration_admin',
  'finance_admin',
  'moderator',
  'support',
] as const satisfies readonly RoleKey[];

export const PERMISSION_KEYS = [
  'users.read',
  'users.update',
  'users.suspend',
  'registrations.review',
  'registrations.approve',
  'payments.read',
  'payments.verify',
  'payments.refund',
  'withdrawals.approve',
  'roles.read',
  'roles.manage',
  'permissions.manage',
  'farms.read',
  'farms.manage',
  'listings.moderate',
  'commissions.manage',
  'reports.read',
  'audit_logs.read',
  'settings.read',
  'settings.manage',
  'animal_types.manage',
  'content.moderate',
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const USER_STATUSES = [
  'pending_verification',
  'active',
  'suspended',
  'deactivated',
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
