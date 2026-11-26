import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  LISTING_STATUSES,
  type CursorPage,
  type FarmAnimalSummaryDTO,
  type ListingDTO,
  type OrderDTO,
  type OrderStatus,
} from '@farmplus/shared-types';
import { formatBaht } from '@farmplus/shared-utils';
import { api } from '../../api';
import { Alert, Badge, Button, Card, Select, Table, type Tone } from '../../components/ui';
import { useT } from '../../i18n';
import { useAsync } from '../../lib/useAsync';
import { useAnimalLabel } from '../market/common';
import { NavButton } from './NavButton';
import { useFarmFormat, useFarmsT, type FarmsKey } from './labels';
import { useFarm } from './useFarmAccess';

/** What the buyer's payment looks like from the order status (the finance module is the source of truth). */
const PAYMENT: Record<OrderStatus, { key: FarmsKey; tone: Tone }> = {
  PENDING_PAYMENT: { key: 'trades.payment.pending', tone: 'warning' },
  PAID: { key: 'trades.payment.paid', tone: 'success' },
  PROCESSING: { key: 'trades.payment.paid', tone: 'success' },
  SHIPPED: { key: 'trades.payment.paid', tone: 'success' },
  DELIVERED: { key: 'trades.payment.paid', tone: 'success' },
  CANCELLED: { key: 'trades.payment.cancelled', tone: 'neutral' },
  REFUND_PENDING: { key: 'trades.payment.refunding', tone: 'warning' },
  REFUNDED: { key: 'trades.payment.refunded', tone: 'neutral' },
};
const LISTING_TONE: Partial<Record<ListingDTO['status'], Tone>> = {
  ACTIVE: 'success',
  RESERVED: 'info',
  SOLD: 'info',
  PENDING_REVIEW: 'warning',
  REJECTED: 'danger',
};

/** Cursor-paged list that keeps earlier pages when "load more" is pressed (state resets when `key` changes). */
function usePaged<T>(
  load: (cursor: string | undefined, signal: AbortSignal) => Promise<CursorPage<T>>,
  key: string,
) {
  const [pages, setPages] = useState<{ key: string; cursors: (string | undefined)[] }>({
    key,
    cursors: [undefined],
  });
  const cursors = pages.key === key ? pages.cursors : [undefined];
  const state = useAsync(
    async (signal) => {
      const all: T[] = [];
      let next: string | undefined;
      for (const c of cursors) {
        const page = await load(c, signal);
        all.push(...page.items);
        next = page.nextCursor;
      }
      return { items: all, next };
    },
    [key, cursors.length],
  );
  const more = () => {
    if (state.data?.next) setPages({ key, cursors: [...cursors, state.data.next] });
  };
  return { ...state, more };
}

/**
 * `/farms/:farmId/trades` — "Trades": the farm's listings and orders, read from the existing marketplace and order APIs
 * (no separate trading system). Owners and managers only (`listings.manage`), enforced by the API.
 */
export default function TradesPage() {
  const t = useFarmsT();
  const animalLabel = useAnimalLabel();
  const tm = useT('market');
  const { date } = useFarmFormat();
  const { farmId = '' } = useParams();
  const { farm, can, loading: farmLoading } = useFarm(farmId);
  const [status, setStatus] = useState('');
  const allowed = can('listings.manage');
  const summary = useAsync(
    (signal) =>
      allowed
        ? api.request<FarmAnimalSummaryDTO>('GET', `/farms/${farmId}/summary`, { signal })
        : Promise.resolve(undefined),
    [farmId, allowed],
  );
  const listings = usePaged<ListingDTO>(
    (cursor, signal) =>
      allowed
        ? api.request<CursorPage<ListingDTO>>('GET', `/farms/${farmId}/listings`, {
            query: { limit: 20, ...(status ? { status } : {}), ...(cursor ? { cursor } : {}) },
            signal,
          })
        : Promise.resolve({ items: [] }),
    `${farmId}|${status}|${allowed}`,
  );
  const orders = usePaged<OrderDTO>(
    (cursor, signal) =>
      allowed
        ? api.request<CursorPage<OrderDTO>>('GET', `/farms/${farmId}/orders`, {
            query: { limit: 20, ...(cursor ? { cursor } : {}) },
            signal,
          })
        : Promise.resolve({ items: [] }),
    `${farmId}|${allowed}`,
  );

  if (farmLoading && !farm) return <p role="status">{t('common.loading')}</p>;
  if (farm && !allowed) return <Alert tone="warning">{t('trades.forbidden')}</Alert>;
  const trade = summary.data?.trade;
  const animalOrders = orders.data?.items.filter((o) => o.kind === 'animal') ?? [];
  const money = (minor: number | undefined | null) =>
    minor === undefined || minor === null ? '—' : formatBaht(minor);
  return (
    <>
      <p>
        <Link to={`/farms/${farmId}`}>{t('common.back')}</Link>
      </p>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <h1>{t('trades.title')}</h1>
        {farm?.status === 'active' && (
          <NavButton to={`/farms/${farmId}/listings/new`} variant="primary">
            {t('trades.newListing')}
          </NavButton>
        )}
      </div>
      <p>{t('trades.intro')}</p>
      {trade && (
        <div className="ds-grid ds-grid--3">
          {[
            [t('myFarm.listings'), trade.listingsTotal],
            [tm('listingStatus.ACTIVE'), trade.listingsByStatus['ACTIVE'] ?? 0],
            [tm('listingStatus.RESERVED'), trade.listingsByStatus['RESERVED'] ?? 0],
            [tm('listingStatus.SOLD'), trade.listingsByStatus['SOLD'] ?? 0],
            [t('myFarm.animalOrders'), trade.animalOrders],
          ].map(([label, value]) => (
            <Card key={String(label)}>
              <p>{label}</p>
              <p>
                <strong style={{ fontSize: '1.75rem' }}>{value}</strong>
              </p>
            </Card>
          ))}
        </div>
      )}

      <h2>{t('trades.listings')}</h2>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <Select
          label={t('trades.statusFilter')}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">{t('trades.allStatuses')}</option>
          {LISTING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tm(`listingStatus.${s}`)}
            </option>
          ))}
        </Select>
        <NavButton to={`/farms/${farmId}/listings`}>{t('trades.manage')}</NavButton>
      </div>
      {listings.error && (
        <Alert tone="danger">
          {listings.error}{' '}
          <button type="button" onClick={listings.reload}>
            {t('common.tryAgain')}
          </button>
        </Alert>
      )}
      {listings.loading && !listings.data && <p role="status">{t('common.loading')}</p>}
      {listings.data && (
        <Table<ListingDTO>
          caption={t('trades.listings')}
          rowKey={(l) => l.id}
          rows={listings.data.items}
          emptyMessage={t('trades.noListings')}
          columns={[
            {
              key: 'title',
              header: t('trades.col.title'),
              cell: (l) => <Link to={`/farms/${farmId}/listings/${l.id}`}>{l.title}</Link>,
            },
            {
              key: 'animal',
              header: t('trades.col.animal'),
              cell: (l) => (
                <Link to={`/farms/${farmId}/animals/${l.animalId}`}>{animalLabel(l.animal)}</Link>
              ),
            },
            {
              key: 'price',
              header: t('trades.col.asking'),
              cell: (l) => money(l.askingPriceMinor),
            },
            {
              key: 'status',
              header: t('trades.col.status'),
              cell: (l) => (
                <Badge tone={LISTING_TONE[l.status] ?? 'neutral'}>
                  {tm(`listingStatus.${l.status}`)}
                </Badge>
              ),
            },
            {
              key: 'sold',
              header: t('trades.col.soldPrice'),
              cell: (l) => (l.status === 'SOLD' ? money(l.reservation?.amountMinor) : '—'),
            },
            {
              key: 'date',
              header: t('trades.col.date'),
              cell: (l) => date(l.soldAt ?? l.activatedAt ?? l.createdAt),
            },
          ]}
        />
      )}
      {listings.data?.next && (
        <Button onClick={listings.more} loading={listings.loading}>
          {t('trades.loadMore')}
        </Button>
      )}

      <h2>{t('trades.orders')}</h2>
      {orders.error && (
        <Alert tone="danger">
          {orders.error}{' '}
          <button type="button" onClick={orders.reload}>
            {t('common.tryAgain')}
          </button>
        </Alert>
      )}
      {orders.loading && !orders.data && <p role="status">{t('common.loading')}</p>}
      {orders.data && (
        <Table<OrderDTO>
          caption={t('trades.orders')}
          rowKey={(o) => o.id}
          rows={animalOrders}
          emptyMessage={t('trades.noOrders')}
          columns={[
            {
              key: 'no',
              header: t('trades.col.order'),
              cell: (o) => <Link to={`/market/orders/${o.id}`}>{o.orderNo}</Link>,
            },
            {
              key: 'item',
              header: t('trades.col.animal'),
              cell: (o) => o.items.map((i) => i.title).join(', '),
            },
            // Public display name only: the buyer's contact details stay in the order itself.
            { key: 'buyer', header: t('trades.col.buyer'), cell: (o) => o.buyer.displayName },
            {
              key: 'price',
              header: t('trades.col.price'),
              cell: (o) => money(o.totals.itemsMinor),
            },
            {
              key: 'status',
              header: t('trades.col.status'),
              cell: (o) => tm(`orderStatus.${o.status}`),
            },
            {
              key: 'pay',
              header: t('trades.col.payment'),
              cell: (o) => <Badge tone={PAYMENT[o.status].tone}>{t(PAYMENT[o.status].key)}</Badge>,
            },
            { key: 'paid', header: t('trades.col.paidAt'), cell: (o) => date(o.paidAt) },
          ]}
        />
      )}
      {orders.data?.next && (
        <Button onClick={orders.more} loading={orders.loading}>
          {t('trades.loadMore')}
        </Button>
      )}
    </>
  );
}
