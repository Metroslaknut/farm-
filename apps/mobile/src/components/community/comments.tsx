import { formatDate } from '@farmplus/i18n';
import type { CommentDTO, CursorPage, ReactionResult } from '@farmplus/shared-types';
import { createCommentSchema } from '@farmplus/validation';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { ReportModal } from '@/components/community/ReportModal';
import { Button, StateView, Text, TextField } from '@/components/ui';
import { useCursorList } from '@/hooks/useCursorList';
import { useLocale, useT } from '@/i18n';
import { communityValidationText, optimisticReaction, settleReaction } from '@/lib/community';
import { confirmAction } from '@/lib/confirm';
import { errorText } from '@/lib/messages';
import { theme } from '@/theme';

/** Which collection the comments belong to: `posts` or `videos`. */
export type CommentResource = 'posts' | 'videos';

export function CommentForm({
  resource = 'posts',
  postId,
  parentId,
  initial,
  label,
  editId,
  onSaved,
  onCancel,
}: {
  resource?: CommentResource;
  postId: string;
  parentId?: string;
  initial?: string;
  label: string;
  editId?: string;
  onSaved: (c: CommentDTO) => void;
  onCancel?: () => void;
}) {
  const t = useT('community');
  const [body, setBody] = useState(initial ?? '');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const payload = { body: body.trim(), ...(parentId ? { parentId } : {}) };
    const parsed = createCommentSchema.safeParse(payload);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message;
      return setError(message ? communityValidationText(message) : t('comment.invalid'));
    }
    setBusy(true);
    setError(undefined);
    try {
      const res = editId
        ? await api.request<{ comment: CommentDTO }>('PATCH', `/comments/${editId}`, {
            body: { body: payload.body },
          })
        : await api.request<{ comment: CommentDTO }>('POST', `/${resource}/${postId}/comments`, {
            body: payload,
          });
      setBody('');
      onSaved(res.comment);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.form}>
      <TextField
        label={label}
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={1000}
        error={error}
      />
      <View style={styles.row}>
        <Button
          title={editId ? t('comment.save') : parentId ? t('comment.reply') : t('comment.submit')}
          loading={busy}
          onPress={() => void submit()}
        />
        {onCancel ? (
          <Button title={t('comment.cancel')} variant="secondary" onPress={onCancel} />
        ) : null}
      </View>
    </View>
  );
}

export function CommentRow({
  resource = 'posts',
  comment,
  postId,
  open,
  canReply,
  onChange,
  onRemoved,
}: {
  resource?: CommentResource;
  comment: CommentDTO;
  postId: string;
  open: boolean;
  canReply: boolean;
  onChange: (c: CommentDTO) => void;
  onRemoved: (id: string) => void;
}) {
  const router = useRouter();
  const t = useT('community');
  const [locale] = useLocale();
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const [report, setReport] = useState(false);
  const [error, setError] = useState<string>();
  const replies = useCursorList<CommentDTO>(
    (cursor, signal) =>
      showReplies
        ? api.request<CursorPage<CommentDTO>>('GET', `/${resource}/${postId}/comments`, {
            query: { parentId: comment.id, limit: 10, ...(cursor ? { cursor } : {}) },
            signal,
          })
        : Promise.resolve({ items: [] }),
    [showReplies, comment.id],
  );

  const like = async () => {
    const was = comment.viewer.reacted;
    onChange(optimisticReaction(comment));
    try {
      const res = await api.request<ReactionResult>(
        was ? 'DELETE' : 'POST',
        `/comments/${comment.id}/reactions`,
        was ? {} : { body: { type: 'like' } },
      );
      onChange(settleReaction(comment, res));
    } catch (e) {
      onChange(comment);
      setError(errorText(e));
    }
  };
  const remove = async () => {
    if (
      !(await confirmAction(
        t('comment.deleteTitle'),
        t('comment.deleteMessage'),
        t('comment.delete'),
      ))
    )
      return;
    try {
      await api.request('DELETE', `/comments/${comment.id}`);
      if (comment.replyCount > 0) onChange({ ...comment, status: 'deleted', body: '' });
      else onRemoved(comment.id);
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (comment.status !== 'published')
    return (
      <Text muted style={styles.indent}>
        {t('comment.unavailable')}
      </Text>
    );
  return (
    <View style={styles.comment}>
      <View style={styles.row}>
        <Text
          variant="label"
          onPress={() => router.push(`/community/user/${comment.author.id}`)}
          accessibilityRole="link"
        >
          {comment.author.displayName}
        </Text>
        <Text variant="caption" muted>
          {formatDate(comment.createdAt, locale)}
          {comment.editedAt ? t('comment.edited') : ''}
        </Text>
      </View>
      {editing ? (
        <CommentForm
          resource={resource}
          postId={postId}
          initial={comment.body}
          label={t('comment.editLabel')}
          editId={comment.id}
          onCancel={() => setEditing(false)}
          onSaved={(c) => {
            onChange(c);
            setEditing(false);
          }}
        />
      ) : (
        <Text selectable>{comment.body}</Text>
      )}
      {error ? <Text color={theme.colors.error.fg}>{error}</Text> : null}
      <View style={styles.row}>
        <Button
          title={t(comment.viewer.reacted ? 'comment.liked' : 'comment.like', {
            count: comment.reactionCount,
          })}
          variant="ghost"
          onPress={() => void like()}
        />
        {canReply && open ? (
          <Button
            title={t('comment.reply')}
            variant="ghost"
            onPress={() => setReplying((v) => !v)}
          />
        ) : null}
        {comment.viewer.isAuthor ? (
          <>
            <Button title={t('comment.edit')} variant="ghost" onPress={() => setEditing(true)} />
            <Button title={t('comment.delete')} variant="ghost" onPress={() => void remove()} />
          </>
        ) : (
          <Button title={t('comment.report')} variant="ghost" onPress={() => setReport(true)} />
        )}
      </View>
      {replying ? (
        <CommentForm
          resource={resource}
          postId={postId}
          parentId={comment.id}
          label={t('comment.replyTo', { name: comment.author.displayName })}
          onCancel={() => setReplying(false)}
          onSaved={() => {
            setReplying(false);
            setShowReplies(true);
            onChange({ ...comment, replyCount: comment.replyCount + 1 });
            replies.reload();
          }}
        />
      ) : null}
      {comment.replyCount > 0 && !showReplies ? (
        <Button
          title={t(comment.replyCount === 1 ? 'comment.showReplyOne' : 'comment.showReplyMany', {
            count: comment.replyCount,
          })}
          variant="ghost"
          onPress={() => setShowReplies(true)}
        />
      ) : null}
      {showReplies ? (
        <View style={styles.indent}>
          {replies.items.map((r) => (
            <CommentRow
              resource={resource}
              key={r.id}
              comment={r}
              postId={postId}
              open={open}
              canReply={false}
              onChange={replies.replaceItem}
              onRemoved={replies.removeItem}
            />
          ))}
          {replies.loading ? <StateView kind="loading" /> : null}
          {replies.hasMore && !replies.loading ? (
            <Button title={t('comment.moreReplies')} variant="ghost" onPress={replies.loadMore} />
          ) : null}
        </View>
      ) : null}
      <ReportModal
        target={report ? { type: 'comment', id: comment.id } : null}
        onClose={() => setReport(false)}
        onReported={() => setError(undefined)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' },
  form: { gap: theme.spacing.sm },
  comment: {
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  indent: { marginLeft: theme.spacing.lg, gap: theme.spacing.sm },
});
