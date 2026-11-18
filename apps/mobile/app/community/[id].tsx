import type { CommentDTO, CursorPage, PostDTO } from '@farmplus/shared-types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { CommentForm, CommentRow } from '@/components/community/comments';
import { PostCard } from '@/components/community/PostCard';
import { Card, StateView, Text } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useCursorList } from '@/hooks/useCursorList';
import { useT } from '@/i18n';
import { theme } from '@/theme';

function PostDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useT('community');
  const [override, setOverride] = useState<PostDTO>();
  const post = useAsync(
    (signal) => api.request<{ post: PostDTO }>('GET', `/posts/${id}`, { signal }),
    [id],
  );
  const comments = useCursorList<CommentDTO>(
    (cursor, signal) =>
      api.request<CursorPage<CommentDTO>>('GET', `/posts/${id}/comments`, {
        query: { limit: 10, ...(cursor ? { cursor } : {}) },
        signal,
      }),
    [id],
  );

  if (post.error) return <StateView kind="error" error={post.error} onRetry={post.reload} />;
  const current = override?.id === id ? override : post.data?.post;
  if (!current) return <StateView kind="loading" label={t('detail.loading')} />;
  const open = current.status === 'published';
  const bump = (d: number) =>
    setOverride({ ...current, commentCount: Math.max(0, current.commentCount + d) });

  return (
    <FlatList
      style={styles.fill}
      contentContainerStyle={styles.content}
      data={comments.items}
      keyExtractor={(c) => c.id}
      ListHeaderComponent={
        <View style={styles.gap}>
          <PostCard post={current} detail onChange={setOverride} onRemoved={() => router.back()} />
          {open ? (
            <Card>
              <CommentForm
                postId={current.id}
                label={t('detail.addComment')}
                onSaved={() => {
                  bump(1);
                  comments.reload();
                }}
              />
            </Card>
          ) : (
            <Text muted>{t('detail.closed')}</Text>
          )}
          <Text variant="heading">
            {t('detail.commentsHeading', { count: current.commentCount })}
          </Text>
        </View>
      }
      ListEmptyComponent={
        comments.loading ? (
          <StateView kind="loading" />
        ) : (
          <Text muted>{t('detail.noComments')}</Text>
        )
      }
      onEndReached={comments.loadMore}
      onEndReachedThreshold={0.4}
      renderItem={({ item }) => (
        <CommentRow
          comment={item}
          postId={current.id}
          open={open}
          canReply
          onChange={comments.replaceItem}
          onRemoved={(cid) => {
            comments.removeItem(cid);
            bump(-1);
          }}
        />
      )}
    />
  );
}

export default function PostScreen() {
  return (
    <RequireAuth>
      <PostDetail />
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },
  gap: { gap: theme.spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' },
  form: { gap: theme.spacing.sm },
  comment: {
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  indent: { marginLeft: theme.spacing.lg, gap: theme.spacing.sm },
});
