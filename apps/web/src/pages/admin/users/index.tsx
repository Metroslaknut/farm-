import { Link } from 'react-router-dom';
import {
  IDENTITY_VERIFICATION_STATUSES,
  SELLER_VERIFICATION_STATUSES,
  USER_STATUSES,
  type AdminUser,
  type Page,
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

const DEFAULTS = {
  q: '',
  status: '',
  identity: '',
  seller: '',
  sortBy: 'createdAt',
  order: 'desc',
  page: '1',
};
const fields = ({ t, status }: AdminI18n): FilterField[] => {
  const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: status(v) }));
  return [
    { name: 'q', label: t('common.search'), type: 'search', placeholder: t('users.searchPh') },
    {
      name: 'status',
      label: t('users.accountStatus'),
      type: 'select',
      options: opts(USER_STATUSES),
    },
    {
      name: 'identity',
      label: t('users.identity'),
      type: 'select',
      options: opts(IDENTITY_VERIFICATION_STATUSES),
    },
    {
      name: 'seller',
      label: t('users.seller'),
      type: 'select',
      options: opts(SELLER_VERIFICATION_STATUSES),
    },
  ];
};

export default function UsersPage() {
  const [params, setParams] = useListParams(DEFAULTS);
  const i18n = useAdminI18n();
  const { t, apiText, dateTime } = i18n;
  const { data, loading, error, reload } = useAsync(
    (signal) =>
      api.request<Page<AdminUser>>('GET', '/admin/users', {
        query: { ...params, pageSize: 20 },
        signal,
      }),
    [params],
  );
  const columns: Column<AdminUser>[] = [
    {
      key: 'name',
      header: t('common.name'),
      sortKey: 'displayName',
      cell: (u) => <Link to={`/admin/users/${u.id}`}>{u.displayName}</Link>,
    },
    { key: 'contact', header: t('users.contact'), cell: (u) => u.email ?? u.phone ?? '—' },
    {
      key: 'status',
      header: t('users.account'),
      cell: (u) => <StatusBadge status={u.status} />,
    },
    {
      key: 'identity',
      header: t('users.identity'),
      cell: (u) => <StatusBadge status={u.identityVerification} />,
    },
    {
      key: 'seller',
      header: t('users.seller'),
      cell: (u) => <StatusBadge status={u.sellerVerification} />,
    },
    {
      key: 'roles',
      header: t('common.roles'),
      cell: (u) => u.roles.map((r) => apiText(`role.${r}`, r)).join(', '),
    },
    {
      key: 'created',
      header: t('users.joined'),
      sortKey: 'createdAt',
      cell: (u) => dateTime(u.createdAt),
    },
  ];
  return (
    <>
      <h1>{t('nav.users')}</h1>
      <SearchFilters
        fields={fields(i18n)}
        values={params}
        onChange={setParams}
        onReset={() => setParams({ q: '', status: '', identity: '', seller: '' })}
      />
      <AdminDataTable
        caption={t('nav.users')}
        columns={columns}
        rows={data?.items}
        rowKey={(u) => u.id}
        total={data?.total ?? 0}
        page={Number(params['page'])}
        pageSize={20}
        onPageChange={(p) => setParams({ page: String(p) })}
        sort={{ by: params['sortBy']!, order: params['order'] === 'asc' ? 'asc' : 'desc' }}
        onSortChange={(s) => setParams({ sortBy: s.by, order: s.order })}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyMessage={t('users.empty')}
      />
    </>
  );
}
