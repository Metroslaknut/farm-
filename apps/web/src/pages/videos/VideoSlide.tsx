import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { PlaybackInfo, ReactionResult, VideoDTO, ViewResult } from '@farmplus/shared-types';
import { api } from '../../api';
import { Modal } from '../../components/ui';
import { useT } from '../../i18n';
import { CommentThread } from '../community/CommentThread';
import { ReportDialog } from '../community/ReportDialog';
import { Player } from './Player';

interface Props {
  video: VideoDTO;
  index: number;
  /** A <video> element exists for this slide (active ± 1). */
  mounted: boolean;
  active: boolean;
  prefetch: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onChange: (video: VideoDTO) => void;
}

/** One full-height slide: the player, creator/title overlay and like / comment / report actions. */
export function VideoSlide({
  video,
  index,
  mounted,
  active,
  prefetch,
  muted,
  onToggleMute,
  onChange,
}: Props) {
  const t = useT('videos');
  const [comments, setComments] = useState(false);
  const [report, setReport] = useState(false);
  const [notice, setNotice] = useState<'slide.likeError' | 'common.reported'>();

  const like = async () => {
    const was = video.viewer.reacted;
    onChange({
      ...video,
      reactionCount: Math.max(0, video.reactionCount + (was ? -1 : 1)),
      viewer: { ...video.viewer, reacted: !was },
    });
    try {
      const res = await api.request<ReactionResult>(
        was ? 'DELETE' : 'POST',
        `/videos/${video.id}/reactions`,
        was ? {} : { body: { type: 'like' } },
      );
      onChange({
        ...video,
        reactionCount: res.reactionCount,
        viewer: { ...video.viewer, reacted: res.reacted },
      });
    } catch {
      onChange(video);
      setNotice('slide.likeError');
    }
  };

  const onWatched = (watchedSeconds: number) => {
    api
      .request<ViewResult>('POST', `/videos/${video.id}/views`, { body: { watchedSeconds } })
      .then((r) => r.counted && onChange({ ...video, viewCount: r.viewCount }))
      .catch(() => undefined); // view tracking is best effort and must never disturb playback
  };

  return (
    <section
      className="vf-slide"
      data-index={index}
      aria-roledescription="slide"
      aria-label={t('slide.aria', { title: video.title, name: video.creator.displayName })}
    >
      {mounted ? (
        <Player
          label={video.title}
          active={active}
          preload={prefetch}
          muted={muted}
          onToggleMute={onToggleMute}
          fetchPlayback={() => api.request<PlaybackInfo>('GET', `/videos/${video.id}/playback`)}
          onWatched={onWatched}
        />
      ) : (
        <p className="vf-placeholder">{video.title}</p>
      )}
      <div className="vf-info">
        <p style={{ margin: 0 }}>
          <Link to={`/community/users/${video.creator.id}`}>
            <strong>@{video.creator.displayName}</strong>
          </Link>{' '}
          · <Link to={`/videos?creator=${video.creator.id}`}>{t('slide.moreVideos')}</Link>
        </p>
        <h2 style={{ margin: '0.25rem 0', fontSize: '1.1rem' }}>{video.title}</h2>
        {video.caption && <p style={{ margin: 0 }}>{video.caption}</p>}
        <p className="ds-field__hint" style={{ margin: 0, color: '#ddd' }}>
          {t(video.viewCount === 1 ? 'slide.views.one' : 'slide.views.other', {
            count: video.viewCount,
          })}
        </p>
        {notice && <p role="alert">{t(notice)}</p>}
      </div>
      <div className="vf-actions">
        <button
          type="button"
          className="vf-act"
          aria-pressed={video.viewer.reacted}
          aria-label={t(video.viewer.reacted ? 'slide.unlike' : 'slide.like', {
            count: video.reactionCount,
          })}
          onClick={() => void like()}
        >
          <span aria-hidden="true">♥</span>
          {video.reactionCount}
        </button>
        <button
          type="button"
          className="vf-act"
          aria-label={t('slide.comments', { count: video.commentCount })}
          onClick={() => setComments(true)}
        >
          <span aria-hidden="true">💬</span>
          {video.commentCount}
        </button>
        {!video.viewer.isCreator && (
          <button
            type="button"
            className="vf-act"
            aria-label={t('slide.report')}
            onClick={() => setReport(true)}
          >
            <span aria-hidden="true">⚑</span>
          </button>
        )}
      </div>
      <Modal
        open={comments}
        onClose={() => setComments(false)}
        title={t('slide.commentsTitle', { title: video.title })}
      >
        {comments && (
          <CommentThread
            resource="videos"
            postId={video.id}
            open
            onCountChange={(d) =>
              onChange({ ...video, commentCount: Math.max(0, video.commentCount + d) })
            }
          />
        )}
      </Modal>
      <ReportDialog
        target={report ? { type: 'video', id: video.id } : null}
        onClose={() => setReport(false)}
        onReported={() => setNotice('common.reported')}
      />
    </section>
  );
}
