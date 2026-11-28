import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  AdminOrderContactResponse,
  AdminOrderDetail,
  DeliveryAddress,
} from '@farmplus/shared-types';
import { api } from '../../../api';
import { StateMessage } from '../../../components/admin';
import { cap, useAdminI18n } from '../../../components/admin/i18n';
import { errorMessage } from '../../../lib/format';
import { useAsync } from '../../../lib/useAsync';
import { Tag, baht } from '../finance-common';
import { OrderStatusBadge } from '.';

/** `/admin/orders/:id` — one order, read-only. The delivery contact is masked until staff ask for it (audited). */
export default function OrderDetail() {
  const { id = '' } = useParams();
  const { t, label, status, dateTime } = useAdminI18n();
  const {
    data: o,
    loading,
    error,
    reload,
  } = useAsync(
    (signal) => api.request<AdminOrderDetail>('GET', `/admin/orders/${id}`, { signal }),
    [id],
  );

  if (error)
    return (
      <StateMessage kind="error" onRetry={reload}>
        {error}
      </StateMessage>
    );
  if (loading && !o) return <StateMessage kind="loading" />;
  if (!o) return null;
  const fee = o.feeSnapshot;

  return (
    <>
      <p>
        <Link to="/admin/orders">{t('orderDetail.back')}</Link>
      </p>
      <h1>{o.orderNo}</h1>
      <p className="adm-muted">{t('orderDetail.readOnly')}</p>

      <section className="adm-card" aria-labelledby="o-summary">
        <h2 id="o-summary">{t('orderDetail.summary')}</h2>
        <dl className="adm-dl">
          <dt>{t('orders.orderStatus')}</dt>
          <dd>
            <OrderStatusBadge status={o.status} />
          </dd>
          <dt>{t('orders.payment')}</dt>
          <dd>
            <Tag value={o.paymentStatus} />
          </dd>
          <dt>{t('orders.kind')}</dt>
          <dd>{label('orderKind', o.kind)}</dd>
          <dt>{t('orders.buyer')}</dt>
          <dd>{o.buyer.displayName}</dd>
          <dt>{t('orderDetail.seller')}</dt>
          <dd>{o.seller.displayName}</dd>
          <dt>{t('orders.farm')}</dt>
          <dd>{o.farm.name}</dd>
          <dt>{t('orderDetail.fulfillment')}</dt>
          <dd>{label('fulfillment', o.fulfillment)}</dd>
          {o.shipping && (
            <>
              <dt>{t('orderDetail.shippingOption')}</dt>
              <dd>{o.shipping.label}</dd>
            </>
          )}
          <dt>{t('common.created')}</dt>
          <dd>{dateTime(o.createdAt)}</dd>
          {o.status === 'PENDING_PAYMENT' && (
            <>
              <dt>{t('orderDetail.paymentDue')}</dt>
              <dd>{dateTime(o.paymentDueAt)}</dd>
            </>
          )}
          <dt>{t('orderDetail.paidAt')}</dt>
          <dd>{dateTime(o.paidAt)}</dd>
          <dt>{t('orderDetail.deliveredAt')}</dt>
          <dd>{dateTime(o.deliveredAt)}</dd>
          {o.cancelReason && (
            <>
              <dt>{t('orderDetail.cancelReason')}</dt>
              <dd>{o.cancelReason}</dd>
            </>
          )}
        </dl>
      </section>

      <section className="adm-card" aria-labelledby="o-items">
        <h2 id="o-items">{t('orderDetail.items')}</h2>
        <div className="adm-table-scroll">
          <table className="adm-table" aria-label={t('orderDetail.items')}>
            <thead>
              <tr>
                <th scope="col">{t('orderDetail.item')}</th>
                <th scope="col">{t('orderDetail.qty')}</th>
                <th scope="col">{t('orderDetail.unitPrice')}</th>
                <th scope="col">{t('orderDetail.lineTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {o.items.map((item, i) => (
                <tr key={i}>
                  <td>{item.title}</td>
                  <td>{item.quantity}</td>
                  <td>{baht(item.unitPriceMinor)}</td>
                  <td>{baht(item.totalMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>{t('orderDetail.totals')}</h3>
        <dl className="adm-dl">
          <dt>{t('orderDetail.itemsTotal')}</dt>
          <dd>{baht(o.totals.itemsMinor)}</dd>
          <dt>{t('orderDetail.shipping')}</dt>
          <dd>{baht(o.totals.shippingMinor)}</dd>
          <dt>{t('orderDetail.grandTotal')}</dt>
          <dd>
            <strong>{baht(o.totals.grandTotalMinor)}</strong>
          </dd>
          <dt>{t('orderDetail.platformFee')}</dt>
          <dd>{baht(o.totals.platformFeeMinor)}</dd>
          <dt>{t('orderDetail.sellerPayout')}</dt>
          <dd>{baht(o.totals.sellerPayoutMinor)}</dd>
          {fee && (
            <>
              <dt>{t('orderDetail.feeRule')}</dt>
              <dd>
                {fee.ruleName ?? '—'} ({fee.feeBps / 100}%)
              </dd>
            </>
          )}
        </dl>
      </section>

      <ContactCard order={o} />

      <section className="adm-card" aria-labelledby="o-payments">
        <h2 id="o-payments">{t('orderDetail.payments')}</h2>
        {o.payments.length === 0 ? (
          <StateMessage kind="empty">{t('orderDetail.noPayments')}</StateMessage>
        ) : (
          <ul>
            {o.payments.map((p) => (
              <li key={p.id}>
                {baht(p.amountMinor)} <Tag value={p.status} /> · {t('orderDetail.provider')}:{' '}
                {p.provider} {p.providerRef && <code>{p.providerRef}</code>} ·{' '}
                {dateTime(p.createdAt)}
              </li>
            ))}
          </ul>
        )}
        <p>
          <Link to="/admin/payments">{t('orderDetail.allPayments')}</Link>
        </p>
      </section>

      <section className="adm-card" aria-labelledby="o-refunds">
        <h2 id="o-refunds">{t('orderDetail.refunds')}</h2>
        {o.refunds.length === 0 ? (
          <StateMessage kind="empty">{t('orderDetail.noRefunds')}</StateMessage>
        ) : (
          <ul>
            {o.refunds.map((r) => (
              <li key={r.id}>
                <code>{r.refundNo}</code> {baht(r.amountMinor)} <Tag value={r.status} /> ·{' '}
                {r.reason} · {dateTime(r.requestedAt)}
              </li>
            ))}
          </ul>
        )}
        <p>
          <Link to="/admin/refunds">{t('orderDetail.allRefunds')}</Link>
        </p>
      </section>

      <section className="adm-card" aria-labelledby="o-shipments">
        <h2 id="o-shipments">{t('orderDetail.shipments')}</h2>
        {o.shipments.length === 0 ? (
          <StateMessage kind="empty">{t('orderDetail.noShipments')}</StateMessage>
        ) : (
          o.shipments.map((s) => (
            <div key={s.id}>
              <h3>
                {t('orderDetail.attempt', { n: s.attempt })} · {cap(status(s.status))}
              </h3>
              <dl className="adm-dl">
                <dt>{t('orderDetail.carrier')}</dt>
                <dd>{s.carrier}</dd>
                <dt>{t('orderDetail.tracking')}</dt>
                <dd>{s.trackingNumber ? <code>{s.trackingNumber}</code> : '—'}</dd>
              </dl>
              <ol>
                {s.events.map((e, i) => (
                  <li key={i}>
                    {dateTime(e.at)} · {cap(status(e.status))}
                    {e.location ? ` · ${e.location}` : ''}
                    {e.note ? ` · ${e.note}` : ''}
                  </li>
                ))}
              </ol>
            </div>
          ))
        )}
      </section>

      <section className="adm-card" aria-labelledby="o-timeline">
        <h2 id="o-timeline">{t('orderDetail.timeline')}</h2>
        <ol>
          {o.history.map((h, i) => (
            <li key={i}>
              {dateTime(h.at)} · <OrderStatusBadge status={h.to} /> · {t('orderDetail.by')}{' '}
              {label('orderActor', h.by)}
              {h.actor ? ` (${h.actor.displayName})` : ''}
              {h.reason ? ` · ${h.reason}` : ''}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function ContactCard({ order }: { order: AdminOrderDetail }) {
  const { t } = useAdminI18n();
  const [address, setAddress] = useState<DeliveryAddress | null>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const c = order.contact;

  const reveal = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.request<AdminOrderContactResponse>(
        'POST',
        `/admin/orders/${order.id}/contact`,
      );
      setAddress(res.address);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="adm-card" aria-labelledby="o-contact">
      <h2 id="o-contact">{t('orderDetail.contact')}</h2>
      {!c.hasAddress ? (
        <p className="adm-muted">{t('orderDetail.noContact')}</p>
      ) : address ? (
        <dl className="adm-dl">
          <dt>{t('orderDetail.recipient')}</dt>
          <dd>{address.recipientName}</dd>
          <dt>{t('orderDetail.phone')}</dt>
          <dd>{address.phone}</dd>
          <dt>{t('orderDetail.address')}</dt>
          <dd>
            {[
              address.line1,
              address.subdistrict,
              address.district,
              address.province,
              address.postalCode,
            ]
              .filter(Boolean)
              .join(', ')}
            {address.note ? ` (${address.note})` : ''}
          </dd>
        </dl>
      ) : (
        <>
          <p className="adm-muted">{t('orderDetail.contactMasked')}</p>
          <dl className="adm-dl">
            <dt>{t('orderDetail.province')}</dt>
            <dd>{c.province ?? '—'}</dd>
            {c.district && (
              <>
                <dt>{t('orderDetail.district')}</dt>
                <dd>{c.district}</dd>
              </>
            )}
            <dt>{t('orderDetail.phone')}</dt>
            <dd>{c.phoneLast4 ? t('orderDetail.phoneMasked', { last4: c.phoneLast4 }) : '—'}</dd>
          </dl>
          <div className="adm-actions">
            <button className="adm-btn" disabled={busy} onClick={() => void reveal()}>
              {busy ? t('common.working') : t('orderDetail.showContact')}
            </button>
            <span className="adm-muted">{t('orderDetail.showContactNote')}</span>
          </div>
          {error && (
            <p className="adm-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
