import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { LiveDTO } from '@farmplus/shared-types';
import { Alert, Badge, Button, Card } from '../../components/ui';
import { useT } from '../../i18n';
import { usePagedList } from '../community/usePagedList';
import { pollWhileVisible } from '../../lib/poll';

/** `/live` — streams that are on air right now. Refreshes itself every 15 s. */
export default function LiveListPage() {
  const t = useT('live');
  const list = usePagedList<LiveDTO>('/live', { state: 'live', limit: 12 });
  const { reload } = list;
  useEffect(() => pollWhileVisible(() => void reload(), 15_000), [reload]);
  return (
    <>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <h1>{t('list.title')}</h1>
        <span className="ds-row">
          <Link to="/live/host" className="ds-btn ds-btn--primary">
            {t('common.goLive')}
          </Link>
          <Link to="/videos" className="ds-btn">
            {t('list.shortVideos')}
          </Link>
        </span>
      </div>
      {list.error && <Alert tone="danger">{list.error}</Alert>}
      <div className="ds-grid ds-grid--3">
        {list.items.map((l) => (
          <Card key={l.id} title={l.title} headingLevel={2}>
            <p>
              <Badge tone={l.state === 'live' ? 'danger' : 'warning'}>
                {l.state === 'live' ? t('common.live') : t('list.reconnecting')}
              </Badge>{' '}
              {l.access === 'followers' && <Badge>{t('list.followers')}</Badge>}
            </p>
            <p>
              {t('common.hostedBy')}{' '}
              <Link to={`/community/users/${l.host.id}`}>{l.host.displayName}</Link>
            </p>
            {l.description && <p className="ds-field__hint">{l.description}</p>}
            <Link to={`/live/${l.id}`} className="ds-btn ds-btn--primary">
              {t('list.watch')}
            </Link>
          </Card>
        ))}
      </div>
      {list.loading && <p role="status">{t('common.loading')}</p>}
      {!list.loading && !list.error && list.items.length === 0 && <p>{t('list.empty')}</p>}
      {list.hasMore && !list.loading && (
        <Button onClick={() => void list.loadMore()}>{t('common.loadMore')}</Button>
      )}
    </>
  );
}
