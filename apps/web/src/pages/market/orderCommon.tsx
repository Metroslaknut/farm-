import { Link } from 'react-router-dom';
import type { OrderDTO, OrderStatus } from '@farmplus/shared-types';
import { formatBaht } from '@farmplus/shared-utils';
import { Badge, Card, type Tone } from '../../components/ui';
import { useDateTime, useMarketT, type MarketT } from './common';

export const ORDER_TONE: Record<OrderStatus, Tone> = {
  PENDING_PAYMENT: 'warning',
  PAID: 'info',
  PROCESSING: 'info',
  SHIPPED: 'info',
  DELIVERED: 'success',
  CANCELLED: 'neutral',
  REFUND_PENDING: 'warning',
  REFUNDED: 'neutral',
};
export const orderStatusLabel = (t: MarketT, s: OrderStatus): string => t(`orderStatus.${s}`);

export const daysText = (t: MarketT, d?: { min: number; max: number }): string =>
  d ? (d.min === d.max ? t('days', { n: d.min }) : t('daysRange', { min: d.min, max: d.max })) : '';

/** Price lines that keep item price, shipping and (for the seller) platform fee visibly separate. */
export function TotalsTable({
  order,
  party,
}: {
  order: Pick<OrderDTO, 'totals' | 'fulfillment' | 'shipping'> & { kind?: OrderDTO['kind'] };
  party: 'buyer' | 'seller';
}) {
  const t = useMarketT();
  const totals = order.totals;
  return (
    <table className="ds-table" aria-label={t('totals.aria')}>
      <tbody>
        <tr>
          <th scope="row">{order.kind === 'product' ? t('totals.items') : t('totals.animal')}</th>
          <td style={{ textAlign: 'right' }}>{formatBaht(totals.itemsMinor)}</td>
        </tr>
        <tr>
          <th scope="row">
            {order.shipping?.isEstimate ? t('totals.shippingEstimate') : t('totals.shipping')}
          </th>
          <td style={{ textAlign: 'right' }}>
            {order.fulfillment === 'pickup'
              ? t('totals.pickupFree')
              : formatBaht(totals.shippingMinor)}
          </td>
        </tr>
        <tr>
          <th scope="row">
            <strong>{t('totals.total')}</strong>
          </th>
          <td style={{ textAlign: 'right' }}>
            <strong>{formatBaht(totals.grandTotalMinor)}</strong>
          </td>
        </tr>
        {party === 'seller' && (
          <>
            <tr>
              <th scope="row">{t('totals.fee')}</th>
              <td style={{ textAlign: 'right' }}>−{formatBaht(totals.platformFeeMinor)}</td>
            </tr>
            <tr>
              <th scope="row">
                {order.kind === 'product' ? t('totals.payoutItems') : t('totals.payoutAnimal')}
              </th>
              <td style={{ textAlign: 'right' }}>{formatBaht(totals.sellerPayoutMinor)}</td>
            </tr>
          </>
        )}
      </tbody>
    </table>
  );
}

export function OrderRow({ order, to }: { order: OrderDTO; to: string }) {
  const t = useMarketT();
  const dateTime = useDateTime();
  return (
    <Card style={{ marginBottom: 'var(--ds-space-3)' }}>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <strong>
          <Link to={to}>{order.items[0]?.title ?? order.orderNo}</Link>
        </strong>
        <Badge tone={ORDER_TONE[order.status]}>{orderStatusLabel(t, order.status)}</Badge>
      </div>
      <p style={{ margin: 0 }}>
        {order.orderNo} · {formatBaht(order.totals.grandTotalMinor)} ·{' '}
        {t(`delivery.${order.fulfillment}`)}
      </p>
      <p className="ds-field__hint" style={{ margin: 0 }}>
        {order.viewer.party === 'buyer'
          ? t('row.seller', { name: order.seller.displayName })
          : t('row.buyer', { name: order.buyer.displayName })}{' '}
        · {dateTime(order.createdAt)}
      </p>
    </Card>
  );
}
