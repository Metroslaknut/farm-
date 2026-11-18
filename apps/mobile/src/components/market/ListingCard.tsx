import type { ListingDTO } from '@farmplus/shared-types';
import { formatAge, formatBaht, humanize } from '@farmplus/shared-utils';
import { useRouter } from 'expo-router';
import { Image, StyleSheet, View } from 'react-native';
import { PressableCard, StatusBadge, Text } from '@/components/ui';
import { useT } from '@/i18n';
import { ageText, listingStatusLabel, sexLabel } from '@/lib/market-labels';
import { theme } from '@/theme';

const TONE = {
  ACTIVE: 'success',
  RESERVED: 'warning',
  SOLD: 'warning',
  PENDING_REVIEW: 'warning',
  REJECTED: 'error',
} as const;

/** One listing in browse / saved lists. */
export function ListingCard({ listing }: { listing: ListingDTO }) {
  const t = useT('market');
  const router = useRouter();
  const photo = listing.photos[0];
  const age = ageText(formatAge(listing.animal.birthDate ?? undefined));
  return (
    <PressableCard
      accessibilityLabel={t('card.a11y', {
        title: listing.title,
        price: formatBaht(listing.askingPriceMinor),
      })}
      onPress={() => router.push(`/marketplace/${listing.id}`)}
    >
      {photo ? (
        <Image
          source={{ uri: photo.url }}
          style={styles.photo}
          accessibilityLabel={photo.caption ?? listing.title}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.photo, styles.none]}>
          <Text muted>{t('card.noPhoto')}</Text>
        </View>
      )}
      <Text variant="heading">{listing.title}</Text>
      <Text variant="heading" color={theme.colors.primary}>
        {formatBaht(listing.askingPriceMinor)}
      </Text>
      <Text muted>
        {[
          listing.animal.animalTypeName,
          listing.animal.breed && humanize(listing.animal.breed),
          sexLabel(listing.animal.sex),
          age,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <Text muted>
        {[listing.location.district, listing.location.province].filter(Boolean).join(', ') ||
          t('listing.noLocation')}
      </Text>
      <View style={styles.row}>
        {listing.status !== 'ACTIVE' ? (
          <StatusBadge
            tone={TONE[listing.status as keyof typeof TONE] ?? 'warning'}
            label={listingStatusLabel(listing.status)}
          />
        ) : null}
        {!listing.negotiable ? (
          <StatusBadge tone="warning" label={t('listing.fixedPrice')} />
        ) : null}
      </View>
    </PressableCard>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: theme.radius.md },
  none: {
    backgroundColor: theme.colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', gap: theme.spacing.sm },
});
