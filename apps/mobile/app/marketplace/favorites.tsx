import type { CursorPage, ListingDTO } from '@farmplus/shared-types';
import { FlatList, RefreshControl, StyleSheet } from 'react-native';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { ListingCard } from '@/components/market/ListingCard';
import { StateView } from '@/components/ui';
import { useCursorList } from '@/hooks/useCursorList';
import { useT } from '@/i18n';
import { theme } from '@/theme';

function Favorites() {
  const t = useT('market');
  const list = useCursorList<ListingDTO>(
    (cursor, signal) =>
      api.request<CursorPage<ListingDTO>>('GET', '/marketplace/favorites', {
        query: { limit: 12, ...(cursor ? { cursor } : {}) },
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
      keyExtractor={(l) => l.id}
      ListEmptyComponent={
        list.loading ? (
          <StateView kind="loading" />
        ) : (
          <StateView
            kind="empty"
            title={t('favorites.emptyTitle')}
            message={t('favorites.emptyMessage')}
          />
        )
      }
      refreshControl={<RefreshControl refreshing={false} onRefresh={list.reload} />}
      onEndReached={list.loadMore}
      renderItem={({ item }) => <ListingCard listing={item} />}
    />
  );
}

export default function FavoritesScreen() {
  return (
    <RequireAuth>
      <Favorites />
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },
});
