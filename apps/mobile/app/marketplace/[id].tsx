import type { FavoriteResult, ListingDTO, NegotiationDTO } from '@farmplus/shared-types';
import { formatDate } from '@farmplus/i18n';
import { formatBaht, humanize, parseBahtToMinor } from '@farmplus/shared-utils';
import { createOfferSchema } from '@farmplus/validation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { Button, Card, Screen, StateView, StatusBadge, Text, TextField } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useLocale, useT } from '@/i18n';
import { listingStatusLabel, sexLabel } from '@/lib/market-labels';
import { errorText, validationText } from '@/lib/messages';
import { theme } from '@/theme';

function Detail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT('market');
  const [locale] = useLocale();
  const router = useRouter();
  const listing = useAsync(
    (signal) =>
      api.request<{ listing: ListingDTO }>('GET', `/marketplace/listings/${id}`, { signal }),
    [id],
  );
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [fav, setFav] = useState<FavoriteResult>();

  if (listing.error)
    return <StateView kind="error" error={listing.error} onRetry={listing.reload} />;
  if (!listing.data) return <StateView kind="loading" label={t('common.loading')} />;
  const l = listing.data.listing;
  const favorited = fav?.favorited ?? l.viewer.favorited;
  const canOffer = l.status === 'ACTIVE' && !l.viewer.isSellerSide && !l.viewer.negotiationId;

  const toggleFavorite = async () => {
    try {
      setFav(
        await api.request<FavoriteResult>(
          favorited ? 'DELETE' : 'POST',
          `/marketplace/listings/${l.id}/favorite`,
        ),
      );
    } catch (e) {
      setError(errorText(e));
    }
  };

  const submit = async () => {
    const minor = l.negotiable ? parseBahtToMinor(amount) : l.askingPriceMinor;
    if (minor === undefined) return setError(t('detail.offerInvalid'));
    if (minor > l.askingPriceMinor) return setError(t('detail.offerTooHigh'));
    const parsed = createOfferSchema.safeParse({
      amountMinor: minor,
      ...(message.trim() ? { message: message.trim() } : {}),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message;
      return setError(issue ? validationText(issue) : t('detail.offerInvalidGeneric'));
    }
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.request<{ negotiation: NegotiationDTO }>(
        'POST',
        `/marketplace/listings/${l.id}/negotiations`,
        { body: parsed.data },
      );
      router.replace(`/marketplace/offers/${res.negotiation.id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      {l.photos.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityLabel={t('detail.photos')}
          contentContainerStyle={{ gap: theme.spacing.sm }}
        >
          {l.photos.map((p) => (
            <Image
              key={p.url}
              source={{ uri: p.url }}
              style={styles.photo}
              accessibilityLabel={p.caption ?? l.title}
              accessibilityIgnoresInvertColors
            />
          ))}
        </ScrollView>
      ) : null}
      <Text variant="title">{l.title}</Text>
      <Text variant="heading" color={theme.colors.primary}>
        {formatBaht(l.askingPriceMinor)}
      </Text>
      <View style={styles.row}>
        <StatusBadge
          tone={l.status === 'ACTIVE' ? 'success' : 'warning'}
          label={listingStatusLabel(l.status)}
        />
        <StatusBadge
          tone="warning"
          label={l.negotiable ? t('detail.openToOffers') : t('listing.fixedPrice')}
        />
      </View>
      {l.status === 'RESERVED' ? <Text muted>{t('detail.reserved')}</Text> : null}
      {l.status === 'SOLD' ? <Text muted>{t('detail.sold')}</Text> : null}
      <Card>
        <Text>
          {l.animal.animalTypeName}
          {l.animal.breed ? ` · ${humanize(l.animal.breed)}` : ''} · {sexLabel(l.animal.sex)}
        </Text>
        {l.animal.birthDate ? (
          <Text muted>
            {t('detail.born', {
              date: locale === 'en' ? l.animal.birthDate : formatDate(l.animal.birthDate, locale),
            })}
          </Text>
        ) : null}
        <Text muted>
          {[l.location.district, l.location.province].filter(Boolean).join(', ') ||
            t('listing.noLocation')}
        </Text>
        <Text muted>{t('detail.seller', { name: l.seller.displayName, farm: l.farmName })}</Text>
        {l.description ? <Text>{l.description}</Text> : null}
        {l.conditions ? (
          <>
            <Text variant="label">{t('detail.conditions')}</Text>
            <Text>{l.conditions}</Text>
          </>
        ) : null}
      </Card>
      {['ACTIVE', 'RESERVED'].includes(l.status) ? (
        <Button
          title={t(favorited ? 'detail.saved' : 'detail.save', {
            count: fav?.favoriteCount ?? l.favoriteCount,
          })}
          variant="secondary"
          onPress={() => void toggleFavorite()}
        />
      ) : null}
      {l.viewer.isSellerSide ? <Text muted>{t('detail.ownListing')}</Text> : null}
      {l.viewer.negotiationId ? (
        <Button
          title={t('detail.openNegotiation')}
          onPress={() => router.push(`/marketplace/offers/${l.viewer.negotiationId}`)}
        />
      ) : null}
      {canOffer ? (
        <Card>
          <Text variant="heading">{t('detail.makeOffer')}</Text>
          {l.negotiable ? (
            <TextField
              label={t('detail.offerLabel')}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              hint={t('detail.offerHint', { price: formatBaht(l.askingPriceMinor) })}
            />
          ) : (
            <Text>{t('detail.fixedAt', { price: formatBaht(l.askingPriceMinor) })}</Text>
          )}
          <TextField
            label={t('detail.messageLabel')}
            value={message}
            onChangeText={setMessage}
            maxLength={500}
            multiline
          />
          <Button
            title={l.negotiable ? t('detail.sendOffer') : t('detail.requestBuy')}
            loading={busy}
            onPress={() => void submit()}
          />
          <Text variant="caption" muted>
            {t('detail.offerNote')}
          </Text>
        </Card>
      ) : null}
      {error ? <Text color={theme.colors.error.fg}>{error}</Text> : null}
    </Screen>
  );
}

export default function ListingScreen() {
  return (
    <RequireAuth>
      <Detail />
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  photo: { width: 280, aspectRatio: 4 / 3, borderRadius: theme.radius.md },
  row: { flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' },
});
