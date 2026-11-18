import type { PlaybackInfo, VideoDTO } from '@farmplus/shared-types';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { Screen, StateView, Text } from '@/components/ui';
import { CommentsSheet } from '@/components/video/CommentsSheet';
import { MobilePlayer } from '@/components/video/MobilePlayer';
import { useAsync } from '@/hooks/useAsync';
import { useT } from '@/i18n';
import { processingStateInline } from '@/lib/pickedVideo';
import { Button } from '@/components/ui';

function Watch() {
  const t = useT('videos');
  const { id } = useLocalSearchParams<{ id: string }>();
  const [muted, setMuted] = useState(false);
  const [comments, setComments] = useState(false);
  const video = useAsync(
    (signal) => api.request<{ video: VideoDTO }>('GET', `/videos/${id}`, { signal }),
    [id],
  );
  const [extra, setExtra] = useState(0);
  if (video.error) return <StateView kind="error" error={video.error} onRetry={video.reload} />;
  if (!video.data) return <StateView kind="loading" label={t('watch.loading')} />;
  const v = video.data.video;
  const ready = v.processing.state === 'ready';
  return (
    <Screen>
      <Text variant="heading">{v.title}</Text>
      <Text muted>{t('watch.byline', { name: v.creator.displayName, views: v.viewCount })}</Text>
      {v.moderationNotice ? <Text>{v.moderationNotice}</Text> : null}
      {ready ? (
        <View style={{ height: 420 }}>
          <MobilePlayer
            label={v.title}
            active
            muted={muted}
            onToggleMute={() => setMuted((m) => !m)}
            fetchPlayback={() => api.request<PlaybackInfo>('GET', `/videos/${v.id}/playback`)}
            onWatched={(s) =>
              void api
                .request('POST', `/videos/${v.id}/views`, { body: { watchedSeconds: s } })
                .catch(() => undefined)
            }
          />
        </View>
      ) : (
        <Text muted>
          {t('watch.notPlayable', { state: processingStateInline(v.processing.state) })}
        </Text>
      )}
      {v.caption ? <Text>{v.caption}</Text> : null}
      <Button
        title={t('watch.comments', { count: v.commentCount + extra })}
        variant="secondary"
        onPress={() => setComments(true)}
      />
      <CommentsSheet
        videoId={v.id}
        visible={comments}
        onClose={() => setComments(false)}
        onCountChange={(d) => setExtra((n) => n + d)}
      />
    </Screen>
  );
}

export default function VideoScreen() {
  return (
    <RequireAuth>
      <Watch />
    </RequireAuth>
  );
}
