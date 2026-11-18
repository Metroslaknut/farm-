import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { FollowResult, PostDTO, UserProfileDTO } from '@farmplus/shared-types';
import { api } from '../../api';
import { Alert, Button, Card } from '../../components/ui';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { useDateFormat } from './localize';
import { PostCard } from './PostCard';
import { usePagedList } from './usePagedList';

/** `/community/users/:id` — public profile, follow button and the member's posts. */
export default function ProfilePage() {
  const t = useT('community');
  const { date } = useDateFormat();
  const { id = '' } = useParams();
  const profile = useAsync(
    (signal) => api.request<UserProfileDTO>('GET', `/users/${id}/profile`, { signal }),
    [id],
  );
  const feed = usePagedList<PostDTO>('/posts', { authorId: id, limit: 10 });
  const [follow, setFollow] = useState<FollowResult>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (profile.error) return <Alert tone="danger">{profile.error}</Alert>;
  const p = profile.data;
  if (!p) return <p role="status">{t('common.loading')}</p>;
  const following = follow?.following ?? p.isFollowing;
  const followers = follow?.followerCount ?? p.followerCount;

  const toggle = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setFollow(
        await api.request<FollowResult>(following ? 'DELETE' : 'POST', `/users/${p.id}/follow`),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p>
        <Link to="/community">{t('common.backToCommunity')}</Link>
      </p>
      <Card>
        <div className="ds-row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0 }}>{p.displayName}</h1>
            <p className="ds-field__hint">{t('profile.memberSince', { date: date(p.joinedAt) })}</p>
            <p>
              <strong>{p.postCount}</strong> {t('profile.publicPosts')} ·{' '}
              <strong>{followers}</strong> {t('profile.followers')} ·{' '}
              <strong>{p.followingCount}</strong> {t('profile.followingCount')}
            </p>
          </div>
          {!p.isSelf && (
            <Button
              variant={following ? 'secondary' : 'primary'}
              aria-pressed={following}
              loading={busy}
              onClick={() => void toggle()}
            >
              {following ? t('profile.following') : t('profile.follow')}
            </Button>
          )}
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
      </Card>
      <h2>{t('profile.posts')}</h2>
      {feed.items.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          onChange={feed.replaceItem}
          onRemoved={feed.removeItem}
        />
      ))}
      {feed.loading && <p role="status">{t('common.loading')}</p>}
      {feed.error && <Alert tone="danger">{feed.error}</Alert>}
      {!feed.loading && feed.items.length === 0 && <p>{t('profile.empty')}</p>}
      {feed.hasMore && !feed.loading && (
        <Button onClick={() => void feed.loadMore()}>{t('common.loadMore')}</Button>
      )}
    </>
  );
}
