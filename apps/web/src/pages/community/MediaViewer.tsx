import { useState } from 'react';
import type { PostMedia } from '@farmplus/shared-types';
import { Button, Modal } from '../../components/ui';
import { useT } from '../../i18n';

/** Renders one external media file. Never sends a referrer; images load lazily. */
export function MediaItem({ media, full = false }: { media: PostMedia; full?: boolean }) {
  const t = useT('community');
  const label = media.caption ?? (media.kind === 'image' ? t('media.photo') : t('media.video'));
  if (media.kind === 'image')
    return (
      <img
        src={media.url}
        alt={label}
        loading="lazy"
        referrerPolicy="no-referrer"
        style={{
          width: '100%',
          height: full ? 'auto' : '100%',
          maxHeight: full ? '70vh' : undefined,
          objectFit: full ? 'contain' : 'cover',
          display: 'block',
        }}
      />
    );
  return (
    <video
      src={media.url}
      aria-label={label}
      controls={full}
      autoPlay={full}
      playsInline
      muted={!full}
      preload={full ? 'auto' : 'metadata'}

      style={{
        width: '100%',
        height: full ? 'auto' : '100%',
        maxHeight: full ? '70vh' : undefined,
        objectFit: 'cover',
        display: 'block',
      }}
    />
  );
}

const KIND = { image: 'media.kind.image', video: 'media.kind.video' } as const;

/** Thumbnails of a post's media; activating one opens the viewer on it. */
export function MediaGrid({ media }: { media: PostMedia[] }) {
  const t = useT('community');
  const [index, setIndex] = useState<number | null>(null);
  if (media.length === 0) return null;
  const cols = media.length === 1 ? 1 : 2;
  const current = index === null ? undefined : media[index];
  return (
    <>
      <ul
        aria-label={t('media.attached')}
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 'var(--ds-space-3) 0',
          display: 'grid',
          gap: 'var(--ds-space-2)',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
        }}
      >
        {media.map((m, i) => (
          <li
            key={m.id}
            style={{
              aspectRatio: media.length === 1 ? '16 / 9' : '1 / 1',
              overflow: 'hidden',
              borderRadius: 'var(--ds-radius-md, 8px)',
              position: 'relative',
            }}
          >
            <button
              type="button"
              onClick={() => setIndex(i)}
              aria-label={
                m.caption
                  ? t('media.openCaption', { kind: t(KIND[m.kind]), caption: m.caption })
                  : t('media.openIndex', {
                      kind: t(KIND[m.kind]),
                      index: i + 1,
                      total: media.length,
                    })
              }
              style={{
                all: 'unset',
                cursor: 'zoom-in',
                display: 'block',
                width: '100%',
                height: '100%',
              }}
            >
              <MediaItem media={m} />
              {m.kind === 'video' && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: '2.5rem',
                    color: '#fff',
                    textShadow: '0 1px 6px #000',
                  }}
                >
                  ▶
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <Modal
        open={current !== undefined}
        onClose={() => setIndex(null)}
        title={
          current?.caption ??
          (current
            ? t('media.title', {
                kind: current.kind === 'image' ? t('media.photo') : t('media.video'),
                index: (index ?? 0) + 1,
                total: media.length,
              })
            : '')
        }
        footer={
          media.length > 1 ? (
            <>
              <Button
                disabled={(index ?? 0) === 0}
                onClick={() => setIndex((i) => Math.max(0, (i ?? 0) - 1))}
              >
                {t('media.previous')}
              </Button>
              <Button
                disabled={(index ?? 0) >= media.length - 1}
                onClick={() => setIndex((i) => Math.min(media.length - 1, (i ?? 0) + 1))}
              >
                {t('media.next')}
              </Button>
            </>
          ) : undefined
        }
      >
        {current && <MediaItem key={current.id} media={current} full />}
      </Modal>
    </>
  );
}
