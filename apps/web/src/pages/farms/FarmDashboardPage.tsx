import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  FARM_DASHBOARD_SECTIONS,
  type FarmDashboardDTO,
  type FarmDashboardSection,
  type FarmExportSection,
} from '@farmplus/shared-types';
import { api } from '../../api';
import { DashboardView } from '../../components/analytics/DashboardView';
import { ExportButtons, FilterForm } from '../../components/analytics/Controls';
import { Alert } from '../../components/ui';
import { useLocale } from '../../i18n';
import { loadAnimalTypes } from '../../lib/animalTypes';
import { useAsync } from '../../lib/useAsync';
import { typeName, useFarmsT, type FarmsKey } from './labels';
import { useFarm } from './useFarmAccess';

const EXPORTS: { section: FarmExportSection; label: FarmsKey; needs: FarmDashboardSection }[] = [
  { section: 'animals', label: 'dashboard.export.animals', needs: 'animals' },
  { section: 'growth', label: 'dashboard.export.growth', needs: 'growth' },
  { section: 'health', label: 'dashboard.export.health', needs: 'health' },
  { section: 'feeding', label: 'dashboard.export.feeding', needs: 'feeding' },
  { section: 'costs', label: 'dashboard.export.costs', needs: 'costs' },
  { section: 'orders', label: 'dashboard.export.orders', needs: 'sales' },
  { section: 'assessments', label: 'dashboard.export.assessments', needs: 'assessments' },
];
const FILTER_KEYS = ['from', 'to', 'granularity', 'animalType', 'orderKind'] as const;

/** Farm analytics: what is shown and exported follows the viewer's permissions on this farm (enforced by the API). */
export default function FarmDashboardPage() {
  const t = useFarmsT();
  const [locale] = useLocale();
  const { farmId } = useParams();
  const [search, setSearch] = useSearchParams();
  const { farm } = useFarm(farmId);
  const types = useAsync(() => loadAnimalTypes(), []);
  const query = search.toString();
  const { data, error, loading, reload } = useAsync(
    (signal) => {
      const q: Record<string, string> = {};
      for (const k of FILTER_KEYS) if (search.get(k)) q[k] = search.get(k)!;
      return api.request<FarmDashboardDTO>('GET', `/farms/${farmId}/dashboard`, {
        signal,
        query: q,
      });
    },
    [farmId, query],
  );
  const params = new URLSearchParams(query);
  const exportable = EXPORTS.filter((e) => data?.sections[e.needs]?.available).map((e) => ({
    ...e,
    label: t(e.label),
  }));

  return (
    <>
      <p>
        <Link to={`/farms/${farmId}`}>← {farm?.name ?? t('common.farm')}</Link>
      </p>
      <h1 data-tour="farm-analytics-title">{t('dashboard.title')}</h1>
      <FilterForm params={params} onApply={setSearch}>
        <label>
          {t('dashboard.animalType')}
          {/* Remount only this select when its options arrive (so it can show the applied type): remounting the whole
              form would wipe dates the user had already typed. */}
          <select
            key={types.data ? 'types' : ''}
            name="animalType"
            defaultValue={params.get('animalType') ?? ''}
          >
            <option value="">{t('common.all')}</option>
            {types.data?.animalTypes.map((type) => (
              <option key={type.id} value={type.key}>
                {typeName(type, locale)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('dashboard.orders')}
          <select name="orderKind" defaultValue={params.get('orderKind') ?? ''}>
            <option value="">{t('dashboard.orders.all')}</option>
            <option value="animal">{t('dashboard.orders.animal')}</option>
            <option value="product">{t('dashboard.orders.product')}</option>
          </select>
        </label>
      </FilterForm>
      {error && (
        <Alert tone="danger">
          {error}{' '}
          <button type="button" onClick={reload}>
            {t('common.tryAgain')}
          </button>
        </Alert>
      )}
      {loading && !data && <p role="status">{t('dashboard.loading')}</p>}
      {data && (
        <>
          <ExportButtons
            path={`/farms/${farmId}/dashboard/export`}
            params={params}
            sections={exportable}
          />
          <DashboardView scope="farm" data={data} order={FARM_DASHBOARD_SECTIONS} />
        </>
      )}
    </>
  );
}
