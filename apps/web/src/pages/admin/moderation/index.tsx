import { useCallback, useEffect, useRef, useState } from 'react';
import {
  REPORT_STATUSES,
  type CursorPage,
  type ModerationAction,
  type ReportDTO,
  type ReportStatus,
} from '@farmplus/shared-types';
import { api } from '../../../api';
import { ConfirmActionDialog, StateMessage } from '../../../components/admin';
import { cap, useAdminI18n, type AdminKey } from '../../../components/admin/i18n';
import { errorMessage } from '../../../lib/format';

const COPY: Record<
  ModerationAction,
  { title: AdminKey; confirm: AdminKey; danger: boolean; text: AdminKey }
> = {
  dismiss: {
    title: 'modAction.dismiss.title',
    confirm: 'action.dismiss',
    danger: false,
    text: 'modAction.dismiss.text',
  },
  hide: {
    title: 'modAction.hide.title',
    confirm: 'action.hide',
    danger: true,
    text: 'modAction.hide.text',
  },
  remove: {
    title: 'modAction.remove.title',
    confirm: 'action.remove',
    danger: true,
    text: 'modAction.remove.text',
  },
};

/** `/admin/moderation`: review queue of reported posts and comments. The API requires `content.moderate` on every call. */
export default function ModerationPage() {
  const { t, label, status: statusLabel, dateTime } = useAdminI18n();
  const [status, setStatus] = useState<ReportStatus>('open');
  const [items, setItems] = useState<ReportDTO[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<{ report: ReportDTO; action: ModerationAction } | null>(
    null,
  );
  const generation = useRef(0);
  const [cleanup, setCleanup] = useState<string>();

  const load = useCallback(
    async (cursor?: string) => {
      const mine = ++generation.current;
      setLoading(true);
      setError(undefined);
      try {
        const page = await api.request<CursorPage<ReportDTO>>('GET', '/moderation/reports', {
          query: { status, limit: 20, ...(cursor ? { cursor } : {}) },
        });
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

  const resolve = async (note: string) => {
    if (!pending) return;
    await api.request('POST', `/moderation/reports/${pending.report.id}/resolve`, {
      body: { action: pending.action, note },
    });
    await load();
  };

  const runCleanup = async () => {
    setCleanup(t('common.running'));
    try {
      const r = await api.request<Record<string, number>>('POST', '/moderation/media/cleanup');
      setCleanup(
        t('moderation.cleanupDone', {
          uploads: r['uploadsExpired'] ?? 0,
          videos: r['processingFailed'] ?? 0,
          assets: r['assetsDeleted'] ?? 0,
          lives: r['livesClosed'] ?? 0,
        }),
      );
    } catch (e) {
      setCleanup(errorMessage(e));
    }
  };

  return (
    <>
      <h1>{t('nav.moderation')}</h1>
      <p>
        <button type="button" className="adm-btn" onClick={() => void runCleanup()}>
          {t('moderation.cleanup')}
        </button>{' '}
        {cleanup && <span role="status">{cleanup}</span>}
      </p>
      <label className="adm-field" style={{ maxWidth: '16rem' }}>
        <span>{t('common.status')}</span>
        <select value={status} onChange={(e) => setStatus(e.target.value as ReportStatus)}>
          {REPORT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {cap(statusLabel(s))}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <StateMessage kind="error" onRetry={() => void load()}>
          {error}
        </StateMessage>
      )}
      {loading && items.length === 0 && <StateMessage kind="loading" />}
      {!loading && !error && items.length === 0 && (
        <StateMessage kind="empty">
          {t('reports.empty', { status: statusLabel(status) })}
        </StateMessage>
      )}

      {items.map((r) => (
        <section
          key={r.id}
          className="adm-card"
          aria-label={t('moderation.reportOn', { target: label('reportTarget', r.targetType) })}
        >
          <h2 style={{ marginTop: 0 }}>
            {cap(label('reportTarget', r.targetType))} · {cap(label('reportReason', r.reason))}{' '}
            <small>
              {r.reportsOnTarget === 1
                ? t('moderation.countOne', { count: r.reportsOnTarget })
                : t('moderation.countMany', { count: r.reportsOnTarget })}
            </small>
          </h2>
          <dl className="adm-dl">
            <dt>{t('moderation.reportedBy')}</dt>
            <dd>
              {r.reporter.displayName} · {dateTime(r.createdAt)}
            </dd>
            {r.details && (
              <>
                <dt>{t('common.details')}</dt>
                <dd>{r.details}</dd>
              </>
            )}
            <dt>{t('moderation.author')}</dt>
            <dd>{r.snapshot.author.displayName}</dd>
            <dt>{t('moderation.contentNow')}</dt>
            <dd>{cap(statusLabel(r.targetStatus))}</dd>
            <dt>{t('moderation.contentThen')}</dt>
            <dd style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {r.snapshot.body || <em>{t('moderation.noText')}</em>}
              {r.snapshot.media.length > 0 && (
                <ul>
                  {r.snapshot.media.map((m) => (
                    <li key={m.id}>
                      {label('mediaKind', m.kind)}:{' '}
                      <a href={m.url} target="_blank" rel="noopener noreferrer">
                        {m.url}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </dd>
            {r.resolution && (
              <>
                <dt>{t('moderation.resolution')}</dt>
                <dd>
                  {t('moderation.resolvedBy', {
                    action: cap(label('modDone', r.resolution.action)),
                    by: r.resolution.by,
                    time: dateTime(r.resolution.at),
                  })}
                  {r.resolution.note ? t('common.quoted', { text: r.resolution.note }) : ''}
                </dd>
              </>
            )}
          </dl>
          {r.status === 'open' && (
            <div className="adm-row" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="adm-btn"
                onClick={() => setPending({ report: r, action: 'dismiss' })}
              >
                {t('action.dismiss')}
              </button>
              <button
                type="button"
                className="adm-btn adm-btn--danger"
                onClick={() => setPending({ report: r, action: 'hide' })}
              >
                {t('action.hide')}
              </button>
              <button
                type="button"
                className="adm-btn adm-btn--danger"
                onClick={() => setPending({ report: r, action: 'remove' })}
              >
                {t('action.remove')}
              </button>
            </div>
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
        requireReason
        onConfirm={resolve}
        onClose={() => setPending(null)}
      />
    </>
  );
}
