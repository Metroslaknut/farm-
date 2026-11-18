import type {
  ListingDTO,
  NegotiationDTO,
  OrderDTO,
  ShippingQuoteDTO,
} from '@farmplus/shared-types';
import { formatDateTime, intlLocale } from '@farmplus/i18n';
import { formatBaht } from '@farmplus/shared-utils';
import {
  createOrderSchema,
  fieldErrorsFromDetails,
  fieldErrorsFromZod,
  type FieldErrors,
} from '@farmplus/validation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { Button, Card, OptionPicker, Screen, StateView, Text, TextField } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useLocale, useT } from '@/i18n';
import {
  daysText,
  requirementLabel,
  shippingLabelText,
  unavailableReasonText,
} from '@/lib/market-labels';
import { errorText, validationText } from '@/lib/messages';
import { theme } from '@/theme';

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

function Checkout() {
  const t = useT('market');
  const [locale] = useLocale();
  const { negotiationId } = useLocalSearchParams<{ negotiationId: string }>();
  const router = useRouter();
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
  const [ack, setAck] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  // A delivery-only listing is always delivery: there is no pickup choice to show.
  const method =
    listing.data && !listing.data.deliveryOptions.includes('pickup') ? 'delivery' : picked;

  if (neg.error) return <StateView kind="error" error={neg.error} onRetry={neg.reload} />;
  if (listing.error)
    return <StateView kind="error" error={listing.error} onRetry={listing.reload} />;
  const n = neg.data?.negotiation;
  const l = listing.data;
  if (!n || !l) return <StateView kind="loading" label={t('common.loading')} />;
  if (n.status !== 'accepted' || !n.order)
    return (
      <StateView
        kind="empty"
        title={t('checkout.notReadyTitle')}
        message={t('checkout.notReadyMessage')}
      />
    );
  if (n.order.orderId)
    return (
      <Button
        title={t('checkout.orderExists')}
        onPress={() => router.replace(`/orders/${n.order!.orderId}`)}
      />
    );

  const option = quote?.options[0];
  const shipping = method === 'delivery' ? (option?.priceMinor ?? 0) : 0;
  const set = (k: keyof typeof EMPTY, v: string) => {
    setAddr((a) => ({ ...a, [k]: v }));
    if (k === 'province') setQuote(undefined); // a quote is for one destination
  };
  const offersDelivery = l.deliveryOptions.includes('delivery');

  const getQuote = async () => {
    if (!addr.province.trim()) return setErrors({ province: t('checkout.provinceFirst') });
    setBusy(true);
    setErrors({});
    try {
      setQuote(
        (
          await api.request<{ quote: ShippingQuoteDTO }>('POST', '/shipping/quotes', {
            body: { listingId: l.id, destination: { province: addr.province.trim() } },
          })
        ).quote,
      );
    } catch (e) {
      setErrors({ _form: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const address = {
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
            optionId: option?.id,
            address,
            acknowledgeTransport: ack,
          };
    const parsed = createOrderSchema.safeParse(payload);
    if (!parsed.success)
      return setErrors(
        Object.fromEntries(
          Object.entries(fieldErrorsFromZod(parsed.error)).map(([k, v]) => [
            k.replace(/^address\./, ''),
            validationText(v),
          ]),
        ),
      );
    if (method === 'delivery' && option && option.requirements.length > 0 && !ack)
      return setErrors({ ack: t('checkout.ackRequired') });
    setBusy(true);
    setErrors({});
    try {
      const res = await api.request<{ order: OrderDTO }>('POST', '/orders', { body: parsed.data });
      router.replace(`/orders/${res.order.id}`);
    } catch (e) {
      const mapped = fieldErrorsFromDetails(
        (e as { details?: { path: string; message: string }[] }).details,
      );
      setErrors(
        Object.keys(mapped).length
          ? Object.fromEntries(
              Object.entries(mapped).map(([k, v]) => [
                k.replace(/^address\./, ''),
                validationText(v),
              ]),
            )
          : { _form: errorText(e) },
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Text variant="heading">{l.title}</Text>
      {errors['_form'] ? <Text color={theme.colors.error.fg}>{errors['_form']}</Text> : null}
      <Text muted>
        {t('checkout.reservedUntil', { date: formatDateTime(n.order.reservedUntil, locale) })}
      </Text>
      <OptionPicker
        label={t('checkout.receive')}
        value={method}
        onChange={(v) => setMethod(v as 'pickup' | 'delivery')}
        error={errors['fulfillment']}
        options={[
          ...(l.deliveryOptions.includes('pickup')
            ? [{ value: 'pickup', label: t('checkout.collect') }]
            : []),
          ...(offersDelivery ? [{ value: 'delivery', label: t('checkout.deliver') }] : []),
        ]}
      />
      {method === 'delivery' ? (
        <>
          <Card>
            <Text variant="label" muted>
              {t('checkout.addressNote')}
            </Text>
            <TextField
              label={t('checkout.recipient')}
              value={addr.recipientName}
              onChangeText={(v) => set('recipientName', v)}
              error={errors['recipientName']}
            />
            <TextField
              label={t('checkout.phone')}
              value={addr.phone}
              onChangeText={(v) => set('phone', v)}
              keyboardType="phone-pad"
              error={errors['phone']}
            />
            <TextField
              label={t('checkout.street')}
              value={addr.line1}
              onChangeText={(v) => set('line1', v)}
              error={errors['line1']}
            />
            <TextField
              label={t('checkout.district')}
              value={addr.district}
              onChangeText={(v) => set('district', v)}
              error={errors['district']}
            />
            <TextField
              label={t('checkout.province')}
              value={addr.province}
              onChangeText={(v) => set('province', v)}
              error={errors['province']}
            />
            <TextField
              label={t('checkout.postalCode')}
              value={addr.postalCode}
              onChangeText={(v) => set('postalCode', v)}
              keyboardType="number-pad"
              error={errors['postalCode']}
            />
          </Card>
          <Button
            title={quote ? t('checkout.recalculate') : t('checkout.getQuote')}
            variant="secondary"
            loading={busy}
            onPress={() => void getQuote()}
          />
          {quote && !option ? (
            <Text color={theme.colors.error.fg}>
              {unavailableReasonText(quote.unavailableReason)}
            </Text>
          ) : null}
          {option ? (
            <Card>
              <Text variant="label">
                {shippingLabelText(option.label)} — {formatBaht(option.priceMinor)}
              </Text>
              {option.estimatedDays ? (
                <Text muted>{t('checkout.about', { days: daysText(option.estimatedDays) })}</Text>
              ) : null}
              <Text variant="caption" muted>
                {t(
                  option.source === 'seller_rule'
                    ? 'checkout.rateBySeller'
                    : 'checkout.rateByProvider',
                  {
                    time: new Date(quote!.expiresAt).toLocaleTimeString(intlLocale(locale), {
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  },
                )}
              </Text>
              {option.requirements.length > 0 ? (
                <View style={{ gap: theme.spacing.sm }}>
                  <Text>
                    {t('common.requirements', {
                      list: option.requirements.map(requirementLabel).join(', '),
                    })}
                  </Text>
                  <Button
                    title={ack ? t('checkout.ackDone') : t('checkout.ack')}
                    variant={ack ? 'primary' : 'secondary'}
                    onPress={() => setAck((a) => !a)}
                  />
                  {errors['ack'] ? (
                    <Text color={theme.colors.error.fg}>{errors['ack']}</Text>
                  ) : null}
                </View>
              ) : null}
            </Card>
          ) : null}
        </>
      ) : null}
      <Card>
        <Text>{t('checkout.agreedPrice', { price: formatBaht(n.order.amountMinor) })}</Text>
        <Text>
          {t('common.shipping', {
            value:
              method === 'pickup'
                ? t('common.pickupFree')
                : option
                  ? formatBaht(option.priceMinor)
                  : t('checkout.needQuote'),
          })}
        </Text>
        <Text variant="heading">
          {t('common.total', { amount: formatBaht(n.order.amountMinor + shipping) })}
        </Text>
      </Card>
      <Button
        title={t('checkout.placeOrder')}
        loading={busy}
        disabled={method === 'delivery' && !option}
        onPress={() => void submit()}
      />
      <Text variant="caption" muted>
        {t('checkout.placeNote')}
      </Text>
    </Screen>
  );
}

export default function CheckoutScreen() {
  return (
    <RequireAuth>
      <Checkout />
    </RequireAuth>
  );
}
