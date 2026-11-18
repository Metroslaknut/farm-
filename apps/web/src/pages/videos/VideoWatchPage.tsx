import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { PlaybackInfo, VideoDTO } from '@farmplus/shared-types';
import { api } from '../../api';
import { Alert } from '../../components/ui';
import { useT } from '../../i18n';
import { useAsync } from '../../lib/useAsync';
import { CommentThread } from '../community/CommentThread';
import { Player } from './Player';
import './videos.css';

/** `/videos/watch/:id` — one video with its comments (deep link from My videos / upload). */
export default function VideoWatchPage() {
  const t = useT('videos');
  const { id = '' } = useParams();
  const { data, error, loading } = useAsync(
    (signal) => api.request<{ video: VideoDTO }>('GET', `/videos/${id}`, { signal }),
    [id],
  );
  const [muted, setMuted] = useState(false);
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (loading && !data) return <p role="status">{t('common.loading')}</p>;
  const v = data?.video;
  if (!v) return null;
  const playable = v.processing.state === 'ready';
  return (
    <>
      <p>
        <Link to="/videos">{t('common.backToVideos')}</Link>
      </p>
      <h1>{v.title}</h1>
      <p>
        {t('watch.by')} <Link to={`/community/users/${v.creator.id}`}>{v.creator.displayName}</Link>{' '}
        · {t('watch.views', { count: v.viewCount })}
      </p>
      {v.moderationNotice && <Alert tone="warning">{v.moderationNotice}</Alert>}
      {playable ? (
        <div style={{ height: '60vh', background: '#000', borderRadius: 12, overflow: 'hidden' }}>
          <Player
            label={v.title}
            active
            muted={muted}
            onToggleMute={() => setMuted((m) => !m)}
            fetchPlayback={() => api.request<PlaybackInfo>('GET', `/videos/${v.id}/playback`)}
            onWatched={(watchedSeconds) =>
              void api
                .request('POST', `/videos/${v.id}/views`, { body: { watchedSeconds } })
                .catch(() => undefined)
            }
          />
        </div>
      ) : (
        <Alert tone="info">
          {t('watch.notPlayable', { state: t(`watch.state.${v.processing.state}`) })}
        </Alert>
      )}
      {v.caption && <p>{v.caption}</p>}
      <CommentThread resource="videos" postId={v.id} open={playable && v.status === 'published'} />
    </>
  );
}
