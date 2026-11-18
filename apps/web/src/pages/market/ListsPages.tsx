import { Link } from 'react-router-dom';
import type { ListingDTO, NegotiationDTO } from '@farmplus/shared-types';
import { formatBaht } from '@farmplus/shared-utils';
import { Alert, Badge, Button, Card } from '../../components/ui';
import { usePagedList } from '../community/usePagedList';
import {
  ListingCard,
  NEGOTIATION_TONE,
  negotiationStatusLabel,
  rich,
  useDateTime,
  useMarketT,
} from './common';

/** `/market/favorites` */
export function FavoritesPage() {
  const t = useMarketT();
  const list = usePagedList<ListingDTO>('/marketplace/favorites', { limit: 12 });
  return (
    <>
      <p>
        <Link to="/market">{t('nav.marketplace')}</Link>
      </p>
      <h1>{t('favorites.title')}</h1>
      {list.error && <Alert tone="danger">{list.error}</Alert>}
      <div className="ds-grid ds-grid--3">
        {list.items.map((l) => (
          <ListingCard key={l.id} listing={l} to={`/market/listing/${l.id}`} />
        ))}
      </div>
      {list.loading && <p role="status">{t('loading')}</p>}
      {!list.loading && !list.error && list.items.length === 0 && <p>{t('favorites.empty')}</p>}
      {list.hasMore && !list.loading && (
        <Button onClick={() => void list.loadMore()}>{t('loadMore')}</Button>
      )}
    </>
  );
}

export function NegotiationRow({ n, side }: { n: NegotiationDTO; side: 'buyer' | 'seller' }) {
  const t = useMarketT();
  const dateTime = useDateTime();
  return (
    <Card style={{ marginBottom: 'var(--ds-space-3)' }}>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <strong>
          <Link to={`/market/offers/${n.id}`}>{n.listingTitle}</Link>
        </strong>
        <span className="ds-row">
          <Badge tone={NEGOTIATION_TONE[n.status]}>{negotiationStatusLabel(t, n.status)}</Badge>
          {n.status === 'open' && n.viewer.canAct && (
            <Badge tone="warning">{t('row.yourTurn')}</Badge>
          )}
        </span>
      </div>
      <p style={{ margin: 0 }}>
        {side === 'buyer'
          ? t('row.seller', { name: n.seller.displayName })
          : t('row.buyer', { name: n.buyer.displayName })}{' '}
        ·{' '}
        {rich(t('row.onTable', { asking: formatBaht(n.askingPriceMinor) }), {
          amount: <strong>{formatBaht(n.currentOfferMinor)}</strong>,
        })}
      </p>
      <p className="ds-field__hint" style={{ margin: 0 }}>
        {t('row.updated', { date: dateTime(n.updatedAt) })}
      </p>
    </Card>
  );
}

/** `/market/offers` — the buyer's negotiations. */
export function MyOffersPage() {
  const t = useMarketT();
  const list = usePagedList<NegotiationDTO>('/marketplace/negotiations', { limit: 20 });
  return (
    <>
      <p>
        <Link to="/market">{t('nav.marketplace')}</Link>
      </p>
      <h1>{t('offers.title')}</h1>
      {list.error && <Alert tone="danger">{list.error}</Alert>}
      {list.items.map((n) => (
        <NegotiationRow key={n.id} n={n} side="buyer" />
      ))}
      {list.loading && <p role="status">{t('loading')}</p>}
      {!list.loading && !list.error && list.items.length === 0 && <p>{t('offers.empty')}</p>}
      {list.hasMore && !list.loading && (
        <Button onClick={() => void list.loadMore()}>{t('loadMore')}</Button>
      )}
    </>
  );
}
