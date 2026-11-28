import type {
  AdminDashboardSection,
  AdminExportSection,
  PermissionKey,
} from '@farmplus/shared-types';
import type { AdminKey } from '../../../components/admin/i18n';

export interface AdminExport {
  section: AdminExportSection;
  /** Report name (admin catalog key). */
  label: AdminKey;
  /** The dashboard section the export mirrors: the API allows the export exactly when that section is allowed. */
  needs: AdminDashboardSection;
  /**
   * Platform permissions that open that section (any one is enough). Mirrors the API's section rules
   * (`services/api/src/modules/analytics/admin.service.ts`); used only to hide what the viewer cannot download —
   * the API re-checks every export.
   */
  anyOf: readonly PermissionKey[];
}

/** The platform CSV exports (`GET /admin/analytics/export?section=…`), shared by the analytics and reports pages. */
export const ADMIN_EXPORTS: readonly AdminExport[] = [
  { section: 'signups', label: 'analytics.signups', needs: 'users', anyOf: ['users.read'] },
  { section: 'orders', label: 'nav.orders', needs: 'orders', anyOf: ['payments.read'] },
  { section: 'payments', label: 'nav.payments', needs: 'payments', anyOf: ['payments.read'] },
  {
    section: 'commissions',
    label: 'nav.commissions',
    needs: 'commissions',
    anyOf: ['payments.read'],
  },
  { section: 'refunds', label: 'nav.refunds', needs: 'refunds', anyOf: ['payments.read'] },
  { section: 'payouts', label: 'analytics.payouts', needs: 'payouts', anyOf: ['payments.read'] },
];

export const ADMIN_EXPORT_PATH = '/admin/analytics/export';
