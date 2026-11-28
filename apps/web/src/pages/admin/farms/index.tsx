import { Link } from 'react-router-dom';
import { FARM_STATUSES, type AdminFarmRow, type Page } from '@farmplus/shared-types';
import { api } from '../../../api';
import {
  AdminDataTable,
  SearchFilters,
  StatusBadge,
  type Column,
  type FilterField,
} from '../../../components/admin';
import { useAdminI18n, type AdminI18n } from '../../../components/admin/i18n';
import { useAsync } from '../../../lib/useAsync';
import { useListParams } from '../../../lib/useListParams';

const PAGE_SIZE = 20;
const DEFAULTS = {
  q: '',
  status: '',
  province: '',
  owner: '',
  from: '',
  to: '',
  sortBy: 'createdAt',
  order: 'desc',
  page: '1',
};
const fields = ({ t, status }: AdminI18n): FilterField[] => [
  { name: 'q', label: t('common.search'), type: 'search', placeholder: t('farms.searchPh') },
  {
    name: 'province',
    label: t('farms.province'),
    type: 'search',
    placeholder: t('farms.provincePh'),
  },
  { name: 'owner', label: t('farms.owner'), type: 'search', placeholder: t('farms.ownerPh') },
  {
    name: 'status',
    label: t('common.status'),
    type: 'select',
    options: FARM_STATUSES.map((v) => ({ value: v, label: status(v) })),
  },
  { name: 'from', label: t('farms.createdFrom'), type: 'date' },
  { name: 'to', label: t('farms.createdTo'), type: 'date' },
];

const startOfDay = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : '');
const endOfDay = (d: string) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : '');

/** Read-only list of every farm (platform `farms.read` / `farms.manage`). No actions in phase 1. */
export default function FarmsPage() {
  const [params, setParams] = useListParams(DEFAULTS);
  const i18n = useAdminI18n();
  const { t, dateTime, number } = i18n;
  const { data, loading, error, reload } = useAsync(
    (signal) =>
      api.request<Page<AdminFarmRow>>('GET', '/admin/farms', {
        query: {
          ...params,
          from: startOfDay(params['from']!),
          to: endOfDay(params['to']!),
          pageSize: PAGE_SIZE,
        },
        signal,
      }),
    [params],
  );
  const columns: Column<AdminFarmRow>[] = [
    {
      key: 'name',
      header: t('common.name'),
      sortKey: 'name',
      cell: (f) => <Link to={`/admin/farms/${f.id}`}>{f.name}</Link>,
    },
    { key: 'owner', header: t('farms.owner'), cell: (f) => f.owner?.displayName ?? '—' },
    { key: 'province', header: t('farms.province'), cell: (f) => f.province ?? '—' },
    { key: 'status', header: t('common.status'), cell: (f) => <StatusBadge status={f.status} /> },
    { key: 'members', header: t('farms.members'), cell: (f) => number(f.memberCount) },
    { key: 'animals', header: t('farms.animals'), cell: (f) => number(f.animalCount) },
    {
      key: 'created',
      header: t('common.created'),
      sortKey: 'createdAt',
      cell: (f) => dateTime(f.createdAt),
    },
  ];
  return (
    <>
      <h1>{t('nav.farms')}</h1>
      <p className="adm-muted">{t('farms.readOnly')}</p>
      <SearchFilters
        fields={fields(i18n)}
        values={params}
        onChange={setParams}
        onReset={() => setParams({ q: '', status: '', province: '', owner: '', from: '', to: '' })}
      />
      <AdminDataTable
        caption={t('nav.farms')}
        columns={columns}
        rows={data?.items}
        rowKey={(f) => f.id}
        total={data?.total ?? 0}
        page={Number(params['page'])}
        pageSize={PAGE_SIZE}
        onPageChange={(p) => setParams({ page: String(p) })}
        sort={{ by: params['sortBy']!, order: params['order'] === 'asc' ? 'asc' : 'desc' }}
        onSortChange={(s) => setParams({ sortBy: s.by, order: s.order })}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyMessage={t('farms.empty')}
      />
    </>
  );
}
