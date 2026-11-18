import type { LiveDTO, PlaybackInfo } from '@farmplus/shared-types';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { ReportModal } from '@/components/community/ReportModal';
import { Button, Screen, StateView, StatusBadge, Text } from '@/components/ui';
import { MobilePlayer } from '@/components/video/MobilePlayer';
import { toViewError, type ViewError } from '@/api/errors';
import { useT, type KeyOf } from '@/i18n';

/** Explanation under the title per stream state (resolved at render time, so it follows the language). */
const BANNER: Record<LiveDTO['state'], KeyOf<'videos'> | undefined> = {
  created: 'live.banner.created',
  live: undefined,
  interrupted: 'live.banner.interrupted',
  ended: 'live.banner.ended',
  failed: 'live.banner.failed',
};
const STATE_LABEL: Record<LiveDTO['state'], KeyOf<'videos'>> = {
  created: 'live.state.created',
  live: 'live.state.live',
  interrupted: 'live.state.interrupted',
  ended: 'live.state.ended',
  failed: 'live.state.failed',
};

function Viewer() {
  const t = useT('videos');
  const { id } = useLocalSearchParams<{ id: string }>();
  const [live, setLive] = useState<LiveDTO>();
  const [error, setError] = useState<ViewError>();
  const [gone, setGone] = useState(false);
  const [muted, setMuted] = useState(false);
  const [report, setReport] = useState(false);
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await api.request<{ live: LiveDTO }>('GET', `/live/${id}`);
        if (!stop) {
          setLive(res.live);
          setError(undefined);
        }
      } catch (e) {
        if (stop) return;
        // A stream that is over is no longer readable by viewers (404): tell them instead of keeping a stale state.
        if ((e as { status?: number }).status === 404) setGone(true);
        else setError(toViewError(e));
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [id]);

  if (gone && !live)
    return (
      <StateView
        kind="empty"
        title={t('live.notAvailableTitle')}
        message={t('live.notAvailableMessage')}
      />
    );
  if (error && !live) return <StateView kind="error" error={error} />;
  if (!live) return <StateView kind="loading" label={t('live.loading')} />;
  const state = gone ? 'ended' : live.state;
  const watching = state === 'live' || state === 'interrupted';
  const banner = BANNER[state];
  return (
    <Screen>
      <StatusBadge
        tone={state === 'live' ? 'error' : 'warning'}
        label={STATE_LABEL[state] ? t(STATE_LABEL[state]) : state}
      />
      <Text variant="heading">{live.title}</Text>
      <Text muted>{t('live.hostedBy', { name: live.host.displayName })}</Text>
      {live.description ? <Text>{live.description}</Text> : null}
      {banner ? <Text muted>{t(banner)}</Text> : null}
      {notice ? <Text>{notice}</Text> : null}
      {watching ? (
        <View style={{ height: 420 }}>
          <MobilePlayer
            key={`${live.id}-${state === 'live'}`}
            live
            label={live.title}
            active={state === 'live'}
            muted={muted}
            onToggleMute={() => setMuted((m) => !m)}
            fetchPlayback={() => api.request<PlaybackInfo>('GET', `/live/${live.id}/playback`)}
          />
        </View>
      ) : null}
      {!live.viewer.isHost && state !== 'ended' ? (
        <Button title={t('live.report')} variant="ghost" onPress={() => setReport(true)} />
      ) : null}
      <ReportModal
        target={report ? { type: 'live', id: live.id } : null}
        onClose={() => setReport(false)}
        onReported={() => setNotice(t('live.reported'))}
      />
    </Screen>
  );
}

export default function LiveScreen() {
  return (
    <RequireAuth>
      <Viewer />
    </RequireAuth>
  );
}
