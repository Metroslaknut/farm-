import type { CursorPage, NegotiationDTO } from '@farmplus/shared-types';
import { formatBaht } from '@farmplus/shared-utils';
import { useRouter } from 'expo-router';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { PressableCard, StateView, StatusBadge, Text } from '@/components/ui';
import { useCursorList } from '@/hooks/useCursorList';
import { useT } from '@/i18n';
import { negotiationStatusLabel } from '@/lib/market-labels';
import { theme } from '@/theme';

const TONE = {
  open: 'warning',
  accepted: 'success',
  completed: 'success',
  rejected: 'error',
  withdrawn: 'warning',
  expired: 'warning',
  cancelled: 'warning',
} as const;

function Offers() {
  const t = useT('market');
  const router = useRouter();
  const list = useCursorList<NegotiationDTO>(
    (cursor, signal) =>
      api.request<CursorPage<NegotiationDTO>>('GET', '/marketplace/negotiations', {
        query: { limit: 20, ...(cursor ? { cursor } : {}) },
        signal,
      }),
    [],
  );
  if (list.error && list.items.length === 0)
    return <StateView kind="error" error={list.error} onRetry={list.reload} />;
  return (
    <FlatList
      style={styles.fill}
      contentContainerStyle={styles.content}
      data={list.items}
      keyExtractor={(n) => n.id}
      ListEmptyComponent={
        list.loading ? (
          <StateView kind="loading" />
        ) : (
          <StateView
            kind="empty"
            title={t('offers.emptyTitle')}
            message={t('offers.emptyMessage')}
          />
        )
      }
      refreshControl={<RefreshControl refreshing={false} onRefresh={list.reload} />}
      onEndReached={list.loadMore}
      renderItem={({ item }) => (
        <PressableCard
          accessibilityLabel={t('offers.a11y', { title: item.listingTitle })}
          onPress={() => router.push(`/marketplace/offers/${item.id}`)}
        >
          <Text variant="heading">{item.listingTitle}</Text>
          <View style={styles.row}>
            <StatusBadge tone={TONE[item.status]} label={negotiationStatusLabel(item.status)} />
            {item.status === 'open' && item.viewer.canAct ? (
              <StatusBadge tone="warning" label={t('offers.yourTurn')} />
            ) : null}
          </View>
          <Text muted>
            {t('offers.summary', {
              offer: formatBaht(item.currentOfferMinor),
              asking: formatBaht(item.askingPriceMinor),
            })}
          </Text>
        </PressableCard>
      )}
    />
  );
}

export default function OffersScreen() {
  return (
    <RequireAuth>
      <Offers />
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },
  row: { flexDirection: 'row', gap: theme.spacing.sm },
});
