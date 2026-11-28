import { Link } from 'react-router-dom';
import {
  ORDER_KINDS,
  ORDER_STATUSES,
  type AdminOrderSummary,
  type OrderStatus,
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
import { Tag, baht } from '../finance-common';

const PAGE_SIZE = 20;
const DEFAULTS = { orderNo: '', buyer: '', status: '', kind: '', from: '', to: '', page: '1' };

type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';
const ORDER_TONES: Record<OrderStatus, Tone> = {
  PENDING_PAYMENT: 'warning',
  PAID: 'info',
  PROCESSING: 'info',
  SHIPPED: 'info',
  DELIVERED: 'success',
  CANCELLED: 'neutral',
  REFUND_PENDING: 'warning',
  REFUNDED: 'neutral',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <StatusBadge status={status} tone={ORDER_TONES[status]} />;
}

const fields = ({ t, status, label }: AdminI18n): FilterField[] => [
  {
    name: 'orderNo',
    label: t('orders.orderNo'),
    type: 'search',
    placeholder: t('orders.orderNoPh'),
  },
  { name: 'buyer', label: t('orders.buyer'), type: 'search', placeholder: t('orders.buyerPh') },
  {
    name: 'status',
    label: t('orders.orderStatus'),
    type: 'select',
    options: ORDER_STATUSES.map((v) => ({ value: v, label: status(v) })),
  },
  {
    name: 'kind',
    label: t('orders.kind'),
    type: 'select',
    options: ORDER_KINDS.map((v) => ({ value: v, label: label('orderKind', v) })),
  },
  { name: 'from', label: t('orders.from'), type: 'date' },
  { name: 'to', label: t('orders.to'), type: 'date' },
];

/** `/admin/orders` — every order, read-only (`payments.read`). Filters live in the URL. */
export default function OrdersPage() {
  const [params, setParams] = useListParams(DEFAULTS);
  const i18n = useAdminI18n();
  const { t, label, dateTime } = i18n;
  const { data, loading, error, reload } = useAsync(
    (signal) =>
      api.request<Page<AdminOrderSummary>>('GET', '/admin/orders', {
        query: { ...params, pageSize: PAGE_SIZE },
        signal,
      }),
    [params],
  );
  const columns: Column<AdminOrderSummary>[] = [
    {
      key: 'orderNo',
      header: t('orders.orderNo'),
      cell: (o) => <Link to={`/admin/orders/${o.id}`}>{o.orderNo}</Link>,
    },
    { key: 'created', header: t('common.created'), cell: (o) => dateTime(o.createdAt) },
    { key: 'buyer', header: t('orders.buyer'), cell: (o) => o.buyer.displayName },
    { key: 'farm', header: t('orders.farm'), cell: (o) => o.farm.name },
    { key: 'kind', header: t('orders.kind'), cell: (o) => label('orderKind', o.kind) },
    { key: 'total', header: t('orders.total'), cell: (o) => baht(o.grandTotalMinor) },
    { key: 'payment', header: t('orders.payment'), cell: (o) => <Tag value={o.paymentStatus} /> },
    {
      key: 'status',
      header: t('orders.orderStatus'),
      cell: (o) => <OrderStatusBadge status={o.status} />,
    },
  ];
  return (
    <>
      <h1>{t('nav.orders')}</h1>
      <p className="adm-muted">{t('orders.intro')}</p>
      <SearchFilters
        fields={fields(i18n)}
        values={params}
        onChange={setParams}
        onReset={() =>
          setParams({ orderNo: '', buyer: '', status: '', kind: '', from: '', to: '' })
        }
      />
      <AdminDataTable
        caption={t('nav.orders')}
        columns={columns}
        rows={data?.items}
        rowKey={(o) => o.id}
        total={data?.total ?? 0}
        page={Number(params['page'])}
        pageSize={PAGE_SIZE}
        onPageChange={(p) => setParams({ page: String(p) })}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyMessage={t('orders.empty')}
      />
    </>
  );
}
