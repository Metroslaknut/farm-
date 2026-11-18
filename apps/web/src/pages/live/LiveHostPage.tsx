import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  LIVE_ACCESS,
  type CursorPage,
  type LiveAccess,
  type LiveDTO,
  type LiveIngest,
  type PlaybackInfo,
} from '@farmplus/shared-types';
import {
  createLiveSchema,
  fieldErrorsFromDetails,
  fieldErrorsFromZod,
  type FieldErrors,
} from '@farmplus/validation';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import {
  Alert,
  Badge,
  Button,
  Card,
  Modal,
  Select,
  TextField,
  Textarea,
} from '../../components/ui';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/format';
import { pollWhileVisible } from '../../lib/poll';
import { localizeFieldErrors } from '../community/localize';
import { Player } from '../videos/Player';
import '../videos/videos.css';

const KEY_VISIBLE_MS = 60_000;

/** `/live/host` — create, monitor and end your live stream. Only the host ever sees the stream key. */
export default function LiveHostPage() {
  const t = useT('live');
  const { user } = useAuth();
  const me = user?.id;
  const [live, setLive] = useState<LiveDTO | null | undefined>(undefined);
  const [ingest, setIngest] = useState<LiveIngest>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [access, setAccess] = useState<LiveAccess>('public');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [muted, setMuted] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const refresh = useCallback(async () => {
    if (!me) return;
    try {
      for (const state of ['live', 'created'] as const) {
        const page = await api.request<CursorPage<LiveDTO>>('GET', '/live', {
          query: { state, hostId: me, limit: 1 },
        });
        if (page.items[0]) return setLive(page.items[0]);
      }
      setLive(null);
    } catch (e) {
      setErrors({ _form: errorMessage(e) });
    }
  }, [me]);

  useEffect(() => {
    // Initial load, then follow the state while a session exists.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const stopPolling = pollWhileVisible(() => void refresh(), 5000);
    return () => {
      stopPolling();
      clearTimeout(hideTimer.current);
    };
  }, [refresh]);

  const showIngest = (value: LiveIngest) => {
    setIngest(value);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setIngest(undefined), KEY_VISIBLE_MS); // the key does not stay on screen
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const payload = {
      title: title.trim(),
      access,
      ...(description.trim() ? { description: description.trim() } : {}),
    };
    const parsed = createLiveSchema.safeParse(payload);
    if (!parsed.success) return setErrors(localizeFieldErrors(fieldErrorsFromZod(parsed.error)));
    setBusy(true);
    setErrors({});
    try {
      const res = await api.request<{ live: LiveDTO; ingest: LiveIngest }>('POST', '/live', {
        body: parsed.data,
      });
      setLive(res.live);
      showIngest(res.ingest);
    } catch (e) {
      const mapped = fieldErrorsFromDetails(
        (e as { details?: { path: string; message: string }[] }).details,
      );
      setErrors(
        Object.keys(mapped).length ? localizeFieldErrors(mapped) : { _form: errorMessage(e) },
      );
    } finally {
      setBusy(false);
    }
  };

  const reveal = async () => {
    if (!live) return;
    setBusy(true);
    try {
      showIngest(await api.request<LiveIngest>('POST', `/live/${live.id}/ingest`));
    } catch (e) {
      setErrors({ _form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const end = async () => {
    if (!live) return;
    setBusy(true);
    try {
      await api.request('POST', `/live/${live.id}/end`);
      setIngest(undefined);
      setLive(null);
      setConfirmEnd(false);
    } catch (e) {
      setErrors({ _form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  if (live === undefined) return <p role="status">{t('common.loading')}</p>;
  return (
    <>
      <p>
        <Link to="/live">{t('common.backToLive')}</Link>
      </p>
      <h1>{t('common.goLive')}</h1>
      {errors['_form'] && <Alert tone="danger">{errors['_form']}</Alert>}

      {live === null ? (
        <form onSubmit={create} noValidate>
          <Card>
            <p>{t('host.intro')}</p>
            <TextField
              label={t('host.title')}
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              error={errors['title']}
            />
            <Textarea
              label={t('host.description')}
              rows={2}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              error={errors['description']}
            />
            <Select
              label={t('host.whoCanWatch')}
              value={access}
              onChange={(e) => setAccess(e.target.value as LiveAccess)}
            >
              {LIVE_ACCESS.map((a) => (
                <option key={a} value={a}>
                  {t(`host.access.${a}`)}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="primary" loading={busy}>
              {t('host.create')}
            </Button>
          </Card>
        </form>
      ) : (
        <>
          <Card title={live.title} headingLevel={2}>
            <p>
              <Badge tone={live.state === 'live' ? 'danger' : 'warning'}>
                {t(`host.state.${live.state}`)}
              </Badge>{' '}
              · {t(`host.accessShown.${live.access}`)}
            </p>
            {live.moderationNotice && <Alert tone="warning">{live.moderationNotice}</Alert>}
            {live.state === 'created' && <p role="status">{t('host.waiting')}</p>}
            {live.state === 'interrupted' && <p role="status">{t('host.interrupted')}</p>}
            <div className="ds-row">
              <Link to={`/live/${live.id}`} className="ds-btn">
                {t('host.openViewer')}
              </Link>
              <Button onClick={() => void reveal()} loading={busy}>
                {t('host.showSettings')}
              </Button>
              <Button variant="danger" onClick={() => setConfirmEnd(true)}>
                {t('host.end')}
              </Button>
            </div>
          </Card>
          {ingest && (
            <Card
              title={t('host.settingsTitle')}
              headingLevel={2}
              style={{ marginTop: 'var(--ds-space-4)' }}
            >
              <Alert tone="warning">{t('host.keyWarning')}</Alert>
              <p>
                {t('host.server')} <code data-testid="ingest-url">{ingest.rtmpsUrl}</code>
              </p>
              <p>
                {t('host.streamKey')} <code data-testid="ingest-key">{ingest.streamKey}</code>
              </p>
              <Button size="sm" onClick={() => setIngest(undefined)}>
                {t('host.hide')}
              </Button>
            </Card>
          )}
          {(live.state === 'live' || live.state === 'interrupted') && (
            <div
              className="vf-feed"
              style={{ height: '50vh', overflow: 'hidden', marginTop: 'var(--ds-space-4)' }}
            >
              <Player
                live
                label={t('host.preview', { title: live.title })}
                active={live.state === 'live'}
                muted={muted}
                onToggleMute={() => setMuted((m) => !m)}
                fetchPlayback={() => api.request<PlaybackInfo>('GET', `/live/${live.id}/playback`)}
              />
            </div>
          )}
        </>
      )}
      <Modal
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        title={t('host.endTitle')}
        footer={
          <>
            <Button onClick={() => setConfirmEnd(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" loading={busy} onClick={() => void end()}>
              {t('host.end')}
            </Button>
          </>
        }
      >
        <p>{t('host.endBody')}</p>
      </Modal>
    </>
  );
}
