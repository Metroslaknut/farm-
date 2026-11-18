import { formatDate } from '@farmplus/i18n';
import type { CursorPage, FollowResult, PostDTO, UserProfileDTO } from '@farmplus/shared-types';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { PostCard } from '@/components/community/PostCard';
import { Button, Card, StateView, Text } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useCursorList } from '@/hooks/useCursorList';
import { useLocale, useT } from '@/i18n';
import { errorText } from '@/lib/messages';
import { theme } from '@/theme';

function Profile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT('community');
  const [locale] = useLocale();
  const profile = useAsync(
    (signal) => api.request<UserProfileDTO>('GET', `/users/${id}/profile`, { signal }),
    [id],
  );
  const posts = useCursorList<PostDTO>(
    (cursor, signal) =>
      api.request<CursorPage<PostDTO>>('GET', '/posts', {
        query: { authorId: id, limit: 10, ...(cursor ? { cursor } : {}) },
        signal,
      }),
    [id],
  );
  const [follow, setFollow] = useState<FollowResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (profile.error)
    return <StateView kind="error" error={profile.error} onRetry={profile.reload} />;
  const p = profile.data;
  if (!p) return <StateView kind="loading" label={t('profile.loading')} />;
  const following = follow?.following ?? p.isFollowing;
  const followers = follow?.followerCount ?? p.followerCount;

  const toggle = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setFollow(
        await api.request<FollowResult>(following ? 'DELETE' : 'POST', `/users/${p.id}/follow`),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FlatList
      style={styles.fill}
      contentContainerStyle={styles.content}
      data={posts.items}
      keyExtractor={(x) => x.id}
      ListHeaderComponent={
        <Card>
          <Text variant="title">{p.displayName}</Text>
          <Text muted>{t('profile.memberSince', { date: formatDate(p.joinedAt, locale) })}</Text>
          <View style={styles.row}>
            <Text>{t('profile.posts', { count: p.postCount })}</Text>
            <Text>{t('profile.followers', { count: followers })}</Text>
            <Text>{t('profile.following', { count: p.followingCount })}</Text>
          </View>
          {!p.isSelf ? (
            <Button
              title={following ? t('profile.followingButton') : t('profile.follow')}
              variant={following ? 'secondary' : 'primary'}
              loading={busy}
              accessibilityLabel={
                following
                  ? t('profile.unfollowA11y', { name: p.displayName })
                  : t('profile.followA11y', { name: p.displayName })
              }
              onPress={() => void toggle()}
            />
          ) : null}
          {error ? <Text color={theme.colors.error.fg}>{error}</Text> : null}
        </Card>
      }
      ListEmptyComponent={
        posts.loading ? <StateView kind="loading" /> : <Text muted>{t('profile.noPosts')}</Text>
      }
      onEndReached={posts.loadMore}
      onEndReachedThreshold={0.4}
      renderItem={({ item }) => (
        <PostCard post={item} onChange={posts.replaceItem} onRemoved={posts.removeItem} />
      )}
    />
  );
}

export default function ProfileScreen() {
  return (
    <RequireAuth>
      <Profile />
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg, gap: theme.spacing.lg },
  row: { flexDirection: 'row', gap: theme.spacing.lg, flexWrap: 'wrap' },
});
