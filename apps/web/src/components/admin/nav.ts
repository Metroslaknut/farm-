import type { AdminKey } from './i18n';

export interface NavItem {
  path: string;
  /** Catalog key of the label (resolved at render time so it follows the language). */
  labelKey: AdminKey;
  /** Shown (and routable) only if the user holds ANY of these permissions. */
  anyOf: readonly string[];
}

export interface NavGroup {
  labelKey: AdminKey;
  items: NavItem[];
}

/**
 * Single source of truth for admin navigation AND route guards: the sidebar hides what the user cannot
 * open, and each route re-checks the same permission. (The API enforces it again — UI is never the control.)
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'nav.group.overview',
    items: [{ path: 'dashboard', labelKey: 'nav.dashboard', anyOf: ['reports.read'] }],
  },
  {
    labelKey: 'nav.group.people',
    items: [
      { path: 'registrations', labelKey: 'nav.registrations', anyOf: ['registrations.review'] },
      { path: 'users', labelKey: 'nav.users', anyOf: ['users.read'] },
      { path: 'roles', labelKey: 'nav.roles', anyOf: ['roles.read'] },
      { path: 'permissions', labelKey: 'nav.permissions', anyOf: ['roles.read'] },
    ],
  },
  {
    labelKey: 'nav.group.finance',
    items: [
      { path: 'payments', labelKey: 'nav.payments', anyOf: ['payments.read'] },
      { path: 'refunds', labelKey: 'nav.refunds', anyOf: ['payments.refund'] },
      { path: 'withdrawals', labelKey: 'nav.withdrawals', anyOf: ['withdrawals.approve'] },
      { path: 'wallet-transactions', labelKey: 'nav.walletTransactions', anyOf: ['payments.read'] },
      { path: 'commissions', labelKey: 'nav.commissions', anyOf: ['commissions.manage'] },
    ],
  },
  {
    labelKey: 'nav.group.marketplace',
    items: [
      { path: 'farms', labelKey: 'nav.farms', anyOf: ['farms.read', 'farms.manage'] },
      { path: 'listings', labelKey: 'nav.listings', anyOf: ['listings.moderate'] },
      { path: 'products', labelKey: 'nav.products', anyOf: ['listings.moderate'] },
      { path: 'orders', labelKey: 'nav.orders', anyOf: ['payments.read'] },
    ],
  },
  {
    labelKey: 'nav.group.community',
    items: [
      { path: 'moderation', labelKey: 'nav.moderation', anyOf: ['content.moderate'] },
      { path: 'message-reports', labelKey: 'nav.messageReports', anyOf: ['content.moderate'] },
    ],
  },
  {
    labelKey: 'nav.group.system',
    items: [
      { path: 'reports', labelKey: 'nav.reports', anyOf: ['reports.read'] },
      {
        path: 'analytics',
        labelKey: 'nav.analytics',
        anyOf: [
          'reports.read',
          'payments.read',
          'users.read',
          'farms.read',
          'registrations.review',
          'listings.moderate',
          'content.moderate',
        ],
      },
      { path: 'animal-types', labelKey: 'nav.animalTypes', anyOf: ['animal_types.manage'] },
      {
        path: 'growth-standards',
        labelKey: 'nav.growthStandards',
        anyOf: ['animal_types.manage'],
      },
      { path: 'ai', labelKey: 'nav.ai', anyOf: ['animal_types.manage', 'reports.read'] },
      { path: 'audit-logs', labelKey: 'nav.auditLogs', anyOf: ['audit_logs.read'] },
      { path: 'settings', labelKey: 'nav.settings', anyOf: ['settings.read'] },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Groups with only the items the user may open; empty groups are dropped. */
export function visibleNav(canAny: (permissions: readonly string[]) => boolean): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => canAny(i.anyOf)) })).filter(
    (g) => g.items.length > 0,
  );
}
