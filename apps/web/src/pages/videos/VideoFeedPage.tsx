import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { VideoDTO } from '@farmplus/shared-types';
import { Alert, Button, Select } from '../../components/ui';
import { useT } from '../../i18n';
import { usePagedList } from '../community/usePagedList';
import { VideoSlide } from './VideoSlide';
import { clampIndex, shouldLoadMore, slideWindow } from './videoFeed';
import './videos.css';

/** `/videos` — vertical, swipe/scroll-snap feed. Only the active slide plays; its neighbours are preloaded. */
export default function VideoFeedPage() {
  const t = useT('videos');
  const [search, setSearch] = useSearchParams();
  const creator = search.get('creator') ?? undefined;
  const [scope, setScope] = useState<'all' | 'following'>('all');
  const feed = usePagedList<VideoDTO>('/videos', {
    limit: 6,
    scope,
    ...(creator ? { creatorId: creator } : {}),
  });
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true); // browsers only autoplay muted video
  const root = useRef<HTMLDivElement>(null);
  const count = feed.items.length;
  const win = slideWindow(active, count);

  // Which slide fills the viewport? (one observer for the whole feed)
  useEffect(() => {
    const el = root.current;
    if (!el || count === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting && e.intersectionRatio >= 0.6)
            setActive(Number((e.target as HTMLElement).dataset['index']));
      },
      { root: el, threshold: [0.6] },
    );
    el.querySelectorAll('[data-index]').forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [count]);

  useEffect(() => {
    if (shouldLoadMore(active, count, feed.hasMore && !feed.loading)) void feed.loadMore();
  }, [active, count, feed]);

  const goTo = useCallback((i: number) => {
    const el = root.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>(
      `[data-index="${clampIndex(i, el.querySelectorAll('[data-index]').length)}"]`,
    );
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, []);

  const onKey = (e: KeyboardEvent) => {
    if (['ArrowDown', 'PageDown', 'j'].includes(e.key)) {
      e.preventDefault();
      goTo(active + 1);
    } else if (['ArrowUp', 'PageUp', 'k'].includes(e.key)) {
      e.preventDefault();
      goTo(active - 1);
    } else if (e.key === 'm') setMuted((m) => !m);
  };

  return (
    <>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <h1>{creator ? t('feed.titleCreator') : t('feed.title')}</h1>
        <span className="ds-row">
          {creator ? (
            <Button onClick={() => setSearch({})}>{t('feed.allVideos')}</Button>
          ) : (
            <Select
              label={t('feed.show')}
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as 'all' | 'following');
                setActive(0);
              }}
            >
              <option value="all">{t('feed.scope.all')}</option>
              <option value="following">{t('feed.scope.following')}</option>
            </Select>
          )}
          <Link to="/videos/upload" className="ds-btn ds-btn--primary">
            {t('common.upload')}
          </Link>
          <Link to="/videos/mine" className="ds-btn">
            {t('common.myVideos')}
          </Link>
          <Link to="/live" className="ds-btn">
            {t('feed.live')}
          </Link>
        </span>
      </div>
      {feed.error && (
        <Alert tone="danger">
          {feed.error}{' '}
          <button type="button" onClick={() => void feed.reload()}>
            {t('common.tryAgain')}
          </button>
        </Alert>
      )}
      {feed.loading && count === 0 && <p role="status">{t('feed.loading')}</p>}
      {!feed.loading && !feed.error && count === 0 && (
        <p>{scope === 'following' ? t('feed.emptyFollowing') : t('feed.empty')}</p>
      )}
      {count > 0 && (
        <div
          ref={root}
          className="vf-feed"
          tabIndex={0}
          role="region"
          aria-label={t('feed.aria')}
          onKeyDown={onKey}
        >
          {feed.items.map((v, i) => (
            <VideoSlide
              key={v.id}
              video={v}
              index={i}
              mounted={win.mount.includes(i)}
              active={i === active}
              prefetch={win.prefetch.includes(i)}
              muted={muted}
              onToggleMute={() => setMuted((m) => !m)}
              onChange={feed.replaceItem}
            />
          ))}
        </div>
      )}
      {feed.loading && count > 0 && <p role="status">{t('feed.loadingMore')}</p>}
    </>
  );
}
