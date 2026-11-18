import type { CursorPage, FeedScope, FeedSort, PostDTO } from '@farmplus/shared-types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { PostCard } from '@/components/community/PostCard';
import { Button, OptionPicker, StateView, Text } from '@/components/ui';
import { useCursorList } from '@/hooks/useCursorList';
import { useT } from '@/i18n';
import { theme } from '@/theme';

function Feed() {
  const router = useRouter();
  const t = useT('community');
  const [scope, setScope] = useState<FeedScope>('all');
  const [sort, setSort] = useState<FeedSort>('recent');
  const list = useCursorList<PostDTO>(
    (cursor, signal) =>
      api.request<CursorPage<PostDTO>>('GET', '/posts', {
        query: { scope, sort, limit: 10, ...(cursor ? { cursor } : {}) },
        signal,
      }),
    [scope, sort],
  );

  const header = (
    <View style={styles.header}>
      <Text variant="title">{t('feed.title')}</Text>
      <Button title={t('feed.newPost')} onPress={() => router.push('/community/new')} />
      <OptionPicker
        label={t('feed.show')}
        value={scope}
        onChange={(v) => setScope(v as FeedScope)}
        options={[
          { value: 'all', label: t('feed.scope.all') },
          { value: 'following', label: t('feed.scope.following') },
        ]}
      />
      <OptionPicker
        label={t('feed.order')}
        value={sort}
        onChange={(v) => setSort(v as FeedSort)}
        options={[
          { value: 'recent', label: t('feed.sort.recent') },
          { value: 'trending', label: t('feed.sort.trending') },
        ]}
      />
    </View>
  );

  if (list.error && list.items.length === 0)
    return (
      <View style={styles.fill}>
        {header}
        <StateView kind="error" error={list.error} onRetry={list.reload} />
      </View>
    );
  return (
    <FlatList
      style={styles.fill}
      contentContainerStyle={styles.content}
      data={list.items}
      keyExtractor={(p) => p.id}
      ListHeaderComponent={header}
      ListEmptyComponent={
        list.loading ? (
          <StateView kind="loading" label={t('feed.loading')} />
        ) : (
          <StateView
            kind="empty"
            title={t('feed.emptyTitle')}
            message={scope === 'following' ? t('feed.emptyFollowing') : t('feed.emptyAll')}
          />
        )
      }
      ListFooterComponent={list.loadingMore ? <StateView kind="loading" /> : null}
      refreshControl={<RefreshControl refreshing={false} onRefresh={list.reload} />}
      onEndReached={list.loadMore}
      onEndReachedThreshold={0.4}
      renderItem={({ item }) => (
        <PostCard post={item} onChange={list.replaceItem} onRemoved={list.removeItem} />
      )}
    />
  );
}

export default function CommunityScreen() {
  return (
    <RequireAuth>
      <Feed />
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg, gap: theme.spacing.lg },
  header: { gap: theme.spacing.md },
});
