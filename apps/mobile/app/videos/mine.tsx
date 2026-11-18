import type { CursorPage, VideoDTO } from '@farmplus/shared-types';
import { humanize } from '@farmplus/shared-utils';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { Button, Card, StateView, StatusBadge, Text } from '@/components/ui';
import { useCursorList } from '@/hooks/useCursorList';
import { t as tr, useT } from '@/i18n';
import { confirmAction } from '@/lib/confirm';
import { errorText } from '@/lib/messages';
import { processingStateLabel, videoFailureText } from '@/lib/pickedVideo';
import { theme } from '@/theme';

const TONE = {
  pending_upload: 'warning',
  processing: 'warning',
  ready: 'success',
  failed: 'error',
} as const;

const STATUSES = ['published', 'hidden', 'removed', 'deleted'] as const;

/** Moderation status shown on the badge; unknown values fall back to `humanize`. */
function statusLabel(status: string): string {
  const known = STATUSES.find((s) => s === status);
  return known ? tr('videos', `status.${known}`) : humanize(status);
}

function Row({
  video,
  onChange,
  onRemoved,
}: {
  video: VideoDTO;
  onChange: (v: VideoDTO) => void;
  onRemoved: (id: string) => void;
}) {
  const t = useT('videos');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const state = video.processing.state;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Text variant="heading">{video.title}</Text>
      <View style={styles.row}>
        <StatusBadge tone={TONE[state]} label={processingStateLabel(state)} />
        {video.status !== 'published' ? (
          <StatusBadge tone="error" label={statusLabel(video.status)} />
        ) : null}
      </View>
      {video.moderationNotice ? (
        <Text color={theme.colors.warning.fg}>{video.moderationNotice}</Text>
      ) : null}
      {video.processing.failure ? (
        <Text color={theme.colors.error.fg}>{videoFailureText(video.processing.failure)}</Text>
      ) : null}
      {error ? <Text color={theme.colors.error.fg}>{error}</Text> : null}
      <Text variant="caption" muted>
        {t('mine.stats', {
          views: video.viewCount,
          likes: video.reactionCount,
          comments: video.commentCount,
        })}
      </Text>
      <View style={styles.row}>
        {state === 'ready' && video.status === 'published' ? (
          <Button title={t('mine.watch')} onPress={() => router.push(`/videos/${video.id}`)} />
        ) : null}
        {state === 'pending_upload' || state === 'processing' ? (
          <Button
            title={t('mine.checkStatus')}
            variant="secondary"
            loading={busy}
            onPress={() =>
              void run(async () =>
                onChange(
                  (await api.request<{ video: VideoDTO }>('POST', `/videos/${video.id}/refresh`))
                    .video,
                ),
              )
            }
          />
        ) : null}
        <Button
          title={t('mine.delete')}
          variant="ghost"
          onPress={() =>
            void (async () => {
              if (
                !(await confirmAction(
                  t('mine.confirmTitle'),
                  t('mine.confirmMessage'),
                  t('mine.confirmLabel'),
                ))
              )
                return;
              await run(async () => {
                await api.request('DELETE', `/videos/${video.id}`);
                onRemoved(video.id);
              });
            })()
          }
        />
      </View>
    </Card>
  );
}

function Mine() {
  const t = useT('videos');
  const list = useCursorList<VideoDTO>(
    (cursor, signal) =>
      api.request<CursorPage<VideoDTO>>('GET', '/videos', {
        query: { mine: 'true', limit: 20, ...(cursor ? { cursor } : {}) },
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
      keyExtractor={(v) => v.id}
      ListEmptyComponent={
        list.loading ? (
          <StateView kind="loading" />
        ) : (
          <StateView kind="empty" title={t('mine.emptyTitle')} message={t('mine.emptyMessage')} />
        )
      }
      refreshControl={<RefreshControl refreshing={false} onRefresh={list.reload} />}
      onEndReached={list.loadMore}
      renderItem={({ item }) => (
        <Row video={item} onChange={list.replaceItem} onRemoved={list.removeItem} />
      )}
    />
  );
}

export default function MineScreen() {
  return (
    <RequireAuth>
      <Mine />
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },
  row: { flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center', flexWrap: 'wrap' },
});
