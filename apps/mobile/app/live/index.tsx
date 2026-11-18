import type { CursorPage, LiveDTO } from '@farmplus/shared-types';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { FlatList, RefreshControl, StyleSheet } from 'react-native';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { PressableCard, StateView, StatusBadge, Text } from '@/components/ui';
import { useCursorList } from '@/hooks/useCursorList';
import { useT } from '@/i18n';
import { theme } from '@/theme';

function LiveList() {
  const t = useT('videos');
  const router = useRouter();
  const list = useCursorList<LiveDTO>(
    (cursor, signal) =>
      api.request<CursorPage<LiveDTO>>('GET', '/live', {
        query: { state: 'live', limit: 12, ...(cursor ? { cursor } : {}) },
        signal,
      }),
    [],
  );
  const { reload } = list;
  useEffect(() => {
    const timer = setInterval(reload, 15_000);
    return () => clearInterval(timer);
  }, [reload]);
  if (list.error && list.items.length === 0)
    return <StateView kind="error" error={list.error} onRetry={list.reload} />;
  return (
    <FlatList
      style={styles.fill}
      contentContainerStyle={styles.content}
      data={list.items}
      keyExtractor={(l) => l.id}
      ListHeaderComponent={<Text variant="title">{t('live.title')}</Text>}
      ListEmptyComponent={
        list.loading ? (
          <StateView kind="loading" />
        ) : (
          <StateView kind="empty" title={t('live.emptyTitle')} message={t('live.emptyMessage')} />
        )
      }
      refreshControl={<RefreshControl refreshing={false} onRefresh={list.reload} />}
      onEndReached={list.loadMore}
      renderItem={({ item }) => (
        <PressableCard
          accessibilityLabel={t('live.watchA11y', { title: item.title })}
          onPress={() => router.push(`/live/${item.id}`)}
        >
          <StatusBadge
            tone={item.state === 'live' ? 'error' : 'warning'}
            label={item.state === 'live' ? t('live.badge') : t('live.reconnecting')}
          />
          <Text variant="heading">{item.title}</Text>
          <Text muted>{t('live.hostedBy', { name: item.host.displayName })}</Text>
        </PressableCard>
      )}
    />
  );
}

export default function LiveListScreen() {
  return (
    <RequireAuth>
      <LiveList />
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },
});
