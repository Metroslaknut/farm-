import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  DeliveryAddress,
  OrderDTO,
  ShipmentStatus,
  ShippingQuoteDTO,
} from '@farmplus/shared-types';
import { formatBaht, localName } from '@farmplus/shared-utils';
import { useLocale } from '../../i18n';
import { shopCategories } from '../../lib/shopCategories';
import { api } from '../../api';
import {
  Alert,
  Badge,
  Button,
  Card,
  Modal,
  Select,
  TextField,
  Textarea,
} from '../../components/ui';
import { errorMessage } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { codeLabel, sexLabel, useAnimalLabel, useDateTime, useMarketT } from './common';
import { ORDER_TONE, TotalsTable, daysText, orderStatusLabel } from './orderCommon';
import { PayPanel } from './PayPanel';

const STEPS = ['PENDING_PAYMENT', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] as const;
const SHIPMENT_NEXT: ShipmentStatus[] = ['out_for_delivery', 'delivered', 'failed', 'returned'];

type Dialog = 'cancel' | 'ship' | 'requote' | null;

/** `/market/orders/:id` — one order for the buyer and the seller side: status, tracking, totals, address and the actions each may take. */
export default function OrderPage() {
  const { id = '' } = useParams();
  const t = useMarketT();
  const animalLabel = useAnimalLabel();
  const dateTime = useDateTime();
  const [locale] = useLocale();
  // The order keeps the category's English name: show the shop's Thai name for its key when there is one.
  const categories = useAsync(() => shopCategories(), []);
  const categoryName = (key: string, name: string) => {
    const c = categories.data?.categories?.find((x) => x.key === key);
    return c ? localName(c, locale) : name;
  };
  const [version, setVersion] = useState(0);
  const { data, error, loading } = useAsync(
    (signal) => api.request<{ order: OrderDTO }>('GET', `/orders/${id}`, { signal }),
    [id, version],
  );
  const [dialog, setDialog] = useState<Dialog>(null);
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [ship, setShip] = useState({ carrier: '', trackingNumber: '', min: '', max: '' });
  const [rq, setRq] = useState<DeliveryAddress>({
    recipientName: '',
    phone: '',
    line1: '',
    district: '',
    province: '',
    postalCode: '',
  });
  const [quote, setQuote] = useState<ShippingQuoteDTO>();
  const [ack, setAck] = useState(false);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (loading && !data) return <p role="status">{t('loading')}</p>;
  const o = data?.order;
  if (!o) return null;
  const me = o.viewer.party;
  const base = `/orders/${o.id}`;
  const reload = () => setVersion((v) => v + 1);
  const run = async (path: string, body: object = {}) => {
    setBusy(true);
    setMsg(undefined);
    try {
      await api.request('POST', `${base}/${path}`, { body });
      setDialog(null);
      setReason('');
      reload();
    } catch (e) {
      setMsg(errorMessage(e));
      setDialog(null);
      reload();
    } finally {
      setBusy(false);
    }
  };
  const stepIndex = STEPS.indexOf(o.status as (typeof STEPS)[number]);
  const shipment = o.shipments.at(-1);

  const getRequote = async () => {
    const first = o.items[0];
    if (!first || first.type !== 'animal') return;
    setBusy(true);
    setMsg(undefined);
    try {
      setQuote(
        (
          await api.request<{ quote: ShippingQuoteDTO }>('POST', '/shipping/quotes', {
            body: {
              listingId: first.listingId,
              destination: { province: rq.province.trim() },
            },
          })
        ).quote,
      );
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p>
        <Link to={me === 'buyer' ? '/market/orders' : '/market/sell'}>
          {me === 'buyer' ? t('nav.myOrders') : t('nav.selling')}
        </Link>
      </p>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <h1>{t('order.title', { no: o.orderNo })}</h1>
        <Badge tone={ORDER_TONE[o.status]}>{orderStatusLabel(t, o.status)}</Badge>
      </div>
      {msg && <Alert tone="danger">{msg}</Alert>}

      {stepIndex >= 0 && (
        <ol
          className="ds-row"
          aria-label={t('order.progressAria')}
          style={{ listStyle: 'none', padding: 0, flexWrap: 'wrap' }}
        >
          {STEPS.filter((s) => o.fulfillment === 'delivery' || s !== 'SHIPPED').map((s) => (
            <li key={s}>
              <Badge tone={STEPS.indexOf(s) <= stepIndex ? 'success' : 'neutral'}>
                {STEPS.indexOf(s) < stepIndex ? '✓ ' : ''}
                {orderStatusLabel(t, s)}
              </Badge>
            </li>
          ))}
        </ol>
      )}
      {o.status === 'PENDING_PAYMENT' && (
        <Alert tone="warning">
          {me === 'buyer' ? t('order.waitBuyer') : t('order.waitSeller')}
          {o.paymentDueAt
            ? t('order.dueSuffix', { date: dateTime(o.paymentDueAt) })
            : t('order.noDueSuffix')}{' '}
          {t('order.autoConfirm')}
        </Alert>
      )}
      {o.status === 'PENDING_PAYMENT' && me === 'buyer' && (
        <PayPanel order={o} onChanged={reload} />
      )}
      {o.status === 'REFUND_PENDING' && (
        <Alert tone="warning">
          {t('order.refundPending', { amount: formatBaht(o.totals.grandTotalMinor) })}
          {o.cancelReason
            ? t('order.reasonSuffix', { reason: codeLabel(t, 'reason', o.cancelReason) })
            : ''}
        </Alert>
      )}
      {o.status === 'REFUNDED' && <Alert tone="info">{t('order.refunded')}</Alert>}
      {o.status === 'CANCELLED' && (
        <Alert tone="info">
          {o.cancelReason
            ? t('order.cancelledReason', { reason: codeLabel(t, 'reason', o.cancelReason) })
            : t('order.cancelled')}
        </Alert>
      )}
      {o.status === 'SHIPPED' && o.deliveredAt && me === 'buyer' && (
        <Alert tone="success">{t('order.carrierDelivered')}</Alert>
      )}

      <div className="ds-grid ds-grid--2">
        <div>
          <Card
            title={o.kind === 'product' ? t('totals.items') : t('totals.animal')}
            headingLevel={2}
            style={{ marginBottom: 'var(--ds-space-4)' }}
          >
            {o.items.map((i) =>
              i.type === 'animal' ? (
                <div key={i.animalId}>
                  <strong>{i.title}</strong>
                  <p className="ds-field__hint" style={{ margin: 0 }}>
                    {animalLabel(i.animal)} · {sexLabel(t, i.animal.sex)}
                  </p>
                  <p style={{ margin: 0 }}>
                    {formatBaht(i.unitPriceMinor)} × {i.quantity}{' '}
                    <span className="ds-field__hint">{t('order.priceFixed')}</span>
                  </p>
                </div>
              ) : (
                <div key={i.productId} style={{ marginBottom: 'var(--ds-space-3)' }}>
                  <strong>{i.title}</strong>
                  <p className="ds-field__hint" style={{ margin: 0 }}>
                    {[
                      categoryName(i.categoryKey, i.categoryName),
                      i.brand,
                      i.sku && t('order.sku', { sku: i.sku }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {i.specs.length > 0 && (
                    <p className="ds-field__hint" style={{ margin: 0 }}>
                      {i.specs.map((x) => `${x.name}: ${x.value}`).join(' · ')}
                    </p>
                  )}
                  <p style={{ margin: 0 }}>
                    {formatBaht(i.unitPriceMinor)}
                    {i.unit ? ` / ${i.unit}` : ''} × {i.quantity} = {formatBaht(i.totalMinor)}{' '}
                    <span className="ds-field__hint">
                      {i.priceSource === 'promotion'
                        ? t('order.priceFixedPromo', { amount: formatBaht(i.regularPriceMinor) })
                        : t('order.priceFixed')}
                    </span>
                  </p>
                  <Link to={`/shop/product/${i.productId}`}>{t('order.viewProduct')}</Link>
                </div>
              ),
            )}
            <p className="ds-field__hint">
              {me === 'buyer'
                ? t('order.sellerLine', { name: o.seller.displayName, farm: o.farmName })
                : t('row.buyer', { name: o.buyer.displayName })}
            </p>
          </Card>
          <Card
            title={t('order.totals')}
            headingLevel={2}
            style={{ marginBottom: 'var(--ds-space-4)' }}
          >
            <TotalsTable order={o} party={me} />
          </Card>
          {o.fulfillment === 'delivery' && (
            <Card title={t('order.delivery')} headingLevel={2}>
              {o.shipping && (
                <p>
                  {o.shipping.label} ·{' '}
                  {o.shipping.source === 'seller_rule'
                    ? t('order.rateSeller')
                    : t('order.rateProvider')}
                  {o.shipping.estimatedDays && (
                    <>
                      {' '}
                      · {t('about', { days: daysText(t, o.shipping.estimatedDays) })}{' '}
                      <Badge>{t('estimate')}</Badge>
                    </>
                  )}
                </p>
              )}
              {o.shipping && o.shipping.requirements.length > 0 && (
                <p>
                  {t('order.requirements', {
                    list: o.shipping.requirements.map((r) => t(`transport.${r}`)).join(', '),
                  })}
                </p>
              )}
              {o.address ? (
                <address style={{ fontStyle: 'normal' }}>
                  <strong>{o.address.recipientName}</strong> · {o.address.phone}
                  <br />
                  {o.address.line1}
                  {o.address.subdistrict ? `, ${o.address.subdistrict}` : ''}
                  <br />
                  {o.address.district}, {o.address.province} {o.address.postalCode}
                  {o.address.note && (
                    <>
                      <br />
                      <em>{o.address.note}</em>
                    </>
                  )}
                </address>
              ) : (
                <p className="ds-field__hint">
                  {t('order.region', {
                    region: [o.destination?.province, o.destination?.district]
                      .filter(Boolean)
                      .join(', '),
                  })}{' '}
                  {me === 'seller' ? t('order.addressAfterPay') : ''}
                </p>
              )}
            </Card>
          )}
        </div>
        <div>
          <Card
            title={t('order.actions')}
            headingLevel={2}
            style={{ marginBottom: 'var(--ds-space-4)' }}
          >
            <div className="ds-row">
              {o.actions.canProcess && (
                <Button variant="primary" loading={busy} onClick={() => void run('process')}>
                  {t('order.process')}
                </Button>
              )}
              {o.actions.canShip && (
                <Button variant="primary" onClick={() => setDialog('ship')}>
                  {t('order.ship')}
                </Button>
              )}
              {o.actions.canConfirmDelivery && (
                <Button
                  variant="primary"
                  loading={busy}
                  onClick={() => void run('confirm-delivery')}
                >
                  {o.fulfillment === 'pickup'
                    ? o.kind === 'product'
                      ? t('order.collectedOrder')
                      : t('order.collectedAnimal')
                    : o.kind === 'product'
                      ? t('order.receivedOrder')
                      : t('order.receivedAnimal')}
                </Button>
              )}
              {o.actions.canRequote && (
                <Button
                  onClick={() => {
                    setDialog('requote');
                    setQuote(undefined);
                    setAck(false);
                  }}
                >
                  {t('order.requote')}
                </Button>
              )}
              {o.actions.canCancel && (
                <Button
                  variant="danger"
                  onClick={() => {
                    setDialog('cancel');
                    setReason('');
                  }}
                >
                  {t('order.cancel')}
                </Button>
              )}
            </div>
            {!Object.values(o.actions).some(Boolean) && (
              <p className="ds-field__hint">{t('order.noActions')}</p>
            )}
            <p className="ds-field__hint">
              {o.status === 'PENDING_PAYMENT'
                ? t('order.hint.unpaid')
                : ['PAID', 'PROCESSING'].includes(o.status)
                  ? t('order.hint.paid')
                  : o.status === 'SHIPPED'
                    ? t('order.hint.shipped')
                    : ''}
            </p>
          </Card>

          {shipment && (
            <Card
              title={t('order.tracking', { status: t(`shipment.${shipment.status}`) })}
              headingLevel={2}
              style={{ marginBottom: 'var(--ds-space-4)' }}
            >
              <p>
                {shipment.carrier}
                {shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ''}
                {shipment.expectedDays && (
                  <>
                    {' '}
                    · {t('order.expected', { days: daysText(t, shipment.expectedDays) })}{' '}
                    <Badge>{t('estimate')}</Badge>
                  </>
                )}
              </p>
              <ol
                aria-label={t('order.trackingAria')}
                style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--ds-space-2)' }}
              >
                {shipment.events.map((e, i) => (
                  <li key={i}>
                    <strong>{t(`shipment.${e.status}`)}</strong>{' '}
                    <span className="ds-field__hint">
                      · {dateTime(e.at)} · {codeLabel(t, 'shipSource', e.source)}
                      {e.location ? ` · ${e.location}` : ''}
                    </span>
                    {e.note && <> — {e.note}</>}
                  </li>
                ))}
              </ol>
              {me === 'seller' &&
                o.status === 'SHIPPED' &&
                !['delivered', 'returned', 'cancelled'].includes(shipment.status) && (
                  <div className="ds-row">
                    <span className="ds-field__hint">{t('order.updateShipment')}</span>
                    {SHIPMENT_NEXT.filter((s) => s !== shipment.status).map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        onClick={() =>
                          void api
                            .request('POST', `${base}/shipments/${shipment.id}/events`, {
                              body: { status: s },
                            })
                            .then(reload)
                            .catch((e: unknown) => setMsg(errorMessage(e)))
                        }
                      >
                        {t(`shipment.${s}`)}
                      </Button>
                    ))}
                  </div>
                )}
            </Card>
          )}

          <Card title={t('history')} headingLevel={2}>
            <ol
              aria-label={t('order.historyAria')}
              style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--ds-space-2)' }}
            >
              {o.history.map((h, i) => (
                <li key={i}>
                  <strong>{orderStatusLabel(t, h.to)}</strong>{' '}
                  <span className="ds-field__hint">
                    · {h.actor?.displayName ?? t(`actor.${h.by}`)} · {dateTime(h.at)}
                  </span>
                  {h.reason && (
                    <span className="ds-field__hint"> — {codeLabel(t, 'reason', h.reason)}</span>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <Modal
        open={dialog === 'cancel'}
        onClose={() => setDialog(null)}
        title={t('order.cancelTitle')}
        footer={
          <>
            <Button onClick={() => setDialog(null)}>{t('back')}</Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={reason.trim().length < 3}
              onClick={() => void run('cancel', { reason: reason.trim() })}
            >
              {t('order.cancel')}
            </Button>
          </>
        }
      >
        <p>
          {o.status === 'PENDING_PAYMENT'
            ? t('order.cancelUnpaid')
            : t('order.cancelPaid', { amount: formatBaht(o.totals.grandTotalMinor) })}
        </p>
        <Textarea
          label={t('order.reason')}
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Modal>

      <Modal
        open={dialog === 'ship'}
        onClose={() => setDialog(null)}
        title={t('order.ship')}
        footer={
          <>
            <Button onClick={() => setDialog(null)}>{t('back')}</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={ship.carrier.trim().length < 2}
              onClick={() =>
                void run('ship', {
                  carrier: ship.carrier.trim(),
                  ...(ship.trackingNumber.trim()
                    ? { trackingNumber: ship.trackingNumber.trim() }
                    : {}),
                  ...(ship.min && ship.max
                    ? { expectedDays: { min: Number(ship.min), max: Number(ship.max) } }
                    : {}),
                })
              }
            >
              {t('order.ship')}
            </Button>
          </>
        }
      >
        <p>{t('order.shipText')}</p>
        <TextField
          label={t('order.carrier')}
          value={ship.carrier}
          onChange={(e) => setShip({ ...ship, carrier: e.target.value })}
        />
        <TextField
          label={t('order.trackingNo')}
          value={ship.trackingNumber}
          onChange={(e) => setShip({ ...ship, trackingNumber: e.target.value })}
        />
        <div className="ds-grid ds-grid--2">
          <TextField
            label={t('order.expFrom')}
            inputMode="numeric"
            value={ship.min}
            onChange={(e) => setShip({ ...ship, min: e.target.value })}
          />
          <TextField
            label={t('order.expTo')}
            inputMode="numeric"
            value={ship.max}
            onChange={(e) => setShip({ ...ship, max: e.target.value })}
          />
        </div>
      </Modal>

      <Modal
        open={dialog === 'requote'}
        onClose={() => setDialog(null)}
        title={t('order.requote')}
        footer={
          <>
            <Button onClick={() => setDialog(null)}>{t('back')}</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!quote || quote.options.length === 0}
              onClick={() =>
                void run('requote', {
                  quoteId: quote!.id,
                  optionId: quote!.options[0]!.id,
                  address: rq,
                  acknowledgeTransport: ack,
                })
              }
            >
              {t('order.updateOrder')}
            </Button>
          </>
        }
      >
        <TextField
          label={t('field.recipientName')}
          value={rq.recipientName}
          onChange={(e) => setRq({ ...rq, recipientName: e.target.value })}
        />
        <TextField
          label={t('field.phone')}
          value={rq.phone}
          onChange={(e) => setRq({ ...rq, phone: e.target.value })}
        />
        <TextField
          label={t('field.street')}
          value={rq.line1}
          onChange={(e) => setRq({ ...rq, line1: e.target.value })}
        />
        <div className="ds-grid ds-grid--2">
          <TextField
            label={t('field.district')}
            value={rq.district}
            onChange={(e) => setRq({ ...rq, district: e.target.value })}
          />
          <TextField
            label={t('field.province')}
            value={rq.province}
            onChange={(e) => {
              setRq({ ...rq, province: e.target.value });
              setQuote(undefined);
            }}
          />
          <TextField
            label={t('field.postalCode')}
            value={rq.postalCode}
            onChange={(e) => setRq({ ...rq, postalCode: e.target.value })}
          />
        </div>
        <Select
          label={t('order.shippingOption')}
          value={quote?.options[0]?.id ?? ''}
          onChange={() => undefined}
          disabled
        >
          <option value="">
            {quote
              ? quote.options[0]
                ? `${quote.options[0].label} — ${formatBaht(quote.options[0].priceMinor)}`
                : (quote.unavailableReason ?? t('order.notAvailable'))
              : t('order.quoteFirst')}
          </option>
        </Select>
        <Button size="sm" onClick={() => void getRequote()} loading={busy}>
          {t('order.newQuote')}
        </Button>
        {quote?.options[0] && quote.options[0].requirements.length > 0 && (
          <label className="ds-row">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />{' '}
            {t('order.ackRequirements', {
              list: quote.options[0].requirements.map((r) => t(`transport.${r}`)).join(', '),
            })}
          </label>
        )}
      </Modal>
    </>
  );
}
