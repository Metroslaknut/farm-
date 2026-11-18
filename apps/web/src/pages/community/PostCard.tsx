import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { PostDTO, ReactionResult } from '@farmplus/shared-types';
import { api } from '../../api';
import { Alert, Badge, Button, Card, DropdownMenu, Modal } from '../../components/ui';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/format';
import { useDateFormat } from './localize';
import { MediaGrid } from './MediaViewer';
import { PostComposer } from './PostComposer';
import { ReportDialog } from './ReportDialog';

const VISIBILITY_LABEL = {
  public: 'visibility.public',
  followers: 'visibility.followers',
  private: 'visibility.private',
} as const;

/** One feed card: author, text, media, like, comment link and the actions the viewer may take. */
export function PostCard({
  post,
  onChange,
  onRemoved,
  detail = false,
}: {
  post: PostDTO;
  onChange: (post: PostDTO) => void;
  onRemoved: (id: string) => void;
  detail?: boolean;
}) {
  const t = useT('community');
  const { dateTime } = useDateFormat();
  const plural = (n: number) =>
    t(n === 1 ? 'post.commentCount.one' : 'post.commentCount.other', { count: n });
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [report, setReport] = useState(false);
  const [reported, setReported] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const toggleLike = async () => {
    const was = post.viewer.reacted;
    // optimistic update, rolled back if the API refuses
    onChange({
      ...post,
      reactionCount: post.reactionCount + (was ? -1 : 1),
      viewer: { ...post.viewer, reacted: !was },
    });
    setError(undefined);
    try {
      const res = await api.request<ReactionResult>(
        was ? 'DELETE' : 'POST',
        `/posts/${post.id}/reactions`,
        was ? {} : { body: { type: 'like' } },
      );
      onChange({
        ...post,
        reactionCount: res.reactionCount,
        viewer: { ...post.viewer, reacted: res.reacted },
      });
    } catch (e) {
      onChange(post);
      setError(errorMessage(e));
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.request('DELETE', `/posts/${post.id}`);
      setConfirmDelete(false);
      onRemoved(post.id);
    } catch (e) {
      setError(errorMessage(e));
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  };

  const menu = post.viewer.isAuthor
    ? [
        {
          id: 'edit',
          label: t('common.edit'),
          onSelect: () => setEditing(true),
          disabled: post.status !== 'published',
        },
        {
          id: 'delete',
          label: t('common.delete'),
          tone: 'danger' as const,
          onSelect: () => setConfirmDelete(true),
        },
      ]
    : [
        {
          id: 'report',
          label: t('common.report'),
          tone: 'danger' as const,
          onSelect: () => setReport(true),
        },
      ];

  return (
    <Card style={{ marginBottom: 'var(--ds-space-4)' }}>
      <article aria-label={t('post.aria', { name: post.author.displayName })}>
        <header className="ds-row" style={{ justifyContent: 'space-between' }}>
          <span>
            <Link to={`/community/users/${post.author.id}`}>
              <strong>{post.author.displayName}</strong>
            </Link>{' '}
            <Link to={`/community/posts/${post.id}`} className="ds-field__hint">
              {dateTime(post.createdAt)}
            </Link>
            {post.editedAt && <span className="ds-field__hint"> · {t('common.edited')}</span>}{' '}
            {post.visibility !== 'public' && <Badge>{t(VISIBILITY_LABEL[post.visibility])}</Badge>}
          </span>
          <DropdownMenu label={t('post.actions')} items={menu} align="end" />
        </header>

        {post.moderationNotice && <Alert tone="warning">{post.moderationNotice}</Alert>}
        {reported && <Alert tone="info">{t('common.reported')}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}

        {editing ? (
          <PostComposer
            initial={{ body: post.body, media: post.media, visibility: post.visibility }}
            submitLabel={t('post.saveChanges')}
            onCancel={() => setEditing(false)}
            onSubmit={async (value) => {
              const res = await api.request<{ post: PostDTO }>('PATCH', `/posts/${post.id}`, {
                body: value,
              });
              onChange(res.post);
              setEditing(false);
            }}
          />
        ) : (
          <>
            {post.body && (
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{post.body}</p>
            )}
            <MediaGrid media={post.media} />
          </>
        )}

        <footer className="ds-row">
          <Button
            size="sm"
            aria-pressed={post.viewer.reacted}
            disabled={post.status !== 'published'}
            onClick={() => void toggleLike()}
            variant={post.viewer.reacted ? 'primary' : 'secondary'}
          >
            {post.viewer.reacted ? t('common.liked') : t('common.like')} · {post.reactionCount}
          </Button>
          {detail ? (
            <span>{plural(post.commentCount)}</span>
          ) : (
            <Link to={`/community/posts/${post.id}`}>{plural(post.commentCount)}</Link>
          )}
        </footer>
      </article>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t('post.deleteTitle')}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" loading={busy} onClick={() => void remove()}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p>{t('post.deleteBody')}</p>
      </Modal>
      <ReportDialog
        target={report ? { type: 'post', id: post.id } : null}
        onClose={() => setReport(false)}
        onReported={() => setReported(true)}
      />
    </Card>
  );
}
