import type { CursorPage, VideoDTO } from '@farmplus/shared-types';
import { shouldLoadMore, slideWindow } from '@farmplus/shared-utils';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, View, type ViewToken } from 'react-native';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { Button, StateView } from '@/components/ui';
import { VideoSlide } from '@/components/video/VideoSlide';
import { useCursorList } from '@/hooks/useCursorList';
import { useT } from '@/i18n';
import { theme } from '@/theme';

/** A slide counts as the current one when 60 % of it is on screen. Must be a stable object for FlatList. */
const VIEWABILITY = { itemVisiblePercentThreshold: 60 };

function VideoFeed() {
  const t = useT('videos');
  const router = useRouter();
  const [height, setHeight] = useState(0);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(false);
  const list = useCursorList<VideoDTO>(
    (cursor, signal) =>
      api.request<CursorPage<VideoDTO>>('GET', '/videos', {
        query: { limit: 6, ...(cursor ? { cursor } : {}) },
        signal,
      }),
    [],
  );
  const count = list.items.length;
  const win = slideWindow(active, count);

  // Which slide fills the screen? (stable callback: FlatList requires it not to change)
  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable && v.index !== null);
    if (first && first.index !== null) setActive(first.index);
  }, []);
  useEffect(() => {
    if (shouldLoadMore(active, count, list.hasMore && !list.loading && !list.loadingMore))
      list.loadMore();
  }, [active, count, list]);
  const layout = useCallback(
    (_: unknown, index: number) => ({ length: height, offset: height * index, index }),
    [height],
  );

  return (
    <View
      style={{ flex: 1, backgroundColor: theme.colors.mediaBackground }}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
    >
      {height > 0 && count > 0 && (
        <FlatList
          data={list.items}
          keyExtractor={(v) => v.id}
          pagingEnabled
          snapToInterval={height}
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          getItemLayout={layout}
          windowSize={3}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          removeClippedSubviews
          onViewableItemsChanged={onViewable}
          viewabilityConfig={VIEWABILITY}
          extraData={`${active}-${muted}`}
          renderItem={({ item, index }) => (
            <VideoSlide
              video={item}
              height={height}
              mounted={win.mount.includes(index)}
              active={index === active}
              prefetch={win.prefetch.includes(index)}
              muted={muted}
              onToggleMute={() => setMuted((m) => !m)}
              onChange={list.replaceItem}
            />
          )}
        />
      )}
      {list.error && count === 0 ? (
        <StateView kind="error" error={list.error} onRetry={list.reload} />
      ) : null}
      {list.loading && count === 0 ? <StateView kind="loading" label={t('feed.loading')} /> : null}
      {!list.loading && !list.error && count === 0 ? (
        <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
          <StateView kind="empty" title={t('feed.emptyTitle')} message={t('feed.emptyMessage')} />
        </View>
      ) : null}
      <View
        style={{
          position: 'absolute',
          top: theme.spacing.sm,
          left: theme.spacing.sm,
          flexDirection: 'row',
          gap: theme.spacing.sm,
        }}
      >
        <Button title={t('feed.upload')} onPress={() => router.push('/videos/upload')} />
        <Button
          title={t('feed.mine')}
          variant="secondary"
          onPress={() => router.push('/videos/mine')}
        />
        <Button title={t('feed.live')} variant="secondary" onPress={() => router.push('/live')} />
      </View>
    </View>
  );
}

export default function VideosTab() {
  return (
    <RequireAuth>
      <VideoFeed />
    </RequireAuth>
  );
}
