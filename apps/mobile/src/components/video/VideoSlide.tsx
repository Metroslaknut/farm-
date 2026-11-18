import type { PlaybackInfo, ReactionResult, VideoDTO, ViewResult } from '@farmplus/shared-types';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { ReportModal } from '@/components/community/ReportModal';
import { Text } from '@/components/ui';
import { useT } from '@/i18n';
import { optimisticReaction, settleReaction } from '@/lib/community';
import { theme } from '@/theme';
import { CommentsSheet } from './CommentsSheet';
import { MobilePlayer } from './MobilePlayer';

/** One full-screen slide: player + creator/title overlay + like / comment / report. */
export function VideoSlide({
  video,
  height,
  mounted,
  active,
  prefetch,
  muted,
  onToggleMute,
  onChange,
}: {
  video: VideoDTO;
  height: number;
  mounted: boolean;
  active: boolean;
  prefetch: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onChange: (video: VideoDTO) => void;
}) {
  const t = useT('videos');
  const router = useRouter();
  const [comments, setComments] = useState(false);
  const [report, setReport] = useState(false);
  const [notice, setNotice] = useState<string>();

  const like = async () => {
    const was = video.viewer.reacted;
    onChange(optimisticReaction(video));
    try {
      const res = await api.request<ReactionResult>(
        was ? 'DELETE' : 'POST',
        `/videos/${video.id}/reactions`,
        was ? {} : { body: { type: 'like' } },
      );
      onChange(settleReaction(video, res));
    } catch {
      onChange(video);
      setNotice(t('slide.likeFailed'));
    }
  };
  const fetchPlayback = useCallback(
    () => api.request<PlaybackInfo>('GET', `/videos/${video.id}/playback`),
    [video.id],
  );
  const onWatched = useCallback(
    (watchedSeconds: number) => {
      api
        .request<ViewResult>('POST', `/videos/${video.id}/views`, { body: { watchedSeconds } })
        .then((r) => r.counted && onChange({ ...video, viewCount: r.viewCount }))
        .catch(() => undefined); // best effort: never disturb playback
    },
    [video, onChange],
  );

  return (
    <View style={{ height }}>
      {mounted ? (
        <MobilePlayer
          label={video.title}
          active={active}
          preload={prefetch}
          muted={muted}
          onToggleMute={onToggleMute}
          fetchPlayback={fetchPlayback}
          onWatched={onWatched}
        />
      ) : (
        <View style={styles.placeholder} />
      )}
      <View style={styles.info} pointerEvents="box-none">
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t('slide.openProfile', { name: video.creator.displayName })}
          onPress={() => router.push(`/community/user/${video.creator.id}`)}
        >
          <Text variant="label" color={theme.colors.onMedia}>
            @{video.creator.displayName}
          </Text>
        </Pressable>
        <Text variant="heading" color={theme.colors.onMedia}>
          {video.title}
        </Text>
        {video.caption ? <Text color={theme.colors.onMedia}>{video.caption}</Text> : null}
        <Text variant="caption" color={theme.colors.onMedia}>
          {t(video.viewCount === 1 ? 'slide.viewOne' : 'slide.viewMany', {
            count: video.viewCount,
          })}
        </Text>
        {notice ? <Text color={theme.colors.onMedia}>{notice}</Text> : null}
      </View>
      <View style={styles.actions}>
        <Pressable
          style={[styles.act, video.viewer.reacted && styles.actOn]}
          accessibilityRole="button"
          accessibilityState={{ selected: video.viewer.reacted }}
          accessibilityLabel={t(video.viewer.reacted ? 'slide.unlikeA11y' : 'slide.likeA11y', {
            count: video.reactionCount,
          })}
          onPress={() => void like()}
        >
          <Text color={theme.colors.onMedia}>♥ {video.reactionCount}</Text>
        </Pressable>
        <Pressable
          style={styles.act}
          accessibilityRole="button"
          accessibilityLabel={t('slide.commentsA11y', { count: video.commentCount })}
          onPress={() => setComments(true)}
        >
          <Text color={theme.colors.onMedia}>💬 {video.commentCount}</Text>
        </Pressable>
        {!video.viewer.isCreator && (
          <Pressable
            style={styles.act}
            accessibilityRole="button"
            accessibilityLabel={t('slide.report')}
            onPress={() => setReport(true)}
          >
            <Text color={theme.colors.onMedia}>⚑</Text>
          </Pressable>
        )}
      </View>
      <CommentsSheet
        videoId={video.id}
        visible={comments}
        onClose={() => setComments(false)}
        onCountChange={(d) =>
          onChange({ ...video, commentCount: Math.max(0, video.commentCount + d) })
        }
      />
      <ReportModal
        target={report ? { type: 'video', id: video.id } : null}
        onClose={() => setReport(false)}
        onReported={() => setNotice(t('slide.reported'))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { flex: 1, backgroundColor: theme.colors.mediaBackground },
  info: {
    position: 'absolute',
    left: 0,
    right: 80,
    bottom: 0,
    padding: theme.spacing.lg,
    gap: theme.spacing.xs,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  actions: {
    position: 'absolute',
    right: theme.spacing.sm,
    bottom: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  act: {
    minWidth: theme.minTouch,
    minHeight: theme.minTouch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.minTouch / 2,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: theme.spacing.sm,
  },
  actOn: { backgroundColor: theme.colors.primary },
});
