import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { POST_LIMITS, type CommentDTO, type ReactionResult } from '@farmplus/shared-types';
import {
  createCommentSchema,
  fieldErrorsFromDetails,
  fieldErrorsFromZod,
} from '@farmplus/validation';
import { api } from '../../api';
import { Alert, Button, DropdownMenu, Textarea } from '../../components/ui';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/format';
import { localizeValidation, useDateFormat } from './localize';
import { ReportDialog } from './ReportDialog';
import { usePagedList } from './usePagedList';

function CommentForm({
  resource = 'posts',
  postId,
  parentId,
  initial,
  label,
  submitLabel,
  onSaved,
  onCancel,
  edit,
}: {
  resource?: 'posts' | 'videos';
  postId: string;
  parentId?: string;
  initial?: string;
  label: string;
  submitLabel: string;
  onSaved: (comment: CommentDTO) => void;
  onCancel?: () => void;
  edit?: { id: string };
}) {
  const t = useT('community');
  const [body, setBody] = useState(initial ?? '');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const payload = { body: body.trim(), ...(parentId ? { parentId } : {}) };
    const parsed = createCommentSchema.safeParse(payload);
    if (!parsed.success) {
      const message = fieldErrorsFromZod(parsed.error)['body'];
      return setError(message ? localizeValidation(message) : t('comment.invalid'));
    }
    setBusy(true);
    setError(undefined);
    try {
      const res = edit
        ? await api.request<{ comment: CommentDTO }>('PATCH', `/comments/${edit.id}`, {
            body: { body: payload.body },
          })
        : await api.request<{ comment: CommentDTO }>('POST', `/${resource}/${postId}/comments`, {
            body: payload,
          });
      setBody('');
      onSaved(res.comment);
    } catch (e) {
      const mapped = fieldErrorsFromDetails(
        (e as { details?: { path: string; message: string }[] }).details,
      );
      setError(mapped['body'] ? localizeValidation(mapped['body']) : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} noValidate aria-label={label}>
      <Textarea
        label={label}
        rows={2}
        value={body}
        maxLength={POST_LIMITS.comment}
        onChange={(e) => setBody(e.target.value)}
        error={error}
      />
      <div className="ds-row">
        <Button type="submit" variant="primary" size="sm" loading={busy}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button size="sm" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}

function CommentItem({
  resource,
  comment,
  postId,
  open,
  onChange,
  onRemoved,
  canReply,
}: {
  resource: 'posts' | 'videos';
  comment: CommentDTO;
  postId: string;
  open: boolean;
  onChange: (c: CommentDTO) => void;
  onRemoved: (id: string) => void;
  canReply: boolean;
}) {
  const t = useT('community');
  const { dateTime } = useDateFormat();
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const [report, setReport] = useState(false);
  const [error, setError] = useState<string>();
  const [reported, setReported] = useState(false);
  const replies = usePagedList<CommentDTO>(
    `/${resource}/${postId}/comments`,
    { parentId: comment.id, limit: 10 },
    showReplies,
  );
  const placeholder = comment.status !== 'published';

  const like = async () => {
    const was = comment.viewer.reacted;
    onChange({
      ...comment,
      reactionCount: comment.reactionCount + (was ? -1 : 1),
      viewer: { ...comment.viewer, reacted: !was },
    });
    try {
      const res = await api.request<ReactionResult>(
        was ? 'DELETE' : 'POST',
        `/comments/${comment.id}/reactions`,
        was ? {} : { body: { type: 'like' } },
      );
      onChange({
        ...comment,
        reactionCount: res.reactionCount,
        viewer: { ...comment.viewer, reacted: res.reacted },
      });
    } catch (e) {
      onChange(comment);
      setError(errorMessage(e));
    }
  };
  const remove = async () => {
    try {
      await api.request('DELETE', `/comments/${comment.id}`);
      if (comment.replyCount > 0) onChange({ ...comment, status: 'deleted', body: '' });
      else onRemoved(comment.id);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <li id={`comment-${comment.id}`} style={{ marginBottom: 'var(--ds-space-3)' }}>
      {placeholder ? (
        <p className="ds-field__hint">
          <em>{t('comment.unavailable')}</em>
        </p>
      ) : (
        <>
          <p style={{ margin: 0 }}>
            <Link to={`/community/users/${comment.author.id}`}>
              <strong>{comment.author.displayName}</strong>
            </Link>{' '}
            <span className="ds-field__hint">
              {dateTime(comment.createdAt)}
              {comment.editedAt ? ` · ${t('common.edited')}` : ''}
            </span>
          </p>
          {editing ? (
            <CommentForm
              resource={resource}
              postId={postId}
              initial={comment.body}
              label={t('comment.edit')}
              submitLabel={t('common.save')}
              edit={{ id: comment.id }}
              onCancel={() => setEditing(false)}
              onSaved={(c) => {
                onChange(c);
                setEditing(false);
              }}
            />
          ) : (
            <p
              style={{
                margin: 'var(--ds-space-1) 0',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              {comment.body}
            </p>
          )}
          <div className="ds-row">
            <Button
              size="sm"
              variant={comment.viewer.reacted ? 'primary' : 'ghost'}
              aria-pressed={comment.viewer.reacted}
              onClick={() => void like()}
            >
              {comment.viewer.reacted ? t('common.liked') : t('common.like')} ·{' '}
              {comment.reactionCount}
            </Button>
            {canReply && open && (
              <Button size="sm" variant="ghost" onClick={() => setReplying((v) => !v)}>
                {t('comment.reply')}
              </Button>
            )}
            <DropdownMenu
              label={t('comment.actions')}
              align="end"
              items={
                comment.viewer.isAuthor
                  ? [
                      { id: 'edit', label: t('common.edit'), onSelect: () => setEditing(true) },
                      {
                        id: 'delete',
                        label: t('common.delete'),
                        tone: 'danger',
                        onSelect: () => void remove(),
                      },
                    ]
                  : [
                      {
                        id: 'report',
                        label: t('common.report'),
                        tone: 'danger',
                        onSelect: () => setReport(true),
                      },
                    ]
              }
            />
          </div>
        </>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {reported && <Alert tone="info">{t('common.reported')}</Alert>}

      {replying && (
        <CommentForm
          resource={resource}
          postId={postId}
          parentId={comment.id}
          label={t('comment.replyTo', { name: comment.author.displayName })}
          submitLabel={t('comment.reply')}
          onCancel={() => setReplying(false)}
          onSaved={(c) => {
            setReplying(false);
            setShowReplies(true);
            onChange({ ...comment, replyCount: comment.replyCount + 1 });
            replies.prepend(c);
            void replies.reload();
          }}
        />
      )}

      {comment.replyCount > 0 && !showReplies && (
        <Button size="sm" variant="ghost" onClick={() => setShowReplies(true)}>
          {t(comment.replyCount === 1 ? 'comment.showReplies.one' : 'comment.showReplies.other', {
            count: comment.replyCount,
          })}
        </Button>
      )}
      {showReplies && (
        <ul
          style={{
            listStyle: 'none',
            paddingLeft: 'var(--ds-space-5)',
            borderLeft: '2px solid var(--ds-border, #ddd)',
          }}
          aria-label={t('comment.replies')}
        >
          {replies.items.map((r) => (
            <CommentItem
              key={r.id}
              resource={resource}
              comment={r}
              postId={postId}
              open={open}
              canReply={false}
              onChange={replies.replaceItem}
              onRemoved={replies.removeItem}
            />
          ))}
          {replies.loading && <li role="status">{t('common.loading')}</li>}
          {replies.error && (
            <li>
              <Alert tone="danger">{replies.error}</Alert>
            </li>
          )}
          {replies.hasMore && !replies.loading && (
            <li>
              <Button size="sm" onClick={() => void replies.loadMore()}>
                {t('comment.moreReplies')}
              </Button>
            </li>
          )}
        </ul>
      )}
      <ReportDialog
        target={report ? { type: 'comment', id: comment.id } : null}
        onClose={() => setReport(false)}
        onReported={() => setReported(true)}
      />
    </li>
  );
}

/** Top-level comments (oldest first) with replies on demand and a composer. `open` is false when comments are closed. */
export function CommentThread({
  resource = 'posts',
  postId,
  open,
  onCountChange,
}: {
  /** `posts` (default) or `videos`: the thing the comments belong to. */
  resource?: 'posts' | 'videos';
  postId: string;
  open: boolean;
  onCountChange?: (delta: number) => void;
}) {
  const t = useT('community');
  const list = usePagedList<CommentDTO>(`/${resource}/${postId}/comments`, { limit: 10 });
  return (
    <section aria-label={t('comment.section')}>
      <h2>{t('comment.section')}</h2>
      {open ? (
        <CommentForm
          resource={resource}
          postId={postId}
          label={t('comment.add')}
          submitLabel={t('comment.submit')}
          onSaved={() => {
            onCountChange?.(1);
            void list.reload();
          }}
        />
      ) : (
        <Alert tone="info">{t('comment.closed')}</Alert>
      )}
      {list.error && <Alert tone="danger">{list.error}</Alert>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {list.items.map((c) => (
          <CommentItem
            key={c.id}
            resource={resource}
            comment={c}
            postId={postId}
            open={open}
            canReply
            onChange={list.replaceItem}
            onRemoved={(id) => {
              list.removeItem(id);
              onCountChange?.(-1);
            }}
          />
        ))}
      </ul>
      {list.loading && <p role="status">{t('common.loading')}</p>}
      {!list.loading && list.items.length === 0 && !list.error && <p>{t('comment.empty')}</p>}
      {list.hasMore && !list.loading && (
        <Button onClick={() => void list.loadMore()}>{t('comment.loadMore')}</Button>
      )}
    </section>
  );
}
