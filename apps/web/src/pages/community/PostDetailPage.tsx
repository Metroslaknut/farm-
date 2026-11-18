import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { PostDTO } from '@farmplus/shared-types';
import { api } from '../../api';
import { Alert } from '../../components/ui';
import { useT } from '../../i18n';
import { useAsync } from '../../lib/useAsync';
import { CommentThread } from './CommentThread';
import { PostCard } from './PostCard';

/** `/community/posts/:id` — a post with its comment thread. A post the viewer may not see is a plain "not found". */
export default function PostDetailPage() {
  const t = useT('community');
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data, error, loading } = useAsync(
    (signal) => api.request<{ post: PostDTO }>('GET', `/posts/${id}`, { signal }),
    [id],
  );
  const [override, setOverride] = useState<PostDTO>();
  const post = override?.id === id ? override : data?.post;

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (loading && !post) return <p role="status">{t('common.loading')}</p>;
  if (!post) return null;
  return (
    <>
      <p>
        <Link to="/community">{t('common.backToCommunity')}</Link>
      </p>
      <PostCard
        post={post}
        detail
        onChange={setOverride}
        onRemoved={() => navigate('/community')}
      />
      <CommentThread
        postId={post.id}
        open={post.status === 'published'}
        onCountChange={(d) =>
          setOverride({ ...post, commentCount: Math.max(0, post.commentCount + d) })
        }
      />
    </>
  );
}
