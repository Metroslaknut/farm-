import type { NegotiationDTO } from '@farmplus/shared-types';
import { formatDateTime } from '@farmplus/i18n';
import { formatBaht, parseBahtToMinor } from '@farmplus/shared-utils';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { Button, Card, Screen, StateView, StatusBadge, Text, TextField } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { confirmAction } from '@/lib/confirm';
import { useLocale, useT } from '@/i18n';
import { negotiationEventLabel, negotiationStatusLabel, partyLabel } from '@/lib/market-labels';
import { errorText } from '@/lib/messages';
import { theme } from '@/theme';

function Thread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT('market');
  const [locale] = useLocale();
  const router = useRouter();
  const [version, setVersion] = useState(0);
  const data = useAsync(
    (signal) =>
      api.request<{ negotiation: NegotiationDTO }>('GET', `/marketplace/negotiations/${id}`, {
        signal,
      }),
    [id, version],
  );
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (data.error) return <StateView kind="error" error={data.error} onRetry={data.reload} />;
  if (!data.data) return <StateView kind="loading" label={t('common.loading')} />;
  const n = data.data.negotiation;
  const me = n.viewer.party;
  const base = `/marketplace/negotiations/${n.id}`;

  const run = async (path: string, body: object = {}) => {
    setBusy(true);
    setMsg(undefined);
    try {
      await api.request('POST', `${base}/${path}`, { body });
      setAmount('');
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
      setVersion((v) => v + 1); // always show the latest state
    }
  };

  const accept = async () => {
    if (
      await confirmAction(
        t('thread.acceptTitle', { price: formatBaht(n.currentOfferMinor) }),
        t('thread.acceptMessage'),
        t('thread.acceptConfirm'),
        false,
      )
    )
      await run('accept', { expectedSeq: n.currentSeq });
  };
  const decline = async () => {
    if (
      await confirmAction(t('thread.declineTitle'), t('thread.declineMessage'), t('thread.decline'))
    )
      await run(me === 'buyer' ? 'withdraw' : 'reject', { expectedSeq: n.currentSeq });
  };
  const counter = () => {
    const minor = parseBahtToMinor(amount);
    if (minor === undefined) return setMsg(t('thread.counterInvalid'));
    void run('counter', { amountMinor: minor, expectedSeq: n.currentSeq });
  };

  return (
    <Screen>
      <Text variant="heading">{n.listingTitle}</Text>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <StatusBadge
          tone={
            n.status === 'open'
              ? 'warning'
              : n.status === 'accepted' || n.status === 'completed'
                ? 'success'
                : 'error'
          }
          label={negotiationStatusLabel(n.status)}
        />
      </View>
      <Text muted>
        {me === 'buyer'
          ? t('thread.withSeller', {
              name: n.seller.displayName,
              price: formatBaht(n.askingPriceMinor),
            })
          : t('thread.withBuyer', {
              name: n.buyer.displayName,
              price: formatBaht(n.askingPriceMinor),
            })}
      </Text>
      {msg ? <Text color={theme.colors.error.fg}>{msg}</Text> : null}
      {n.status === 'open' ? (
        <Card>
          <Text variant="heading">
            {t('thread.onTable', { price: formatBaht(n.currentOfferMinor) })}
          </Text>
          <Text>
            {n.viewer.canAct
              ? t('thread.yourTurn')
              : t('thread.waiting', { party: partyLabel(n.turn) })}
          </Text>
          {n.viewer.canAct ? (
            <>
              <Button
                title={t('thread.accept', { price: formatBaht(n.currentOfferMinor) })}
                loading={busy}
                onPress={() => void accept()}
              />
              <Button
                title={t('thread.decline')}
                variant="secondary"
                onPress={() => void decline()}
              />
              <TextField
                label={t('thread.counterLabel')}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
              />
              <Button
                title={t('thread.sendCounter')}
                variant="secondary"
                loading={busy}
                onPress={counter}
              />
            </>
          ) : null}
          {me === 'buyer' && n.turn !== 'buyer' ? (
            <Button title={t('thread.withdraw')} variant="ghost" onPress={() => void decline()} />
          ) : null}
        </Card>
      ) : null}
      {n.status === 'accepted' && n.order ? (
        <Card>
          <Text variant="heading">
            {t('thread.agreed', { price: formatBaht(n.order.amountMinor) })}
          </Text>
          <Text muted>
            {t('thread.reservedUntil', {
              date: formatDateTime(n.order.reservedUntil, locale),
            })}
          </Text>
          {me === 'buyer' ? (
            <Button
              title={n.order.orderId ? t('thread.viewOrder') : t('thread.checkout')}
              onPress={() =>
                router.push(n.order?.orderId ? `/orders/${n.order.orderId}` : `/checkout/${n.id}`)
              }
            />
          ) : null}
          {me !== 'moderator' && !n.order.orderId ? (
            <Button
              title={t('thread.cancelDeal')}
              variant="ghost"
              onPress={() =>
                void (async () => {
                  if (
                    await confirmAction(
                      t('thread.cancelDealTitle'),
                      t('thread.cancelDealMessage'),
                      t('thread.cancelDealConfirm'),
                    )
                  )
                    await run('cancel-reservation');
                })()
              }
            />
          ) : null}
        </Card>
      ) : null}
      <Text variant="heading">{t('common.history')}</Text>
      {n.history.map((h) => (
        <View
          key={h.seq}
          accessibilityLabel={t('thread.historyA11y', {
            name: h.actor.displayName,
            action: negotiationEventLabel(h.type),
          })}
        >
          <Text>
            {h.amountMinor
              ? t('thread.historyEntryAmount', {
                  name: h.actor.displayName,
                  party: partyLabel(h.by),
                  action: negotiationEventLabel(h.type),
                  amount: formatBaht(h.amountMinor),
                })
              : t('thread.historyEntry', {
                  name: h.actor.displayName,
                  party: partyLabel(h.by),
                  action: negotiationEventLabel(h.type),
                })}
          </Text>
          <Text variant="caption" muted>
            {formatDateTime(h.at, locale)}
            {h.message ? ` · “${h.message}”` : ''}
          </Text>
        </View>
      ))}
    </Screen>
  );
}

export default function NegotiationScreen() {
  return (
    <RequireAuth>
      <Thread />
    </RequireAuth>
  );
}
