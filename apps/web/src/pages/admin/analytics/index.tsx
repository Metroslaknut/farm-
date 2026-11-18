import { useSearchParams } from 'react-router-dom';
import {
  ADMIN_DASHBOARD_SECTIONS,
  type AdminDashboardDTO,
  type AdminDashboardSection,
  type AdminExportSection,
} from '@farmplus/shared-types';
import { api } from '../../../api';
import { StateMessage } from '../../../components/admin';
import { useAdminI18n, type AdminKey } from '../../../components/admin/i18n';
import { ExportButtons, FilterForm } from '../../../components/analytics/Controls';
import { DashboardView } from '../../../components/analytics/DashboardView';
import { useAsync } from '../../../lib/useAsync';

const EXPORTS: { section: AdminExportSection; label: AdminKey; needs: AdminDashboardSection }[] = [
  { section: 'signups', label: 'analytics.signups', needs: 'users' },
  { section: 'orders', label: 'nav.orders', needs: 'orders' },
  { section: 'payments', label: 'nav.payments', needs: 'payments' },
  { section: 'commissions', label: 'nav.commissions', needs: 'commissions' },
  { section: 'refunds', label: 'nav.refunds', needs: 'refunds' },
  { section: 'payouts', label: 'analytics.payouts', needs: 'payouts' },
];
const FILTER_KEYS = ['from', 'to', 'granularity', 'orderKind'] as const;

/** Platform analytics. Sections and CSV exports follow the staff member's permissions (enforced by the API). */
export default function AnalyticsPage() {
  const [search, setSearch] = useSearchParams();
  const { t } = useAdminI18n();
  const query = search.toString();
  const { data, error, loading, reload } = useAsync(
    (signal) => {
      const q: Record<string, string> = {};
      for (const k of FILTER_KEYS) if (search.get(k)) q[k] = search.get(k)!;
      return api.request<AdminDashboardDTO>('GET', '/admin/analytics', { signal, query: q });
    },
    [query],
  );
  const params = new URLSearchParams(query);
  const exportable = EXPORTS.filter((e) => data?.sections[e.needs]?.available).map((e) => ({
    ...e,
    label: t(e.label),
  }));
  return (
    <>
      <h1>{t('nav.analytics')}</h1>
      <FilterForm params={params} onApply={setSearch}>
        <label>
          {t('nav.orders')}
          <select name="orderKind" defaultValue={params.get('orderKind') ?? ''}>
            <option value="">{t('analytics.allKinds')}</option>
            <option value="animal">{t('analytics.animals')}</option>
            <option value="product">{t('analytics.products')}</option>
          </select>
        </label>
      </FilterForm>
      {error && (
        <StateMessage kind="error" onRetry={reload}>
          {error}
        </StateMessage>
      )}
      {loading && !data && <StateMessage kind="loading" />}
      {data && (
        <>
          <ExportButtons path="/admin/analytics/export" params={params} sections={exportable} />
          <DashboardView scope="admin" data={data} order={ADMIN_DASHBOARD_SECTIONS} />
        </>
      )}
    </>
  );
}
