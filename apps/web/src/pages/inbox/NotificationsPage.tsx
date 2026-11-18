import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  NOTIFICATION_CATEGORIES,
  REALTIME_EVENTS,
  type NotificationCategory,
  type NotificationDTO,
  type NotificationPage,
  type NotificationPreferencesDTO,
} from '@farmplus/shared-types';
import { api } from '../../api';
import { Alert, Button } from '../../components/ui';
import { errorMessage, formatDateTime } from '../../lib/format';
import { useLocale, useT } from '../../i18n';
import { useInbox } from '../../lib/inbox';
import { notificationText } from './notificationText';
import '../../components/inbox/inbox.css';

/** `/notifications` — the signed-in user's notifications, with unread filter, categories and preferences. */
export default function NotificationsPage() {
  const { client, counts, refresh } = useInbox();
  const t = useT('inbox');
  const [locale] = useLocale();
  const categoryLabel = (c: NotificationCategory) => t(`category.${c}`);
  const [items, setItems] = useState<NotificationDTO[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [category, setCategory] = useState<NotificationCategory | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [prefs, setPrefs] = useState<NotificationPreferencesDTO>();
  const [prefError, setPrefError] = useState<string>();

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(undefined);
      try {
        const page = await api.request<NotificationPage>('GET', '/notifications', {
          query: {
            limit: 20,
            cursor,
            unread: unreadOnly || undefined,
            category: category || undefined,
          },
        });
        setItems((prev) =>
          cursor
            ? [...prev, ...page.items.filter((i) => !prev.some((p) => p.id === i.id))]
            : page.items,
        );
        setNext(page.nextCursor);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [unreadOnly, category],
  );

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);
  useEffect(() => {
    api
      .request<NotificationPreferencesDTO>('GET', '/notifications/preferences')
      .then(setPrefs)
      .catch((e: unknown) => setPrefError(errorMessage(e)));
  }, []);

  // Live: a new notification appears at the top; after a reconnect the list is re-read.
  useEffect(() => {
    if (!client) return;
    const offNew = client.on(REALTIME_EVENTS.notification, (n: NotificationDTO) => {
      if ((category && n.category !== category) || items.some((i) => i.id === n.id)) return;
      setItems((prev) => [n, ...prev.filter((p) => p.id !== n.id)]);
    });
    const offResync = client.onResync(() => void load());
    return () => {
      offNew();
      offResync();
    };
  }, [client, category, items, load]);

  const markRead = async (n: NotificationDTO) => {
    if (n.readAt) return;
    try {
      const res = await api.request<{ notification: NotificationDTO }>(
        'POST',
        `/notifications/${n.id}/read`,
      );
      setItems((prev) => prev.map((p) => (p.id === n.id ? res.notification : p)));
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const markAll = async () => {
    try {
      await api.request('POST', '/notifications/read-all', { body: category ? { category } : {} });
      await load();
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const remove = async (n: NotificationDTO) => {
    try {
      await api.request('DELETE', `/notifications/${n.id}`);
      setItems((prev) => prev.filter((p) => p.id !== n.id));
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const setPref = async (c: NotificationCategory, inApp: boolean) => {
    setPrefError(undefined);
    try {
      setPrefs(
        await api.request<NotificationPreferencesDTO>('PUT', '/notifications/preferences', {
          body: { categories: { [c]: { inApp } } },
        }),
      );
    } catch (e) {
      setPrefError(errorMessage(e));
    }
  };

  return (
    <div className="inbox-page">
      <h1>{t('notifications.title')}</h1>
      <p className="inbox-muted">{t('notifications.unread', { count: counts.notifications })}</p>
      <div className="ds-row" role="group" aria-label={t('notifications.filters')}>
        <label>
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
          />{' '}
          {t('notifications.unreadOnly')}
        </label>
        <label>
          {t('notifications.category')}{' '}
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as NotificationCategory | '')}
          >
            <option value="">{t('notifications.all')}</option>
            {NOTIFICATION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" onClick={() => void markAll()}>
          {t('notifications.markAll')}
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {!loading && items.length === 0 && !error && (
        <p>{unreadOnly ? t('notifications.emptyUnread') : t('notifications.empty')}</p>
      )}
      <ul className="inbox-list">
        {items.map((n) => {
          const text = notificationText(t, locale, n);
          return (
            <li key={n.id} className="inbox-item" data-unread={!n.readAt}>
              <div>
                <p>
                  <strong>{text.title}</strong>
                  {n.count > 1 && <span className="inbox-muted"> ({n.count})</span>}
                </p>
                <p>{text.body}</p>
                <p className="inbox-muted">
                  {categoryLabel(n.category)} · {formatDateTime(n.createdAt)}
                  {n.link && (
                    <>
                      {' · '}
                      <Link to={n.link} onClick={() => void markRead(n)}>
                        {t('notifications.open')}
                      </Link>
                    </>
                  )}
                </p>
              </div>
              <span className="ds-row">
                {!n.readAt && (
                  <Button
                    size="sm"
                    onClick={() => void markRead(n)}
                    aria-label={t('notifications.markReadAria', { title: text.title })}
                  >
                    {t('notifications.markRead')}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void remove(n)}
                  aria-label={t('notifications.deleteAria', { title: text.title })}
                >
                  {t('notifications.delete')}
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
      {loading && <p role="status">{t('loading')}</p>}
      {next && !loading && (
        <Button onClick={() => void load(next)}>{t('notifications.loadMore')}</Button>
      )}

      <h2>{t('notifications.prefs')}</h2>
      {prefError && <Alert tone="danger">{prefError}</Alert>}
      {prefs && (
        <fieldset>
          <legend>{t('notifications.prefsLegend')}</legend>
          {NOTIFICATION_CATEGORIES.map((c) => (
            <p key={c}>
              <label>
                <input
                  type="checkbox"
                  checked={prefs.categories[c].inApp}
                  disabled={prefs.categories[c].locked}
                  onChange={(e) => void setPref(c, e.target.checked)}
                />{' '}
                {categoryLabel(c)}
              </label>
              {prefs.categories[c].locked && (
                <span className="inbox-muted">{t('notifications.locked')}</span>
              )}
            </p>
          ))}
        </fieldset>
      )}
    </div>
  );
}
