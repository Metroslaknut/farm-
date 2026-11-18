import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CartDTO, OrderDTO } from '@farmplus/shared-types';
import { formatBaht } from '@farmplus/shared-utils';
import { checkoutCartSchema } from '@farmplus/validation';
import { validationMessage } from '@farmplus/i18n';
import { api } from '../../api';
import { Alert, Badge, Button, Card, TextField } from '../../components/ui';
import { errorMessage } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { useLocale } from '../../i18n';
import { problemText, useShopT, type ShopT } from './common';

/** How long the province must stay unchanged before its shipping quote is fetched. */
const PROVINCE_DEBOUNCE_MS = 400;

const EMPTY = {
  recipientName: '',
  phone: '',
  line1: '',
  subdistrict: '',
  district: '',
  province: '',
  postalCode: '',
};

/**
 * Why a seller's goods cannot be delivered. The API words it in English ("<title> is pickup only", "<title> is not
 * delivered to <province>"); in Thai the known shapes are re-worded, anything else gets a general message.
 */
function shippingReason(t: ShopT, english: boolean, reason: string | undefined): string {
  if (english && reason) return reason;
  const pickupOnly = reason?.match(/^(.+) is pickup only$/s);
  if (pickupOnly) return t('cart.pickupOnly', { title: pickupOnly[1]! });
  const notDelivered = reason?.match(/^(.+) is not delivered to (.+)$/s);
  if (notDelivered)
    return t('cart.notDelivered', { title: notDelivered[1]!, province: notDelivered[2]! });
  return t('cart.noShipping');
}

/** `/shop/cart` — review, choose pickup or delivery, and check out. One order is created per seller farm. */
export default function CartPage() {
  const navigate = useNavigate();
  const t = useShopT();
  const [locale] = useLocale();
  const [method, setMethod] = useState<'pickup' | 'delivery'>('pickup');
  const [addr, setAddr] = useState(EMPTY);
  const [province, setProvince] = useState<string>();
  // The quote is fetched once typing settles, not on every keystroke.
  const [quotedProvince, setQuotedProvince] = useState<string>();
  useEffect(() => {
    const timer = setTimeout(() => setQuotedProvince(province), PROVINCE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [province]);
  const [version, setVersion] = useState(0);
  const cart = useAsync(
    (signal) =>
      api.request<{ cart: CartDTO }>('GET', '/shop/cart', {
        signal,
        ...(method === 'delivery' && quotedProvince ? { query: { province: quotedProvince } } : {}),
      }),
    [version, method, quotedProvince],
  );
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (cart.error && !cart.data) return <Alert tone="danger">{cart.error}</Alert>;
  if (cart.loading && !cart.data) return <p role="status">{t('loading')}</p>;
  const c = cart.data?.cart;
  if (!c) return null;
  const reload = () => setVersion((v) => v + 1);

  const setQty = async (productId: string, quantity: number) => {
    setError(undefined);
    try {
      await api.request('PUT', `/shop/cart/items/${productId}`, { body: { quantity } });
    } catch (e) {
      setError(errorMessage(e));
    }
    reload();
  };
  const remove = async (productId: string) => {
    await api.request('DELETE', `/shop/cart/items/${productId}`).catch(() => undefined);
    reload();
  };

  const delivery = method === 'delivery';
  const shippingTotal = delivery
    ? c.groups.reduce((a, g) => a + (g.shipping?.available ? g.shipping.shippingMinor : 0), 0)
    : 0;
  const shippingMissing = delivery && c.groups.some((g) => !g.shipping?.available);
  const pickupBlocked = !delivery && c.groups.some((g) => !g.canPickup);
  // The shown shipping is not yet for the province as typed: wait for its quote before checking out.
  const quotePending = delivery && (quotedProvince !== province || cart.loading);

  const checkout = async () => {
    setError(undefined);
    setFieldErrors({});
    const address = delivery
      ? {
          recipientName: addr.recipientName.trim(),
          phone: addr.phone.trim(),
          line1: addr.line1.trim(),
          district: addr.district.trim(),
          province: addr.province.trim(),
          postalCode: addr.postalCode.trim(),
          ...(addr.subdistrict.trim() ? { subdistrict: addr.subdistrict.trim() } : {}),
        }
      : undefined;
    const body = {
      fulfillment: method,
      ...(address ? { address } : {}),
      // What the buyer is looking at: if a price or a delivery rate moved meanwhile, the server stops and asks again.
      expected: c.groups.map((g) => ({
        farmId: g.farmId,
        itemsMinor: g.itemsMinor,
        shippingMinor: delivery ? (g.shipping?.shippingMinor ?? 0) : 0,
      })),
    };
    const parsed = checkoutCartSchema.safeParse(body);
    if (!parsed.success) {
      setFieldErrors(
        Object.fromEntries(
          parsed.error.issues.map((i) => [
            i.path.filter((x) => x !== 'address').join('.') || '_form',
            validationMessage(locale, i.message),
          ]),
        ),
      );
      return;
    }
    setBusy(true);
    try {
      const res = await api.request<{ orders: OrderDTO[] }>('POST', '/shop/cart/checkout', {
        body: parsed.data,
      });
      navigate(res.orders.length === 1 ? `/market/orders/${res.orders[0]!.id}` : '/market/orders');
    } catch (e) {
      setError(errorMessage(e));
      reload();
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof EMPTY, v: string) => {
    setAddr((a) => ({ ...a, [k]: v }));
    if (k === 'province') setProvince(v.trim() || undefined);
  };

  return (
    <>
      <p>
        <Link to="/shop">{t('backToShop')}</Link>
      </p>
      <h1>{t('cart.title')}</h1>
      {error && <Alert tone="danger">{error}</Alert>}
      {c.groups.length === 0 && (
        <p>
          {t('cart.empty')} <Link to="/shop">{t('cart.browse')}</Link>
          {t('cart.browseEnd')}
        </p>
      )}
      {c.groups.map((g) => (
        <Card
          key={g.farmId || 'gone'}
          title={g.farmName || t('cart.unavailableGroup')}
          headingLevel={2}
          style={{ marginBottom: 'var(--ds-space-4)' }}
        >
          <table className="ds-table" aria-label={t('cart.itemsFrom', { farm: g.farmName })}>
            <tbody>
              {g.lines.map((l) => (
                <tr key={l.productId}>
                  <td>
                    <strong>{l.title}</strong>
                    {l.problems.map((p) => (
                      <div key={p}>
                        <Badge tone="danger">{problemText(t, p)}</Badge>
                      </div>
                    ))}
                    <div className="ds-field__hint">
                      {l.onSale
                        ? t('cart.eachWas', {
                            price: formatBaht(l.unitPriceMinor),
                            was: formatBaht(l.regularPriceMinor),
                          })
                        : t('cart.each', { price: formatBaht(l.unitPriceMinor) })}
                    </div>
                  </td>
                  <td>
                    <label>
                      <span className="ds-sr-only">{t('cart.qtyOf', { title: l.title })}</span>
                      <input
                        className="ds-input"
                        type="number"
                        min={1}
                        // uncontrolled: typing "12" must not fire a request after the "1"; the quantity is saved on blur or Enter
                        defaultValue={l.quantity}
                        key={`${l.productId}-${l.quantity}`}
                        style={{ width: '5rem' }}
                        onBlur={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isInteger(n) && n >= 1 && n !== l.quantity)
                            void setQty(l.productId, n);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                      />
                    </label>
                  </td>
                  <td style={{ textAlign: 'right' }}>{formatBaht(l.lineTotalMinor)}</td>
                  <td>
                    <Button size="sm" onClick={() => void remove(l.productId)}>
                      {t('cart.remove')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ margin: 0 }}>
            {t('cart.itemsLabel')} <strong>{formatBaht(g.itemsMinor)}</strong>
            {delivery && g.shipping && (
              <>
                {' · '}
                {g.shipping.available ? (
                  <>
                    {t('cart.shippingLabel')}{' '}
                    <strong>{formatBaht(g.shipping.shippingMinor)}</strong>
                    {g.shipping.estimatedDays
                      ? t('cart.estimate', {
                          min: g.shipping.estimatedDays.min,
                          max: g.shipping.estimatedDays.max,
                        })
                      : ''}
                  </>
                ) : (
                  <span role="alert">{shippingReason(t, locale === 'en', g.shipping.reason)}</span>
                )}
              </>
            )}
          </p>
          {!delivery && !g.canPickup && <Alert tone="warning">{t('cart.noPickup')}</Alert>}
        </Card>
      ))}

      {c.groups.length > 0 && (
        <>
          <Card
            title={t('cart.howReceive')}
            headingLevel={2}
            style={{ marginBottom: 'var(--ds-space-4)' }}
          >
            <div className="ds-row" role="radiogroup" aria-label={t('cart.receiveAria')}>
              <label className="ds-check">
                <input
                  type="radio"
                  name="method"
                  checked={method === 'pickup'}
                  onChange={() => setMethod('pickup')}
                />
                <span>{t('cart.pickup')}</span>
              </label>
              <label className="ds-check">
                <input
                  type="radio"
                  name="method"
                  checked={method === 'delivery'}
                  onChange={() => setMethod('delivery')}
                />
                <span>{t('cart.deliver')}</span>
              </label>
            </div>
            {delivery && (
              <>
                <p className="ds-field__hint">{t('cart.addressNote')}</p>
                <TextField
                  label={t('cart.recipient')}
                  value={addr.recipientName}
                  onChange={(e) => set('recipientName', e.target.value)}
                  error={fieldErrors['recipientName']}
                />
                <TextField
                  label={t('cart.phone')}
                  value={addr.phone}
                  onChange={(e) => set('phone', e.target.value)}
                  error={fieldErrors['phone']}
                />
                <TextField
                  label={t('cart.street')}
                  value={addr.line1}
                  onChange={(e) => set('line1', e.target.value)}
                  error={fieldErrors['line1']}
                />
                <TextField
                  label={t('cart.district')}
                  value={addr.district}
                  onChange={(e) => set('district', e.target.value)}
                  error={fieldErrors['district']}
                />
                <TextField
                  label={t('cart.province')}
                  value={addr.province}
                  onChange={(e) => set('province', e.target.value)}
                  error={fieldErrors['province']}
                  hint={t('cart.provinceHint')}
                />
                <TextField
                  label={t('cart.postalCode')}
                  value={addr.postalCode}
                  onChange={(e) => set('postalCode', e.target.value)}
                  error={fieldErrors['postalCode']}
                />
              </>
            )}
          </Card>
          <Card title={t('cart.summary')} headingLevel={2}>
            <p style={{ margin: 0 }}>
              {t('cart.itemsTotal', { amount: formatBaht(c.itemsMinor) })}
            </p>
            <p style={{ margin: 0 }}>
              {t('cart.shippingLabel')}{' '}
              {delivery
                ? shippingMissing
                  ? t('cart.enterProvince')
                  : formatBaht(shippingTotal)
                : t('cart.pickupFree')}
            </p>
            <p style={{ fontSize: '1.25rem' }}>
              <strong>
                {t('cart.total', {
                  amount: formatBaht(c.itemsMinor + (shippingMissing ? 0 : shippingTotal)),
                })}
              </strong>
            </p>
            {c.groups.length > 1 && (
              <p className="ds-field__hint">{t('cart.multiSellers', { count: c.groups.length })}</p>
            )}
            {fieldErrors['_form'] && <Alert tone="danger">{fieldErrors['_form']}</Alert>}
            <Button
              variant="primary"
              loading={busy}
              disabled={c.hasProblems || shippingMissing || pickupBlocked || quotePending}
              onClick={() => void checkout()}
            >
              {c.groups.length > 1 ? t('cart.placeOrders') : t('cart.placeOrder')}
            </Button>
            {c.hasProblems && <p className="ds-field__hint">{t('cart.fixProblems')}</p>}
            <p className="ds-field__hint">{t('cart.noChargeHint')}</p>
          </Card>
        </>
      )}
    </>
  );
}
