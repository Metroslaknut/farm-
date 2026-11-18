import {
  ADMIN_ROLE_KEYS,
  PERMISSION_KEYS,
  type PermissionKey,
  type RoleKey,
} from '@farmplus/shared-types';

export const PERMISSION_DESCRIPTIONS: Record<PermissionKey, string> = {
  'users.read': 'View user accounts',
  'users.update': 'Update other users’ profiles',
  'users.suspend': 'Suspend, reactivate or deactivate user accounts',
  'registrations.review': 'Review registration requests',
  'registrations.approve': 'Approve or reject registration requests',
  'payments.read': 'View payments',
  'payments.verify': 'Verify payments',
  'payments.refund': 'Issue refunds',
  'withdrawals.approve': 'Approve withdrawals / payouts',
  'roles.read': 'View roles and permissions',
  'roles.manage': 'Assign and revoke user roles',
  'permissions.manage': 'Change which permissions a role holds',
  'farms.read': 'View any farm',
  'farms.manage': 'Manage any farm',
  'listings.moderate': 'Moderate marketplace listings',
  'commissions.manage': 'Manage commission settings',
  'reports.read': 'View reports and analytics',
  'audit_logs.read': 'View audit logs',
  'settings.read': 'View system settings',
  'settings.manage': 'Change system settings',
  'animal_types.manage': 'Manage animal types and breeds',
  'content.moderate': 'Review reports and moderate community posts and comments',
};

interface RoleDefinition {
  name: string;
  description: string;
  permissions: readonly PermissionKey[];
}

/**
 * Default role → permission mapping, applied only when a role is first created.
 * Later edits through the API are preserved (except super_admin, which always holds everything).
 * farm_owner / seller / buyer hold no global permissions: their access is ownership-based.
 */
export const ROLE_DEFINITIONS: Record<RoleKey, RoleDefinition> = {
  super_admin: {
    name: 'Super Admin',
    description: 'Full platform control',
    permissions: PERMISSION_KEYS,
  },
  admin: {
    name: 'Admin',
    description: 'General administration',
    permissions: [
      'users.read',
      'users.update',
      'users.suspend',
      'registrations.review',
      'registrations.approve',
      'roles.read',
      'roles.manage',
      'farms.read',
      'farms.manage',
      'listings.moderate',
      'reports.read',
      'audit_logs.read',
      'settings.read',
      'animal_types.manage',
      'content.moderate',
    ],
  },
  registration_admin: {
    name: 'Registration Admin',
    description: 'Reviews and approves registrations',
    permissions: ['users.read', 'registrations.review', 'registrations.approve'],
  },
  finance_admin: {
    name: 'Finance Admin',
    description: 'Payments, payouts and commissions',
    permissions: [
      'users.read',
      'payments.read',
      'payments.verify',
      'payments.refund',
      'withdrawals.approve',
      'commissions.manage',
      'reports.read',
    ],
  },
  moderator: {
    name: 'Moderator',
    description: 'Moderates listings and content',
    permissions: [
      'users.read',
      'farms.read',
      'listings.moderate',
      'reports.read',
      'content.moderate',
    ],
  },
  support: {
    name: 'Support',
    description: 'Customer support',
    permissions: ['users.read', 'farms.read'],
  },
  farm_owner: { name: 'Farm Owner', description: 'Owns and manages own farms', permissions: [] },
  seller: { name: 'Seller', description: 'Sells animals and products', permissions: [] },
  buyer: { name: 'Buyer', description: 'Default role for every account', permissions: [] },
};

export const DEFAULT_ROLE_KEY: RoleKey = 'buyer';
/** Only a super_admin may grant or revoke these (on top of the permission-subset rule). */
export const PROTECTED_ROLE_KEYS: readonly string[] = ['super_admin', 'admin'];
export const isMfaRole = (key: string): boolean =>
  (ADMIN_ROLE_KEYS as readonly string[]).includes(key);
