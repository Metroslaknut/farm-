import { Link } from 'react-router-dom';
import type { OrderDTO } from '@farmplus/shared-types';
import { Alert, Button } from '../../components/ui';
import { usePagedList } from '../community/usePagedList';
import { useMarketT } from './common';
import { OrderRow } from './orderCommon';

/** `/market/orders` — the buyer's orders. */
export default function MyOrdersPage() {
  const t = useMarketT();
  const list = usePagedList<OrderDTO>('/orders', { limit: 20 });
  return (
    <>
      <p>
        <Link to="/market">{t('nav.marketplace')}</Link>
      </p>
      <h1>{t('orders.title')}</h1>
      {list.error && <Alert tone="danger">{list.error}</Alert>}
      {list.items.map((o) => (
        <OrderRow key={o.id} order={o} to={`/market/orders/${o.id}`} />
      ))}
      {list.loading && <p role="status">{t('loading')}</p>}
      {!list.loading && !list.error && list.items.length === 0 && <p>{t('orders.empty')}</p>}
      {list.hasMore && !list.loading && (
        <Button onClick={() => void list.loadMore()}>{t('loadMore')}</Button>
      )}
    </>
  );
}
