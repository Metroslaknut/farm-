import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  ListingDTO,
  NegotiationDTO,
  OrderDTO,
  ShippingQuoteDTO,
} from '@farmplus/shared-types';
import { formatBaht } from '@farmplus/shared-utils';
import {
  createOrderSchema,
  fieldErrorsFromDetails,
  fieldErrorsFromZod,
  type FieldErrors,
} from '@farmplus/validation';
import { api } from '../../api';
import { Alert, Badge, Button, Card, TextField, Textarea } from '../../components/ui';
import { errorMessage } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { localizeErrors, rich, useDateTime, useMarketT } from './common';
import { daysText } from './orderCommon';

const EMPTY = {
  recipientName: '',
  phone: '',
  line1: '',
  subdistrict: '',
  district: '',
  province: '',
  postalCode: '',
  note: '',
};

/** `/market/checkout/:negotiationId` — turn an accepted offer into an order: pickup, or delivery with address, quote and transport acknowledgement. */
export default function CheckoutPage() {
  const { negotiationId = '' } = useParams();
  const navigate = useNavigate();
  const t = useMarketT();
  const dateTime = useDateTime();
  const neg = useAsync(
    (signal) =>
      api.request<{ negotiation: NegotiationDTO }>(
        'GET',
        `/marketplace/negotiations/${negotiationId}`,
        { signal },
      ),
    [negotiationId],
  );
  const listingId = neg.data?.negotiation.listingId;
  const listing = useAsync(
    async (signal) =>
      listingId
        ? (
            await api.request<{ listing: ListingDTO }>(
              'GET',
              `/marketplace/listings/${listingId}`,
              { signal },
            )
          ).listing
        : null,
    [listingId],
  );

  const [picked, setMethod] = useState<'pickup' | 'delivery'>('pickup');
  const [addr, setAddr] = useState(EMPTY);
  const [quote, setQuote] = useState<ShippingQuoteDTO>();
  const [optionId, setOptionId] = useState('');
  const [ack, setAck] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  // A delivery-only listing is always delivery: there is no pickup choice to show.
  const method =
    listing.data && !listing.data.deliveryOptions.includes('pickup') ? 'delivery' : picked;

  if (neg.error) return <Alert tone="danger">{neg.error}</Alert>;
  if (listing.error) return <Alert tone="danger">{listing.error}</Alert>;
  const n = neg.data?.negotiation;
  const l = listing.data;
  if (!n || !l) return <p role="status">{t('loading')}</p>;
  if (n.status !== 'accepted' || !n.order)
    return (
      <Alert tone="warning">
        {rich(t('checkout.notAccepted'), {
          link: <Link to={`/market/offers/${n.id}`}>{t('checkout.backToNegotiation')}</Link>,
        })}
      </Alert>
    );
  if (n.order.orderId)
    return (
      <Alert tone="info">
        {rich(t('checkout.exists'), {
          link: <Link to={`/market/orders/${n.order.orderId}`}>{t('checkout.openIt')}</Link>,
        })}
      </Alert>
    );

  const offersDelivery = l.deliveryOptions.includes('delivery');
  const offersPickup = l.deliveryOptions.includes('pickup');
  const option = quote?.options.find((o) => o.id === optionId);
  const shipping = method === 'delivery' ? (option?.priceMinor ?? 0) : 0;
  const total = n.order.amountMinor + shipping;
  const set = (k: keyof typeof EMPTY, v: string) => {
    setAddr((a) => ({ ...a, [k]: v }));
    if (k === 'province') {
      setQuote(undefined); // a quote is for one destination: the old one no longer applies
      setOptionId('');
    }
  };

  const getQuote = async () => {
    if (!addr.province.trim()) return setErrors({ province: t('checkout.err.province') });
    setBusy(true);
    setErrors({});
    try {
      const res = await api.request<{ quote: ShippingQuoteDTO }>('POST', '/shipping/quotes', {
        body: {
          listingId: l.id,
          destination: {
            province: addr.province.trim(),
            ...(addr.district.trim() ? { district: addr.district.trim() } : {}),
            ...(/^\d{5}$/.test(addr.postalCode) ? { postalCode: addr.postalCode } : {}),
          },
        },
      });
      setQuote(res.quote);
      setOptionId(res.quote.options[0]?.id ?? '');
    } catch (e) {
      setErrors({ _form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    // Required fields are always sent (as typed, possibly empty) so the schema's own messages name what is missing.
    const clean = {
      recipientName: addr.recipientName.trim(),
      phone: addr.phone.trim(),
      line1: addr.line1.trim(),
      district: addr.district.trim(),
      province: addr.province.trim(),
      postalCode: addr.postalCode.trim(),
      ...(addr.subdistrict.trim() ? { subdistrict: addr.subdistrict.trim() } : {}),
      ...(addr.note.trim() ? { note: addr.note.trim() } : {}),
    };
    const payload =
      method === 'pickup'
        ? { negotiationId: n.id, fulfillment: 'pickup' as const }
        : {
            negotiationId: n.id,
            fulfillment: 'delivery' as const,
            quoteId: quote?.id,
            optionId,
            address: clean,
            acknowledgeTransport: ack,
          };
    const parsed = createOrderSchema.safeParse(payload);
    if (!parsed.success) {
      const f = localizeErrors(fieldErrorsFromZod(parsed.error));
      return setErrors(
        Object.fromEntries(Object.entries(f).map(([k, v]) => [k.replace(/^address\./, ''), v])),
      );
    }
    if (method === 'delivery' && option && option.requirements.length > 0 && !ack)
      return setErrors({ acknowledgeTransport: t('checkout.err.ack') });
    setBusy(true);
    setErrors({});
    try {
      const res = await api.request<{ order: OrderDTO }>('POST', '/orders', { body: parsed.data });
      navigate(`/market/orders/${res.order.id}`);
    } catch (e) {
      const mapped = localizeErrors(
        fieldErrorsFromDetails((e as { details?: { path: string; message: string }[] }).details),
      );
      setErrors(
        Object.keys(mapped).length
          ? Object.fromEntries(
              Object.entries(mapped).map(([k, v]) => [k.replace(/^address\./, ''), v]),
            )
          : { _form: errorMessage(e) },
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p>
        <Link to={`/market/offers/${n.id}`}>{t('nav.negotiation')}</Link>
      </p>
      <h1>{t('checkout.title')}</h1>
      {errors['_form'] && <Alert tone="danger">{errors['_form']}</Alert>}
      <Alert tone="info">{t('checkout.reserved', { date: dateTime(n.order.reservedUntil) })}</Alert>
      <div className="ds-grid ds-grid--2">
        <div>
          <Card
            title={t('checkout.how')}
            headingLevel={2}
            style={{ marginBottom: 'var(--ds-space-4)' }}
          >
            {offersPickup && (
              <label className="ds-row">
                <input
                  type="radio"
                  name="fulfillment"
                  checked={method === 'pickup'}
                  onChange={() => setMethod('pickup')}
                />{' '}
                {t('checkout.collect')}
              </label>
            )}
            {offersDelivery && (
              <label className="ds-row">
                <input
                  type="radio"
                  name="fulfillment"
                  checked={method === 'delivery'}
                  onChange={() => setMethod('delivery')}
                />{' '}
                {t('checkout.deliver')}
              </label>
            )}
          </Card>
          {method === 'delivery' && (
            <>
              <Card
                title={t('checkout.address')}
                headingLevel={2}
                style={{ marginBottom: 'var(--ds-space-4)' }}
              >
                <p className="ds-field__hint">{t('checkout.addressHint')}</p>
                <TextField
                  label={t('field.recipientName')}
                  value={addr.recipientName}
                  onChange={(e) => set('recipientName', e.target.value)}
                  error={errors['recipientName']}
                />
                <TextField
                  label={t('field.phone')}
                  type="tel"
                  value={addr.phone}
                  onChange={(e) => set('phone', e.target.value)}
                  error={errors['phone']}
                />
                <TextField
                  label={t('field.street')}
                  value={addr.line1}
                  onChange={(e) => set('line1', e.target.value)}
                  error={errors['line1']}
                />
                <div className="ds-grid ds-grid--2">
                  <TextField
                    label={t('field.subdistrict')}
                    value={addr.subdistrict}
                    onChange={(e) => set('subdistrict', e.target.value)}
                  />
                  <TextField
                    label={t('field.district')}
                    value={addr.district}
                    onChange={(e) => set('district', e.target.value)}
                    error={errors['district']}
                  />
                  <TextField
                    label={t('field.province')}
                    value={addr.province}
                    onChange={(e) => set('province', e.target.value)}
                    error={errors['province']}
                  />
                  <TextField
                    label={t('field.postalCode')}
                    inputMode="numeric"
                    value={addr.postalCode}
                    onChange={(e) => set('postalCode', e.target.value)}
                    error={errors['postalCode']}
                  />
                </div>
                <Textarea
                  label={t('checkout.note')}
                  rows={2}
                  maxLength={300}
                  value={addr.note}
                  onChange={(e) => set('note', e.target.value)}
                />
              </Card>
              <Card title={t('checkout.shipping')} headingLevel={2}>
                <Button onClick={() => void getQuote()} loading={busy}>
                  {quote ? t('checkout.recalc') : t('checkout.getQuote')}
                </Button>
                {quote?.options.length === 0 && (
                  <Alert tone="warning">{quote.unavailableReason ?? t('checkout.noOption')}</Alert>
                )}
                {quote?.options.map((o) => (
                  <label key={o.id} className="ds-row" style={{ alignItems: 'flex-start' }}>
                    <input
                      type="radio"
                      name="shipping"
                      checked={optionId === o.id}
                      onChange={() => setOptionId(o.id)}
                    />
                    <span>
                      <strong>{o.label}</strong> — {formatBaht(o.priceMinor)}
                      {o.estimatedDays && (
                        <>
                          {' '}
                          · {t('about', { days: daysText(t, o.estimatedDays) })}{' '}
                          <Badge>{t('estimate')}</Badge>
                        </>
                      )}
                      <br />
                      <span className="ds-field__hint">
                        {o.source === 'seller_rule'
                          ? t('checkout.rateBySeller')
                          : t('checkout.rateByProvider')}
                      </span>
                    </span>
                  </label>
                ))}
                {quote && (
                  <p className="ds-field__hint">
                    {t('checkout.quoteValid', { date: dateTime(quote.expiresAt) })}
                  </p>
                )}
                {option && option.requirements.length > 0 && (
                  <fieldset>
                    <legend>{t('checkout.requirements')}</legend>
                    <ul>
                      {option.requirements.map((r) => (
                        <li key={r}>{t(`transport.${r}`)}</li>
                      ))}
                    </ul>
                    <label className="ds-row">
                      <input
                        type="checkbox"
                        checked={ack}
                        onChange={(e) => setAck(e.target.checked)}
                      />{' '}
                      {t('checkout.ack')}
                    </label>
                    {errors['acknowledgeTransport'] && (
                      <p role="alert">{errors['acknowledgeTransport']}</p>
                    )}
                  </fieldset>
                )}
              </Card>
            </>
          )}
        </div>
        <Card title={t('checkout.summary')} headingLevel={2}>
          <p>
            <strong>{l.title}</strong>
            <br />
            <span className="ds-field__hint">{l.farmName}</span>
          </p>
          <table className="ds-table" aria-label={t('checkout.summary')}>
            <tbody>
              <tr>
                <th scope="row">{t('checkout.agreed')}</th>
                <td style={{ textAlign: 'right' }}>{formatBaht(n.order.amountMinor)}</td>
              </tr>
              <tr>
                <th scope="row">{t('totals.shipping')}</th>
                <td style={{ textAlign: 'right' }}>
                  {method === 'pickup'
                    ? t('totals.pickupFree')
                    : option
                      ? formatBaht(option.priceMinor)
                      : t('checkout.getAQuote')}
                </td>
              </tr>
              <tr>
                <th scope="row">
                  <strong>{t('checkout.total')}</strong>
                </th>
                <td style={{ textAlign: 'right' }}>
                  <strong>{formatBaht(total)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
          <Button
            variant="primary"
            loading={busy}
            disabled={method === 'delivery' && !option}
            onClick={() => void submit()}
          >
            {t('checkout.place')}
          </Button>
          <p className="ds-field__hint">{t('checkout.placeHint')}</p>
        </Card>
      </div>
    </>
  );
}
