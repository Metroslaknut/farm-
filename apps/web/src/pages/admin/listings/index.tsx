import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LISTING_STATUSES,
  type CursorPage,
  type ListingDTO,
  type ListingEventDTO,
  type ListingStatus,
} from '@farmplus/shared-types';
import { formatBaht, humanize } from '@farmplus/shared-utils';
import { cap, useAdminI18n, type AdminKey } from '../../../components/admin/i18n';
import { api } from '../../../api';
import { ConfirmActionDialog, StateMessage } from '../../../components/admin';
import { errorMessage } from '../../../lib/format';

type Action = 'approve' | 'reject' | 'suspend' | 'restore';
const COPY: Record<
  Action,
  { title: AdminKey; confirm: AdminKey; danger: boolean; reason: boolean; text: AdminKey }
> = {
  approve: {
    title: 'listingAction.approve.title',
    confirm: 'action.approve',
    danger: false,
    reason: false,
    text: 'listingAction.approve.text',
  },
  reject: {
    title: 'listingAction.reject.title',
    confirm: 'action.reject',
    danger: true,
    reason: true,
    text: 'listingAction.reject.text',
  },
  suspend: {
    title: 'listingAction.suspend.title',
    confirm: 'action.suspend',
    danger: true,
    reason: true,
    text: 'listingAction.suspend.text',
  },
  restore: {
    title: 'listingAction.restore.title',
    confirm: 'action.restore',
    danger: false,
    reason: false,
    text: 'listingAction.restore.text',
  },
};
const ACTIONS: Partial<Record<ListingStatus, Action[]>> = {
  PENDING_REVIEW: ['approve', 'reject'],
  ACTIVE: ['suspend', 'reject'],
  PAUSED: ['restore', 'reject'],
};

/** `/admin/listings` — marketplace review queue and moderation (permission `listings.moderate`, enforced by the API). */
export default function ListingsPage() {
  const { t, label, status: statusLabel, dateTime } = useAdminI18n();
  const [status, setStatus] = useState<ListingStatus>('PENDING_REVIEW');
  const [items, setItems] = useState<ListingDTO[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<{ listing: ListingDTO; action: Action } | null>(null);
  const [history, setHistory] = useState<{ id: string; events: ListingEventDTO[] } | null>(null);
  const [cleanup, setCleanup] = useState<string>();
  const generation = useRef(0);

  const load = useCallback(
    async (cursor?: string) => {
      const mine = ++generation.current;
      setLoading(true);
      setError(undefined);
      try {
        const page = await api.request<CursorPage<ListingDTO>>(
          'GET',
          '/marketplace/moderation/listings',
          {
            query: { status, limit: 20, ...(cursor ? { cursor } : {}) },
          },
        );
        if (mine !== generation.current) return;
        setItems((prev) => (cursor ? [...prev, ...page.items] : page.items));
        setNext(page.nextCursor);
      } catch (e) {
        if (mine === generation.current) setError(errorMessage(e));
      } finally {
        if (mine === generation.current) setLoading(false);
      }
    },
    [status],
  );
  useEffect(() => {
    // Reload the queue whenever the status filter changes (synchronising with the API).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const act = async (reason: string) => {
    if (!pending) return;
    await api.request(
      'POST',
      `/marketplace/moderation/listings/${pending.listing.id}/${pending.action}`,
      { body: COPY[pending.action].reason ? { reason } : {} },
    );
    await load();
  };
  const showHistory = async (id: string) => {
    try {
      setHistory({
        id,
        events: (
          await api.request<{ events: ListingEventDTO[] }>(
            'GET',
            `/marketplace/moderation/listings/${id}/events`,
          )
        ).events,
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const runCleanup = async () => {
    setCleanup(t('common.running'));
    try {
      const r = await api.request<Record<string, number>>(
        'POST',
        '/marketplace/moderation/cleanup',
      );
      setCleanup(
        t('listings.cleanupDone', {
          offers: r['offersExpired'] ?? 0,
          listings: r['listingsExpired'] ?? 0,
          reservations: r['reservationsReleased'] ?? 0,
        }),
      );
    } catch (e) {
      setCleanup(errorMessage(e));
    }
  };

  return (
    <>
      <h1>{t('listings.title')}</h1>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'end', flexWrap: 'wrap' }}>
        <label className="adm-field" style={{ maxWidth: '16rem' }}>
          <span>{t('common.status')}</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as ListingStatus)}>
            {LISTING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {cap(statusLabel(s))}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="adm-btn" onClick={() => void runCleanup()}>
          {t('listings.cleanup')}
        </button>
        {cleanup && <span role="status">{cleanup}</span>}
      </div>
      {error && (
        <StateMessage kind="error" onRetry={() => void load()}>
          {error}
        </StateMessage>
      )}
      {loading && items.length === 0 && <StateMessage kind="loading" />}
      {!loading && !error && items.length === 0 && (
        <StateMessage kind="empty">
          {t('listings.empty', { status: cap(statusLabel(status)) })}
        </StateMessage>
      )}

      {items.map((l) => (
        <section key={l.id} className="adm-card" aria-label={l.title}>
          <h2 style={{ marginTop: 0 }}>
            {l.title} <small>{formatBaht(l.askingPriceMinor)}</small>
          </h2>
          <dl className="adm-dl">
            <dt>{t('users.seller')}</dt>
            <dd>
              {l.seller.displayName} · {l.farmName}
            </dd>
            <dt>{t('listings.animal')}</dt>
            <dd>
              {l.animal.animalTypeName}
              {l.animal.breed ? ` · ${humanize(l.animal.breed)}` : ''} ·{' '}
              {cap(label('sex', l.animal.sex))}
              {l.animal.birthDate ? t('listings.born', { date: l.animal.birthDate }) : ''}
            </dd>
            <dt>{t('listings.location')}</dt>
            <dd>{[l.location.district, l.location.province].filter(Boolean).join(', ') || '—'}</dd>
            <dt>{t('listings.terms')}</dt>
            <dd>
              {l.negotiable ? t('listings.negotiable') : t('listings.fixed')}
              {l.minOfferMinor ? t('listings.floor', { price: formatBaht(l.minOfferMinor) }) : ''}
            </dd>
            {l.description && (
              <>
                <dt>{t('common.description')}</dt>
                <dd style={{ whiteSpace: 'pre-wrap' }}>{l.description}</dd>
              </>
            )}
            {l.conditions && (
              <>
                <dt>{t('listings.conditions')}</dt>
                <dd style={{ whiteSpace: 'pre-wrap' }}>{l.conditions}</dd>
              </>
            )}
            <dt>{t('common.photos')}</dt>
            <dd>
              {l.photos.length === 0
                ? '—'
                : l.photos.map((p) => (
                    <a
                      key={p.url}
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ marginRight: '0.75rem' }}
                    >
                      {p.caption ?? t('common.photo')}
                    </a>
                  ))}
            </dd>
            {l.review?.rejectedReason && (
              <>
                <dt>{t('common.rejected')}</dt>
                <dd>{l.review.rejectedReason}</dd>
              </>
            )}
            <dt>{t('common.created')}</dt>
            <dd>{dateTime(l.createdAt)}</dd>
          </dl>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {(ACTIONS[l.status] ?? []).map((a) => (
              <button
                key={a}
                type="button"
                className={`adm-btn ${COPY[a].danger ? 'adm-btn--danger' : 'adm-btn--primary'}`}
                onClick={() => setPending({ listing: l, action: a })}
              >
                {t(COPY[a].confirm)}
              </button>
            ))}
            <button type="button" className="adm-btn" onClick={() => void showHistory(l.id)}>
              {t('listings.history')}
            </button>
          </div>
          {history?.id === l.id && (
            <ol aria-label={t('listings.historyAria')}>
              {history.events.map((e) => (
                <li key={e.id}>
                  {cap(label('listingEvent', e.type, e.type.replace('.', ' ').replace(/_/g, ' ')))}
                  {e.from && e.to
                    ? ` (${cap(statusLabel(e.from))} → ${cap(statusLabel(e.to))})`
                    : ''}{' '}
                  · {e.actor?.displayName ?? cap(t('common.system'))} · {dateTime(e.at)}
                  {e.data && typeof e.data['reason'] === 'string'
                    ? t('common.quoted', { text: e.data['reason'] })
                    : ''}
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}
      {next && !loading && (
        <button type="button" className="adm-btn" onClick={() => void load(next)}>
          {t('common.loadMore')}
        </button>
      )}

      <ConfirmActionDialog
        open={pending !== null}
        title={pending ? t(COPY[pending.action].title) : ''}
        description={pending ? t(COPY[pending.action].text) : undefined}
        confirmLabel={pending ? t(COPY[pending.action].confirm) : t('common.confirm')}
        tone={pending && COPY[pending.action].danger ? 'danger' : 'default'}
        requireReason={pending ? COPY[pending.action].reason : false}
        onConfirm={act}
        onClose={() => setPending(null)}
      />
    </>
  );
}
