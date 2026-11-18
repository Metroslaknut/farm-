import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { LiveDTO, PlaybackInfo } from '@farmplus/shared-types';
import { api } from '../../api';
import { Alert, Badge } from '../../components/ui';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/format';
import { pollWhileVisible } from '../../lib/poll';
import { ReportDialog } from '../community/ReportDialog';
import { Player } from '../videos/Player';
import '../videos/videos.css';

const BANNER = {
  created: 'viewer.banner.created',
  live: undefined,
  interrupted: 'viewer.banner.interrupted',
  ended: 'viewer.banner.ended',
  failed: 'viewer.banner.failed',
} as const satisfies Record<LiveDTO['state'], string | undefined>;

/** `/live/:id` — watch a live session. Polls its state so it follows the host through start, interruptions and the end. */
export default function LiveViewerPage() {
  const t = useT('live');
  const { id = '' } = useParams();
  const [live, setLive] = useState<LiveDTO>();
  const [error, setError] = useState<string>();
  const [muted, setMuted] = useState(false);
  const [report, setReport] = useState(false);
  const [reported, setReported] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await api.request<{ live: LiveDTO }>('GET', `/live/${id}`);
        if (stop) return;
        setLive(res.live);
        setError(undefined);
      } catch (e) {
        // A stream that disappears (ended + removed, or no longer visible) is reported once and polling stops.
        if (stop) return;
        // Once a stream is over it is no longer readable by viewers (404): tell them, instead of keeping a stale state.
        if ((e as { status?: number }).status === 404) setGone(true);
        else setError(errorMessage(e));
      }
    };
    void load();
    const stopPolling = pollWhileVisible(() => void load(), 5000);
    return () => {
      stop = true;
      stopPolling();
    };
  }, [id]);

  if (gone && !live) return <Alert tone="info">{t('viewer.gone')}</Alert>;
  if (error && !live) return <Alert tone="danger">{error}</Alert>;
  if (!live) return <p role="status">{t('common.loading')}</p>;
  const state = gone ? 'ended' : live.state;
  const watching = state === 'live' || state === 'interrupted';
  return (
    <>
      <p>
        <Link to="/live">{t('common.backToLive')}</Link>
      </p>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <h1>{live.title}</h1>
        <Badge tone={state === 'live' ? 'danger' : 'warning'}>
          {state === 'live' ? t('common.live') : t(`viewer.state.${state}`)}
        </Badge>
      </div>
      <p>
        {t('common.hostedBy')}{' '}
        <Link to={`/community/users/${live.host.id}`}>{live.host.displayName}</Link>
      </p>
      {live.description && <p>{live.description}</p>}
      {live.moderationNotice && <Alert tone="warning">{live.moderationNotice}</Alert>}
      {BANNER[state] && <Alert tone="info">{t(BANNER[state])}</Alert>}
      {reported && <Alert tone="info">{t('common.reported')}</Alert>}
      {error && <Alert tone="warning">{error}</Alert>}
      {watching && (
        <div
          className="vf-feed"
          style={{ height: '60vh', scrollSnapType: 'none', overflow: 'hidden' }}
        >
          <Player
            key={`${live.id}-${state === 'live'}`}
            live
            label={live.title}
            active={state === 'live'}
            muted={muted}
            onToggleMute={() => setMuted((m) => !m)}
            fetchPlayback={() => api.request<PlaybackInfo>('GET', `/live/${live.id}/playback`)}
          />
        </div>
      )}
      {!live.viewer.isHost && state !== 'ended' && (
        <p>
          <button type="button" onClick={() => setReport(true)}>
            {t('viewer.report')}
          </button>
        </p>
      )}
      <ReportDialog
        target={report ? { type: 'live', id: live.id } : null}
        onClose={() => setReport(false)}
        onReported={() => setReported(true)}
      />
    </>
  );
}
