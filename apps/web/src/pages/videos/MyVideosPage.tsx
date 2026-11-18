import { useState } from 'react';
import { Link } from 'react-router-dom';
import { POST_VISIBILITIES, type PostVisibility, type VideoDTO } from '@farmplus/shared-types';
import { api } from '../../api';
import { Alert, Badge, Button, Card, Modal, Select, TextField } from '../../components/ui';
import { useLocale, useT } from '../../i18n';
import { errorMessage } from '../../lib/format';
import { usePagedList } from '../community/usePagedList';

const TONE = {
  pending_upload: 'warning',
  processing: 'info',
  ready: 'success',
  failed: 'danger',
} as const;
const VISIBILITY_LABEL = {
  public: 'visibility.public',
  followers: 'visibility.followers',
  private: 'visibility.private',
} as const satisfies Record<PostVisibility, string>;

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
  const [locale] = useLocale();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(video.title);
  const [visibility, setVisibility] = useState<PostVisibility>(video.visibility);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const state = video.processing.state;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ marginBottom: 'var(--ds-space-3)' }}>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <strong>{video.title}</strong>
        <span className="ds-row">
          <Badge tone={TONE[state]}>{t(`state.${state}`)}</Badge>
          {video.status !== 'published' && (
            <Badge tone="danger">{t(`status.${video.status}`)}</Badge>
          )}
          {video.visibility !== 'public' && <Badge>{t(VISIBILITY_LABEL[video.visibility])}</Badge>}
        </span>
      </div>
      {video.moderationNotice && <Alert tone="warning">{video.moderationNotice}</Alert>}
      {video.processing.failure && (
        <Alert tone="danger">
          {/* English shows the provider's own explanation; other languages a translation of its code. */}
          {locale === 'en'
            ? video.processing.failure.message
            : t(`failure.${video.processing.failure.code}`)}
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <p className="ds-field__hint">
        {t('mine.stats', {
          views: video.viewCount,
          likes: video.reactionCount,
          comments: video.commentCount,
        })}
        {video.durationSeconds
          ? ` · ${t('mine.duration', { seconds: Math.round(video.durationSeconds) })}`
          : ''}
      </p>
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const res = await api.request<{ video: VideoDTO }>('PATCH', `/videos/${video.id}`, {
                body: { title: title.trim(), visibility },
              });
              onChange(res.video);
              setEditing(false);
            });
          }}
        >
          <TextField
            label={t('common.title')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
          />
          <Select
            label={t('common.whoCanWatch')}
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as PostVisibility)}
          >
            {POST_VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {t(VISIBILITY_LABEL[v])}
              </option>
            ))}
          </Select>
          <div className="ds-row">
            <Button type="submit" variant="primary" loading={busy}>
              {t('common.save')}
            </Button>
            <Button onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
          </div>
        </form>
      ) : (
        <div className="ds-row">
          {state === 'ready' && video.status === 'published' && (
            <Link to={`/videos/watch/${video.id}`} className="ds-btn ds-btn--primary">
              {t('common.watch')}
            </Link>
          )}
          {(state === 'pending_upload' || state === 'processing') && (
            <Button
              loading={busy}
              onClick={() =>
                void run(async () =>
                  onChange(
                    (await api.request<{ video: VideoDTO }>('POST', `/videos/${video.id}/refresh`))
                      .video,
                  ),
                )
              }
            >
              {t('mine.checkStatus')}
            </Button>
          )}
          {video.status === 'published' && (
            <Button onClick={() => setEditing(true)}>{t('common.edit')}</Button>
          )}
          <Button variant="danger" onClick={() => setConfirm(true)}>
            {t('common.delete')}
          </Button>
        </div>
      )}
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t('mine.deleteTitle')}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  await api.request('DELETE', `/videos/${video.id}`);
                  setConfirm(false);
                  onRemoved(video.id);
                })
              }
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p>{t('mine.deleteBody')}</p>
      </Modal>
    </Card>
  );
}

/** `/videos/mine` — your uploads with their processing status (also videos that are still processing or failed). */
export default function MyVideosPage() {
  const t = useT('videos');
  const list = usePagedList<VideoDTO>('/videos', { mine: 'true', limit: 20 });
  return (
    <>
      <p>
        <Link to="/videos">{t('common.backToVideos')}</Link>
      </p>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <h1>{t('common.myVideos')}</h1>
        <Link to="/videos/upload" className="ds-btn ds-btn--primary">
          {t('common.upload')}
        </Link>
      </div>
      {list.error && <Alert tone="danger">{list.error}</Alert>}
      {list.items.map((v) => (
        <Row key={v.id} video={v} onChange={list.replaceItem} onRemoved={list.removeItem} />
      ))}
      {list.loading && <p role="status">{t('common.loading')}</p>}
      {!list.loading && !list.error && list.items.length === 0 && <p>{t('mine.empty')}</p>}
      {list.hasMore && !list.loading && (
        <Button onClick={() => void list.loadMore()}>{t('common.loadMore')}</Button>
      )}
    </>
  );
}
