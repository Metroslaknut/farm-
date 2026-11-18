import { useState } from 'react';
import {
  FEED_SCOPES,
  FEED_SORTS,
  type FeedScope,
  type FeedSort,
  type PostDTO,
} from '@farmplus/shared-types';
import { api } from '../../api';
import { Alert, Button, Card, Select } from '../../components/ui';
import { useT } from '../../i18n';
import { PostCard } from './PostCard';
import { PostComposer } from './PostComposer';
import { usePagedList } from './usePagedList';

const SCOPE_LABEL = {
  all: 'feed.scope.all',
  following: 'feed.scope.following',
} as const satisfies Record<FeedScope, string>;
const SORT_LABEL = {
  recent: 'feed.sort.recent',
  trending: 'feed.sort.trending',
} as const satisfies Record<FeedSort, string>;

/** `/community`: composer + paginated feed. */
export default function FeedPage() {
  const t = useT('community');
  const [scope, setScope] = useState<FeedScope>('all');
  const [sort, setSort] = useState<FeedSort>('recent');
  const feed = usePagedList<PostDTO>('/posts', { scope, sort, limit: 10 });

  return (
    <>
      <h1>{t('feed.title')}</h1>
      <Card style={{ marginBottom: 'var(--ds-space-4)' }}>
        <PostComposer
          submitLabel={t('feed.post')}
          onSubmit={async (value) => {
            const res = await api.request<{ post: PostDTO }>('POST', '/posts', { body: value });
            // Show it right away on the “Everyone/Newest” feed; other views pick it up on their next load.
            if (sort === 'recent') feed.prepend(res.post);
          }}
        />
      </Card>

      <div className="ds-row" style={{ marginBottom: 'var(--ds-space-3)' }}>
        <Select
          label={t('feed.show')}
          value={scope}
          onChange={(e) => setScope(e.target.value as FeedScope)}
        >
          {FEED_SCOPES.map((s) => (
            <option key={s} value={s}>
              {t(SCOPE_LABEL[s])}
            </option>
          ))}
        </Select>
        <Select
          label={t('feed.order')}
          value={sort}
          onChange={(e) => setSort(e.target.value as FeedSort)}
        >
          {FEED_SORTS.map((s) => (
            <option key={s} value={s}>
              {t(SORT_LABEL[s])}
            </option>
          ))}
        </Select>
      </div>

      {feed.error && (
        <Alert tone="danger">
          {feed.error}{' '}
          <button type="button" onClick={() => void feed.reload()}>
            {t('common.tryAgain')}
          </button>
        </Alert>
      )}
      <div aria-live="polite">
        {feed.items.map((p) => (
          <PostCard key={p.id} post={p} onChange={feed.replaceItem} onRemoved={feed.removeItem} />
        ))}
      </div>
      {feed.loading && <p role="status">{t('common.loading')}</p>}
      {!feed.loading && !feed.error && feed.items.length === 0 && (
        <p>{scope === 'following' ? t('feed.emptyFollowing') : t('feed.empty')}</p>
      )}
      {feed.hasMore && !feed.loading && (
        <Button onClick={() => void feed.loadMore()}>{t('common.loadMore')}</Button>
      )}
    </>
  );
}
