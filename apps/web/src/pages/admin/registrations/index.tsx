import { Link } from 'react-router-dom';
import {
  REGISTRATION_STATUSES,
  REGISTRATION_TYPES,
  type Page,
  type RegistrationSummary,
} from '@farmplus/shared-types';
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

const DEFAULTS = { q: '', status: '', type: '', sortBy: 'submittedAt', order: 'desc', page: '1' };
const fields = ({ t, status, label }: AdminI18n): FilterField[] => [
  {
    name: 'q',
    label: t('registrations.search'),
    type: 'search',
    placeholder: t('registrations.searchPh'),
  },
  {
    name: 'status',
    label: t('common.status'),
    type: 'select',
    options: REGISTRATION_STATUSES.map((s) => ({ value: s, label: status(s).toUpperCase() })),
  },
  {
    name: 'type',
    label: t('common.type'),
    type: 'select',
    options: REGISTRATION_TYPES.map((v) => ({ value: v, label: label('regType', v) })),
  },
];

export default function RegistrationsPage() {
  const [params, setParams] = useListParams(DEFAULTS);
  const i18n = useAdminI18n();
  const { t, label, dateTime } = i18n;
  const { data, loading, error, reload } = useAsync(
    (signal) =>
      api.request<Page<RegistrationSummary>>('GET', '/admin/registrations', {
        query: { ...params, pageSize: 20 },
        signal,
      }),
    [params],
  );
  const columns: Column<RegistrationSummary>[] = [
    {
      key: 'applicant',
      header: t('registrations.colApplicant'),
      cell: (r) => <Link to={`/admin/registrations/${r.id}`}>{r.applicant.displayName}</Link>,
    },
    { key: 'type', header: t('common.type'), cell: (r) => label('regType', r.type) },
    { key: 'business', header: t('registrations.colBusiness'), cell: (r) => r.businessName ?? '—' },
    {
      key: 'status',
      header: t('common.status'),
      sortKey: 'status',
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: 'submitted',
      header: t('registrations.colSubmitted'),
      sortKey: 'submittedAt',
      cell: (r) => dateTime(r.submittedAt),
    },
  ];
  return (
    <>
      <h1>{t('nav.registrations')}</h1>
      <SearchFilters
        fields={fields(i18n)}
        values={params}
        onChange={setParams}
        onReset={() => setParams({ q: '', status: '', type: '' })}
      />
      <AdminDataTable
        caption={t('nav.registrations')}
        columns={columns}
        rows={data?.items}
        rowKey={(r) => r.id}
        total={data?.total ?? 0}
        page={Number(params['page'])}
        pageSize={20}
        onPageChange={(p) => setParams({ page: String(p) })}
        sort={{ by: params['sortBy']!, order: params['order'] === 'asc' ? 'asc' : 'desc' }}
        onSortChange={(s) => setParams({ sortBy: s.by, order: s.order })}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyMessage={t('registrations.empty')}
      />
    </>
  );
}
