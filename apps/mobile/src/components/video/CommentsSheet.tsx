import type { CommentDTO, CursorPage } from '@farmplus/shared-types';
import { FlatList, Modal, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { CommentForm, CommentRow } from '@/components/community/comments';
import { Button, StateView, Text } from '@/components/ui';
import { useCursorList } from '@/hooks/useCursorList';
import { useT } from '@/i18n';
import { theme } from '@/theme';

/** Bottom sheet with a video's comments. */
export function CommentsSheet({
  videoId,
  visible,
  onClose,
  onCountChange,
}: {
  videoId: string;
  visible: boolean;
  onClose: () => void;
  onCountChange: (delta: number) => void;
}) {
  const t = useT('videos');
  const list = useCursorList<CommentDTO>(
    (cursor, signal) =>
      visible
        ? api.request<CursorPage<CommentDTO>>('GET', `/videos/${videoId}/comments`, {
            query: { limit: 10, ...(cursor ? { cursor } : {}) },
            signal,
          })
        : Promise.resolve({ items: [] }),
    [videoId, visible],
  );
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text variant="heading">{t('comments.title')}</Text>
            <Button title={t('comments.close')} variant="ghost" onPress={onClose} />
          </View>
          <CommentForm
            resource="videos"
            postId={videoId}
            label={t('comments.add')}
            onSaved={() => {
              onCountChange(1);
              list.reload();
            }}
          />
          <FlatList
            data={list.items}
            keyExtractor={(c) => c.id}
            ListEmptyComponent={
              list.loading ? <StateView kind="loading" /> : <Text muted>{t('comments.empty')}</Text>
            }
            onEndReached={list.loadMore}
            renderItem={({ item }) => (
              <CommentRow
                resource="videos"
                comment={item}
                postId={videoId}
                open
                canReply
                onChange={list.replaceItem}
                onRemoved={(id) => {
                  list.removeItem(id);
                  onCountChange(-1);
                }}
              />
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    maxHeight: '80%',
    backgroundColor: theme.colors.background,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
