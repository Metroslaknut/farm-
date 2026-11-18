import type { CursorPage, OrderDTO } from '@farmplus/shared-types';
import { formatBaht } from '@farmplus/shared-utils';
import { useRouter } from 'expo-router';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { PressableCard, StateView, StatusBadge, Text } from '@/components/ui';
import { useCursorList } from '@/hooks/useCursorList';
import { useT } from '@/i18n';
import { fulfillmentLabel, orderStatusLabel } from '@/lib/market-labels';
import { theme } from '@/theme';

const TONE = {
  PENDING_PAYMENT: 'warning',
  PAID: 'success',
  PROCESSING: 'success',
  SHIPPED: 'success',
  DELIVERED: 'success',
  CANCELLED: 'warning',
  REFUND_PENDING: 'warning',
  REFUNDED: 'warning',
} as const;

function Orders() {
  const t = useT('market');
  const router = useRouter();
  const list = useCursorList<OrderDTO>(
    (cursor, signal) =>
      api.request<CursorPage<OrderDTO>>('GET', '/orders', {
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
      keyExtractor={(o) => o.id}
      ListEmptyComponent={
        list.loading ? (
          <StateView kind="loading" />
        ) : (
          <StateView
            kind="empty"
            title={t('orders.emptyTitle')}
            message={t('orders.emptyMessage')}
          />
        )
      }
      refreshControl={<RefreshControl refreshing={false} onRefresh={list.reload} />}
      onEndReached={list.loadMore}
      renderItem={({ item }) => (
        <PressableCard
          accessibilityLabel={t('orders.a11y', { no: item.orderNo })}
          onPress={() => router.push(`/orders/${item.id}`)}
        >
          <Text variant="heading">{item.items[0]?.title ?? item.orderNo}</Text>
          <View style={styles.row}>
            <StatusBadge tone={TONE[item.status]} label={orderStatusLabel(item.status)} />
          </View>
          <Text muted>
            {item.orderNo} · {formatBaht(item.totals.grandTotalMinor)} ·{' '}
            {fulfillmentLabel(item.fulfillment === 'delivery' ? 'delivery' : 'pickup')}
          </Text>
        </PressableCard>
      )}
    />
  );
}

export default function OrdersScreen() {
  return (
    <RequireAuth>
      <Orders />
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },
  row: { flexDirection: 'row', gap: theme.spacing.sm },
});
