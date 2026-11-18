import { formatDate } from '@farmplus/i18n';
import type { PostDTO, ReactionResult } from '@farmplus/shared-types';
import { humanize } from '@farmplus/shared-utils';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { Button, Card, StatusBadge, Text } from '@/components/ui';
import { useLocale, useT } from '@/i18n';
import { optimisticReaction, settleReaction } from '@/lib/community';
import { confirmAction } from '@/lib/confirm';
import { errorText } from '@/lib/messages';
import { theme } from '@/theme';
import { MediaStrip } from './MediaViewer';
import { ReportModal } from './ReportModal';

/** A feed card. Likes are optimistic and rolled back if the API refuses. */
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
  const router = useRouter();
  const t = useT('community');
  const [locale] = useLocale();
  const [report, setReport] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const like = async () => {
    const was = post.viewer.reacted;
    onChange(optimisticReaction(post));
    setError(undefined);
    try {
      const res = await api.request<ReactionResult>(
        was ? 'DELETE' : 'POST',
        `/posts/${post.id}/reactions`,
        was ? {} : { body: { type: 'like' } },
      );
      onChange(settleReaction(post, res));
    } catch (e) {
      onChange(post);
      setError(errorText(e));
    }
  };

  const remove = async () => {
    if (!(await confirmAction(t('post.deleteTitle'), t('post.deleteMessage'), t('post.delete'))))
      return;
    try {
      await api.request('DELETE', `/posts/${post.id}`);
      onRemoved(post.id);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const open = () => !detail && router.push(`/community/${post.id}`);
  return (
    <Card accessibilityLabel={t('post.a11y', { name: post.author.displayName })}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t('post.openProfile', { name: post.author.displayName })}
          onPress={() => router.push(`/community/user/${post.author.id}`)}
        >
          <Text variant="label">{post.author.displayName}</Text>
        </Pressable>
        <Text variant="caption" muted>
          {formatDate(post.createdAt, locale)}
          {post.editedAt ? t('post.edited') : ''}
        </Text>
        {post.visibility !== 'public' ? (
          <StatusBadge
            tone="neutral"
            label={
              post.visibility === 'followers' || post.visibility === 'private'
                ? t(`badge.${post.visibility}`)
                : humanize(post.visibility)
            }
          />
        ) : null}
      </View>
      {post.moderationNotice ? (
        <Text color={theme.colors.warning.fg}>{post.moderationNotice}</Text>
      ) : null}
      {notice ? <Text color={theme.colors.success.fg}>{notice}</Text> : null}
      {error ? <Text color={theme.colors.error.fg}>{error}</Text> : null}
      {post.body ? (
        <Pressable
          onPress={open}
          accessibilityRole={detail ? 'text' : 'button'}
          accessibilityLabel={detail ? undefined : t('post.open')}
        >
          <Text selectable={detail}>{post.body}</Text>
        </Pressable>
      ) : null}
      <MediaStrip media={post.media} />
      <View style={styles.row}>
        <Button
          title={t(post.viewer.reacted ? 'post.liked' : 'post.like', { count: post.reactionCount })}
          variant={post.viewer.reacted ? 'primary' : 'secondary'}
          disabled={post.status !== 'published'}
          accessibilityLabel={t(post.viewer.reacted ? 'post.unlikeA11y' : 'post.likeA11y', {
            count: post.reactionCount,
          })}
          onPress={() => void like()}
        />
        {!detail && (
          <Button
            title={t(post.commentCount === 1 ? 'post.commentOne' : 'post.commentMany', {
              count: post.commentCount,
            })}
            variant="ghost"
            onPress={open}
          />
        )}
        {post.viewer.isAuthor ? (
          <Button title={t('post.delete')} variant="ghost" onPress={() => void remove()} />
        ) : (
          <Button title={t('post.report')} variant="ghost" onPress={() => setReport(true)} />
        )}
      </View>
      <ReportModal
        target={report ? { type: 'post', id: post.id } : null}
        onClose={() => setReport(false)}
        onReported={() => setNotice(t('post.reported'))}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' },
});
