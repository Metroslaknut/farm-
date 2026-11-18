import type { OrderDTO, PaymentDTO } from '@farmplus/shared-types';
import { formatDateTime } from '@farmplus/i18n';
import { formatBaht, humanize } from '@farmplus/shared-utils';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking } from 'react-native';
import { View } from 'react-native';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { Button, Card, Screen, StateView, StatusBadge, Text, TextField } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { confirmAction } from '@/lib/confirm';
import { useLocale, useT } from '@/i18n';
import {
  actorLabel,
  daysText,
  orderReasonLabel,
  orderStatusLabel,
  requirementLabel,
  sexLabel,
  shipmentSourceLabel,
  shipmentStatusLabel,
  shippingLabelText,
} from '@/lib/market-labels';
import { errorText } from '@/lib/messages';
import { theme } from '@/theme';

const newKey = () => `app-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function Detail() {
  const t = useT('market');
  const [locale] = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [version, setVersion] = useState(0);
  const data = useAsync(
    (signal) => api.request<{ order: OrderDTO }>('GET', `/orders/${id}`, { signal }),
    [id, version],
  );
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const [payment, setPayment] = useState<PaymentDTO>();
  // One key per payment attempt: pressing Pay twice (or retrying after a network error) resumes the same attempt.
  const [payKey, setPayKey] = useState(newKey);

  if (data.error) return <StateView kind="error" error={data.error} onRetry={data.reload} />;
  if (!data.data) return <StateView kind="loading" label={t('order.loading')} />;
  const o = data.data.order;
  const me = o.viewer.party;
  const run = async (path: string, body: object = {}) => {
    setBusy(true);
    setMsg(undefined);
    try {
      await api.request('POST', `/orders/${o.id}/${path}`, { body });
      setAsking(false);
      setReason('');
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
      setVersion((v) => v + 1);
    }
  };
  const pay = async () => {
    setBusy(true);
    setMsg(undefined);
    try {
      const attempt = (key: string) =>
        api.request<{ payment: PaymentDTO }>('POST', '/payments', {
          body: { orderId: o.id },
          headers: { 'Idempotency-Key': key },
        });
      let res = await attempt(payKey);
      // The same key replays its attempt; if that one already ended (failed or expired at the provider while the
      // buyer was away), start a new attempt instead of showing the old one forever.
      if (['failed', 'cancelled', 'expired'].includes(res.payment.status)) {
        const fresh = newKey();
        setPayKey(fresh);
        res = await attempt(fresh);
      }
      setPayment(res.payment);
      // Only ever open an https checkout page supplied by the server (the payment provider's hosted page).
      if (res.payment.checkoutUrl && /^https:\/\//i.test(res.payment.checkoutUrl))
        await Linking.openURL(res.payment.checkoutUrl);
      else if (!res.payment.mock) setMsg(t('order.paymentStarted'));
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const simulate = async (outcome: 'succeeded' | 'failed') => {
    if (!payment) return;
    setBusy(true);
    try {
      const res = await api.request<{ payment: PaymentDTO }>(
        'POST',
        `/payments/${payment.id}/mock-complete`,
        {
          body: { outcome },
        },
      );
      setPayment(res.payment);
      if (res.payment.status !== 'pending') setPayKey(newKey());
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
      setVersion((v) => v + 1);
    }
  };
  const shipment = o.shipments.at(-1);

  return (
    <Screen>
      <Text variant="heading">{t('order.title', { no: o.orderNo })}</Text>
      <StatusBadge
        tone={o.status === 'DELIVERED' || o.status === 'PAID' ? 'success' : 'warning'}
        label={orderStatusLabel(o.status)}
      />
      {msg ? <Text color={theme.colors.error.fg}>{msg}</Text> : null}
      {o.status === 'PENDING_PAYMENT' ? (
        <Text muted>
          {o.paymentDueAt
            ? t('order.waitingPaymentDue', { date: formatDateTime(o.paymentDueAt, locale) })
            : t('order.waitingPayment')}
        </Text>
      ) : null}
      {o.status === 'PENDING_PAYMENT' && me === 'buyer' ? (
        payment?.status === 'pending' && payment.mock ? (
          <Card>
            <Text variant="label">{t('order.testPayment')}</Text>
            <Button
              title={t('order.simulateSuccess')}
              loading={busy}
              onPress={() => void simulate('succeeded')}
            />
            <Button
              title={t('order.simulateFail')}
              variant="secondary"
              loading={busy}
              onPress={() => void simulate('failed')}
            />
          </Card>
        ) : (
          <Button
            title={t('order.pay', { amount: formatBaht(o.totals.grandTotalMinor) })}
            loading={busy}
            onPress={() => void pay()}
          />
        )
      ) : null}
      {o.status === 'REFUND_PENDING' ? (
        <Text>{t('order.refundPending', { amount: formatBaht(o.totals.grandTotalMinor) })}</Text>
      ) : null}
      {o.status === 'SHIPPED' && o.deliveredAt && me === 'buyer' ? (
        <Text>{t('order.confirmReceipt')}</Text>
      ) : null}
      <Card>
        {o.items.map((i) =>
          i.type === 'animal' ? (
            <View key={i.animalId}>
              <Text variant="label">{i.title}</Text>
              <Text muted>
                {i.animal.animalTypeName}
                {i.animal.breed ? ` · ${humanize(i.animal.breed)}` : ''} · {sexLabel(i.animal.sex)}
              </Text>
              <Text>{t('order.animalPrice', { price: formatBaht(i.unitPriceMinor) })}</Text>
            </View>
          ) : (
            <View key={i.productId}>
              <Text variant="label">{i.title}</Text>
              <Text muted>{[i.categoryName, i.brand].filter(Boolean).join(' · ')}</Text>
              <Text>
                {t('order.productPrice', {
                  price: formatBaht(i.unitPriceMinor),
                  qty: i.quantity,
                  total: formatBaht(i.totalMinor),
                })}
              </Text>
            </View>
          ),
        )}
      </Card>
      <Card>
        <Text>
          {t(o.kind === 'product' ? 'order.itemsTotal' : 'order.animalTotal', {
            amount: formatBaht(o.totals.itemsMinor),
          })}
        </Text>
        <Text>
          {t(o.shipping?.isEstimate ? 'order.shippingEstimate' : 'common.shipping', {
            value:
              o.fulfillment === 'pickup'
                ? t('common.pickupFree')
                : formatBaht(o.totals.shippingMinor),
          })}
        </Text>
        <Text variant="heading">
          {t('common.total', { amount: formatBaht(o.totals.grandTotalMinor) })}
        </Text>
        {me === 'seller' ? (
          <Text muted>
            {t('order.fee', {
              fee: formatBaht(o.totals.platformFeeMinor),
              payout: formatBaht(o.totals.sellerPayoutMinor),
            })}
          </Text>
        ) : null}
      </Card>
      {o.fulfillment === 'delivery' ? (
        <Card>
          <Text variant="heading">{t('order.delivery')}</Text>
          {o.shipping ? (
            <Text>
              {o.shipping.estimatedDays
                ? t('order.shippingAbout', {
                    label: shippingLabelText(o.shipping.label),
                    days: daysText(o.shipping.estimatedDays),
                  })
                : shippingLabelText(o.shipping.label)}
            </Text>
          ) : null}
          {o.shipping && o.shipping.requirements.length > 0 ? (
            <Text muted>
              {t('common.requirements', {
                list: o.shipping.requirements.map(requirementLabel).join(', '),
              })}
            </Text>
          ) : null}
          {o.address ? (
            <Text>
              {o.address.recipientName} · {o.address.phone}
              {'\n'}
              {o.address.line1}, {o.address.district}, {o.address.province} {o.address.postalCode}
            </Text>
          ) : (
            <Text muted>{t('order.region', { province: o.destination?.province ?? '' })}</Text>
          )}
        </Card>
      ) : null}
      {shipment ? (
        <Card>
          <Text variant="heading">
            {t('order.tracking', { status: shipmentStatusLabel(shipment.status) })}
          </Text>
          <Text muted>
            {shipment.carrier}
            {shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ''}
          </Text>
          {shipment.events.map((e, i) => (
            <Text key={i} variant="caption">
              {shipmentStatusLabel(e.status)} · {formatDateTime(e.at, locale)} ·{' '}
              {shipmentSourceLabel(e.source)}
              {e.location ? ` · ${e.location}` : ''}
            </Text>
          ))}
        </Card>
      ) : null}
      {o.actions.canConfirmDelivery ? (
        <Button
          title={o.fulfillment === 'pickup' ? t('order.collected') : t('order.received')}
          loading={busy}
          onPress={() => void run('confirm-delivery')}
        />
      ) : null}
      {o.actions.canProcess ? (
        <Button title={t('order.process')} loading={busy} onPress={() => void run('process')} />
      ) : null}
      {o.actions.canCancel ? (
        asking ? (
          <Card>
            <TextField
              label={t('order.reasonLabel')}
              value={reason}
              onChangeText={setReason}
              maxLength={300}
            />
            <Button
              title={t('order.confirmCancel')}
              variant="secondary"
              loading={busy}
              onPress={() =>
                void (async () => {
                  if (reason.trim().length < 3) return setMsg(t('order.reasonShort'));
                  if (
                    await confirmAction(
                      t('order.cancelTitle'),
                      o.status === 'PENDING_PAYMENT'
                        ? t('order.cancelReleased')
                        : t('order.cancelRefund'),
                      t('order.cancelOrder'),
                    )
                  )
                    await run('cancel', { reason: reason.trim() });
                })()
              }
            />
          </Card>
        ) : (
          <Button title={t('order.cancelOrder')} variant="ghost" onPress={() => setAsking(true)} />
        )
      ) : null}
      {me === 'seller' && o.actions.canShip ? <Text muted>{t('order.shipOnWeb')}</Text> : null}
      <Text variant="heading">{t('common.history')}</Text>
      {o.history.map((h, i) => (
        <Text key={i} variant="caption">
          {orderStatusLabel(h.to)} · {h.actor?.displayName ?? actorLabel(h.by)} ·{' '}
          {formatDateTime(h.at, locale)}
          {h.reason ? ` — ${orderReasonLabel(h.reason)}` : ''}
        </Text>
      ))}
    </Screen>
  );
}

export default function OrderScreen() {
  return (
    <RequireAuth>
      <Detail />
    </RequireAuth>
  );
}
