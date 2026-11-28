import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type {
  FarmSummary,
  ListingDTO,
  ListingEventDTO,
  NegotiationDTO,
  OrderDTO,
  Page,
} from '@farmplus/shared-types';
import { formatBaht } from '@farmplus/shared-utils';
import { api } from '../../api';
import { Alert, Button, Card, Modal, Select, Textarea } from '../../components/ui';
import { errorMessage } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { usePagedList } from '../community/usePagedList';
import { useFarm } from '../farms/useFarmAccess';
import {
  codeLabel,
  ListingCard,
  ListingStatusBadge,
  listingStatusLabel,
  rich,
  useDateTime,
  useMarketT,
} from './common';
import { ListingForm } from './ListingForm';
import { NegotiationRow } from './ListsPages';
import { OrderRow } from './orderCommon';
import { useCanSell } from '../../lib/sellEligibility';
import { SellerRequiredNotice } from '../farms/SellerRequiredNotice';

/** `/market/sell` — pick the farm you sell for (selling itself happens in My Farm). */
export function SellFarmsPage() {
  const canSell = useCanSell();
  const t = useMarketT();
  const farms = useAsync(
    (signal) =>
      api.request<Page<FarmSummary>>('GET', '/farms', { query: { pageSize: 50 }, signal }),
    [],
  );
  const mine =
    farms.data?.items.filter((f) => f.myRole === 'owner' || f.myRole === 'manager') ?? [];
  return (
    <>
      <p>
        <Link to="/market">{t('nav.marketplace')}</Link>
      </p>
      <h1>{t('sell.title')}</h1>
      <p>
        <Link to="/market/wallet" data-tour="market-sell-earnings">
          {t('sell.earnings')}
        </Link>
      </p>
      {farms.error && <Alert tone="danger">{farms.error}</Alert>}
      <p>{t('sell.intro')}</p>
      {/* Not an approved seller yet: say so here, before a farm and a form (QA, 28 Nov). */}
      {!canSell && <SellerRequiredNotice message={t('sell.sellerRequired')} />}
      {mine.map((f) => (
        <Card
          key={f.id}
          title={f.name}
          headingLevel={2}
          style={{ marginBottom: 'var(--ds-space-3)' }}
        >
          <Link
            to={`/farms/${f.id}/listings`}
            className="ds-btn ds-btn--primary"
            data-tour="market-sell-farm"
          >
            {t('sell.openListings')}
          </Link>
        </Card>
      ))}
      {!farms.loading && mine.length === 0 && (
        <p data-tour="market-sell-no-farms">{t('sell.noFarms')}</p>
      )}
    </>
  );
}

/** `/farms/:farmId/listings` — the farm's listings and offers inbox (inside My Farm). */
export function SellListingsPage() {
  const t = useMarketT();
  const { farmId = '' } = useParams();
  const { farm } = useFarm(farmId);
  const list = usePagedList<ListingDTO>(`/farms/${farmId}/listings`, { limit: 12 });
  const inbox = usePagedList<NegotiationDTO>(`/farms/${farmId}/negotiations`, {
    status: 'open',
    limit: 10,
  });
  const orders = usePagedList<OrderDTO>(`/farms/${farmId}/orders`, { limit: 10 });
  return (
    <>
      <p>
        <Link to={`/farms/${farmId}`}>← {farm?.name ?? t('sellList.farm')}</Link>
      </p>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <h1>{t('sellList.title', { farm: farm?.name ?? t('sellList.farm') })}</h1>
        <Link to={`/farms/${farmId}/listings/new`} className="ds-btn ds-btn--primary">
          {t('sellList.new')}
        </Link>
      </div>
      {list.error && <Alert tone="danger">{list.error}</Alert>}
      <div className="ds-grid ds-grid--3">
        {list.items.map((l) => (
          <ListingCard key={l.id} listing={l} to={`/farms/${farmId}/listings/${l.id}`} />
        ))}
      </div>
      {!list.loading && !list.error && list.items.length === 0 && <p>{t('sellList.empty')}</p>}
      {list.hasMore && !list.loading && (
        <Button onClick={() => void list.loadMore()}>{t('loadMore')}</Button>
      )}
      <h2>{t('sellList.openOffers')}</h2>
      {inbox.items.map((n) => (
        <NegotiationRow key={n.id} n={n} side="seller" />
      ))}
      {!inbox.loading && inbox.items.length === 0 && <p>{t('sellList.noOpenOffers')}</p>}
      <h2>{t('sellList.orders')}</h2>
      {orders.items.map((o) => (
        <OrderRow key={o.id} order={o} to={`/market/orders/${o.id}`} />
      ))}
      {!orders.loading && orders.items.length === 0 && <p>{t('sellList.noOrders')}</p>}
    </>
  );
}

/** `/farms/:farmId/listings/new?animalId=` */
export function NewListingPage() {
  const t = useMarketT();
  const { farmId = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  return (
    <>
      <p>
        <Link to={`/farms/${farmId}/listings`} data-tour="listing-back-to-listings">
          {t('nav.listings')}
        </Link>
      </p>
      <h1>{t('newListing.title')}</h1>
      <ListingForm
        farmId={farmId}
        animalId={search.get('animalId') ?? undefined}
        onSaved={(l) => navigate(`/farms/${farmId}/listings/${l.id}`)}
        onCancel={() => navigate(`/farms/${farmId}/listings`)}
      />
    </>
  );
}

type Action = 'submit' | 'pause' | 'resume' | 'renew' | 'cancel' | 'sold';
/** Labels and explanations are `action.<action>.label` / `action.<action>.text` in the market catalog. */
const COPY: Record<Action, { danger?: boolean; reason?: boolean }> = {
  submit: {},
  pause: { reason: true },
  resume: {},
  renew: {},
  cancel: { danger: true, reason: true },
  sold: { danger: true },
};
const ACTIONS: Record<string, Action[]> = {
  DRAFT: ['submit', 'cancel'],
  PENDING_REVIEW: ['cancel'],
  ACTIVE: ['pause', 'sold', 'cancel'],
  RESERVED: ['sold'],
  PAUSED: ['resume', 'cancel'],
  REJECTED: ['cancel'],
  EXPIRED: ['renew', 'cancel'],
};

/** `/farms/:farmId/listings/:id` — manage one listing: status actions, edit, history, offers. */
export function ManageListingPage() {
  const t = useMarketT();
  const dateTime = useDateTime();
  const { farmId = '', id = '' } = useParams();
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const base = `/farms/${farmId}/listings/${id}`;
  const listing = useAsync(
    (signal) => api.request<{ listing: ListingDTO }>('GET', base, { signal }),
    [base, version],
  );
  const events = useAsync(
    (signal) => api.request<{ events: ListingEventDTO[] }>('GET', `${base}/events`, { signal }),
    [base, version],
  );
  const offers = usePagedList<NegotiationDTO>(`/farms/${farmId}/negotiations`, {
    listingId: id,
    limit: 20,
  });
  void Select;

  if (listing.error) return <Alert tone="danger">{listing.error}</Alert>;
  const l = listing.data?.listing;
  if (!l) return <p role="status">{t('loading')}</p>;
  const editable =
    ['DRAFT', 'REJECTED', 'PAUSED'].includes(l.status) && l.review?.pausedBy !== 'moderator';

  const run = async () => {
    if (!action) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.request('POST', `${base}/${action}`, {
        body: reason.trim() ? { reason: reason.trim() } : {},
      });
      setAction(null);
      setReason('');
      setVersion((v) => v + 1);
      void offers.reload();
    } catch (e) {
      setError(errorMessage(e));
      setAction(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p>
        <Link to={`/farms/${farmId}/listings`}>{t('nav.listings')}</Link>
      </p>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <h1>{l.title}</h1>
        <ListingStatusBadge status={l.status} />
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {l.status === 'REJECTED' && l.review?.rejectedReason && (
        <Alert tone="warning">{t('manage.rejected', { reason: l.review.rejectedReason })}</Alert>
      )}
      {l.status === 'PAUSED' && l.review?.pausedBy === 'moderator' && (
        <Alert tone="warning">
          {l.review.pausedReason
            ? t('manage.pausedByModReason', { reason: l.review.pausedReason })
            : t('manage.pausedByMod')}
        </Alert>
      )}
      {l.status === 'RESERVED' && l.reservation && (
        <Alert tone="info">
          {rich(
            t('manage.reserved', {
              amount: formatBaht(l.reservation.amountMinor),
              date: dateTime(l.reservation.expiresAt),
            }),
            {
              link: (
                <Link to={`/market/offers/${l.reservation.negotiationId}`}>
                  {t('manage.openDeal')}
                </Link>
              ),
            },
          )}
        </Alert>
      )}
      <div className="ds-row" style={{ margin: 'var(--ds-space-3) 0' }}>
        {editable && (
          <Button variant="primary" onClick={() => setEditing((e) => !e)}>
            {editing ? t('manage.closeEditor') : t('manage.edit')}
          </Button>
        )}
        {(ACTIONS[l.status] ?? []).map((a) => (
          <Button
            key={a}
            variant={COPY[a].danger ? 'danger' : 'secondary'}
            onClick={() => {
              setAction(a);
              setReason('');
            }}
          >
            {t(`action.${a}.label`)}
          </Button>
        ))}
        <Link to={`/market/listing/${l.id}`} className="ds-btn">
          {t('manage.publicView')}
        </Link>
      </div>

      {editing ? (
        <ListingForm
          farmId={farmId}
          listing={l}
          onSaved={() => {
            setEditing(false);
            setVersion((v) => v + 1);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="ds-grid ds-grid--2">
          <ListingCard listing={l} to={`/market/listing/${l.id}`} />
          <Card title={t('manage.terms')} headingLevel={2}>
            <p>
              {rich(
                t('manage.asking', {
                  mode: l.negotiable ? t('manage.openToOffers') : t('manage.fixedPrice'),
                }),
                { amount: <strong>{formatBaht(l.askingPriceMinor)}</strong> },
              )}
            </p>
            {l.minOfferMinor && (
              <p>
                {t('manage.lowest', { amount: formatBaht(l.minOfferMinor) })}{' '}
                <span className="ds-field__hint">{t('manage.private')}</span>
              </p>
            )}
            {l.expiresAt && (
              <p className="ds-field__hint">
                {t('manage.activeUntil', { date: dateTime(l.expiresAt) })}
              </p>
            )}
            {l.conditions && <p style={{ whiteSpace: 'pre-wrap' }}>{l.conditions}</p>}
          </Card>
        </div>
      )}

      <h2>{t('manage.offers')}</h2>
      {offers.items.map((n) => (
        <NegotiationRow key={n.id} n={n} side="seller" />
      ))}
      {!offers.loading && offers.items.length === 0 && <p>{t('manage.noOffers')}</p>}

      <Card title={t('history')} headingLevel={2}>
        <ol
          style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--ds-space-2)' }}
          aria-label={t('manage.historyAria')}
        >
          {(events.data?.events ?? []).map((e) => (
            <li key={e.id}>
              <strong>{codeLabel(t, 'listingEvent', e.type.replace('.', '_'))}</strong>
              {e.from && e.to
                ? ` (${listingStatusLabel(t, e.from)} → ${listingStatusLabel(t, e.to)})`
                : ''}
              {e.data && typeof e.data['amountMinor'] === 'number'
                ? ` · ${formatBaht(e.data['amountMinor'])}`
                : ''}
              <span className="ds-field__hint">
                {' '}
                · {e.actor?.displayName ?? t('manage.system')} · {dateTime(e.at)}
              </span>
              {e.data && typeof e.data['reason'] === 'string' && (
                <span className="ds-field__hint"> — “{e.data['reason']}”</span>
              )}
            </li>
          ))}
        </ol>
      </Card>

      <Modal
        open={action !== null}
        onClose={() => setAction(null)}
        title={action ? t(`action.${action}.label`) : ''}
        footer={
          <>
            <Button onClick={() => setAction(null)}>{t('back')}</Button>
            <Button
              variant={action && COPY[action].danger ? 'danger' : 'primary'}
              loading={busy}
              onClick={() => void run()}
            >
              {action ? t(`action.${action}.label`) : ''}
            </Button>
          </>
        }
      >
        <p>{action ? t(`action.${action}.text`) : ''}</p>
        {action && COPY[action].reason && (
          <Textarea
            label={t('manage.reason')}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Modal>
    </>
  );
}
