import type { PlaybackInfo } from '@farmplus/shared-types';
import { WatchClock, isExpiringSoon } from '@farmplus/shared-utils';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Text } from '@/components/ui';
import { t as tr, useT } from '@/i18n';
import { errorText } from '@/lib/messages';
import { theme } from '@/theme';

interface Props {
  fetchPlayback: () => Promise<PlaybackInfo>;
  /** On screen: plays. */
  active: boolean;
  /** Neighbouring slide: resolves the source and buffers, does not play. */
  preload?: boolean;
  muted: boolean;
  onToggleMute: () => void;
  live?: boolean;
  label: string;
  /** Called once per activation after `reportAfter` seconds of real playback. */
  onWatched?: (watchedSeconds: number) => void;
  reportAfter?: number;
}

/** The native player is an imperative object: settings are applied to it directly. */
const applyMuted = (player: VideoPlayer, muted: boolean): void => {
  player.muted = muted;
};

/**
 * One native video surface (expo-video) with lazy source resolution, play/pause/mute, buffering state and
 * recovery: one silent retry with a fresh URL on a playback error, then a visible Retry button.
 */
export function MobilePlayer({
  fetchPlayback,
  active,
  preload = false,
  muted,
  onToggleMute,
  live = false,
  label,
  onWatched,
  reportAfter = 3,
}: Props) {
  const t = useT('videos');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [message, setMessage] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const player = useVideoPlayer(null, (p) => {
    p.loop = !live;
    p.timeUpdateEventInterval = 0.5;
  });
  const info = useRef<PlaybackInfo | undefined>(undefined);
  /** URL currently loaded into the native player (never reload the same source: it would interrupt playback). */
  const loadedUrl = useRef<string | undefined>(undefined);
  const autoRetries = useRef(0);
  const clock = useRef(new WatchClock());
  const reported = useRef(false);
  const fetchRef = useRef(fetchPlayback);
  const activeRef = useRef(active);
  useEffect(() => {
    fetchRef.current = fetchPlayback;
    activeRef.current = active;
  });
  const wanted = active || preload;

  const fail = useCallback((text: string) => {
    setStatus('error');
    setMessage(text);
  }, []);

  useEffect(() => {
    applyMuted(player, muted);
  }, [player, muted]);

  // Resolve + load the source when wanted (and again on every retry).
  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    (async () => {
      setStatus('loading');
      setMessage(undefined);
      try {
        if (!info.current || attempt > 0 || isExpiringSoon(info.current.expiresAt))
          info.current = await fetchRef.current();
        if (cancelled) return;
        if (loadedUrl.current !== info.current.url) {
          loadedUrl.current = info.current.url;
          await player.replaceAsync({ uri: info.current.url });
        }
        if (cancelled) return;
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        info.current = undefined;
        loadedUrl.current = undefined;
        fail(e instanceof Error && e.message ? errorText(e) : tr('videos', 'player.loadFailed'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wanted, attempt, player, fail]);

  // Play only the active slide.
  useEffect(() => {
    if (status !== 'ready') return;
    try {
      if (active) player.play();
      else player.pause();
    } catch {
      /* a play request interrupted by a reload is retried by the next status change */
    }
  }, [active, status, player]);

  useEffect(() => {
    if (active) {
      clock.current.reset();
      reported.current = false;
      autoRetries.current = 0;
    }
  }, [active]);

  useEffect(() => {
    const subs = [
      player.addListener('statusChange', ({ status: s }) => {
        if (s === 'error') {
          info.current = undefined;
          loadedUrl.current = undefined; // the next attempt must load a fresh URL
          if (autoRetries.current < 1) {
            autoRetries.current += 1;
            setAttempt((n) => n + 1);
          } else fail(tr('videos', live ? 'player.streamUnavailable' : 'player.playFailed'));
        }
      }),
      player.addListener('playingChange', ({ isPlaying }) => {
        setPlaying(isPlaying);
        if (isPlaying) autoRetries.current = 0;
      }),
      player.addListener('timeUpdate', ({ currentTime }) => {
        if (!activeRef.current || !onWatched || reported.current) return;
        if (clock.current.tick(currentTime, player.playing) >= reportAfter) {
          reported.current = true;
          onWatched(clock.current.seconds);
        }
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [player, fail, live, onWatched, reportAfter]);

  return (
    <View style={styles.fill} accessibilityLabel={label}>
      <VideoView player={player} style={styles.fill} contentFit="contain" nativeControls={false} />
      {status === 'ready' && (
        <Pressable
          style={styles.tap}
          accessibilityRole="button"
          accessibilityLabel={t(playing ? 'player.pause' : 'player.play', { label })}
          onPress={() => (player.playing ? player.pause() : player.play())}
        >
          {!playing && (
            <Text variant="title" color={theme.colors.textOnPrimary}>
              ▶
            </Text>
          )}
        </Pressable>
      )}
      {status === 'loading' && (
        <View style={styles.overlay} accessibilityRole="progressbar">
          <Text color={theme.colors.textOnPrimary}>
            {live ? t('player.connecting') : t('player.loading')}
          </Text>
        </View>
      )}
      {status === 'error' && (
        <View style={[styles.overlay, styles.error]} accessibilityRole="alert">
          <Text color={theme.colors.textOnPrimary}>{message ?? t('player.failed')}</Text>
          <Button
            title={t('player.tryAgain')}
            onPress={() => {
              autoRetries.current = 0;
              setAttempt((n) => n + 1);
            }}
          />
        </View>
      )}
      <Pressable
        style={styles.mute}
        accessibilityRole="button"
        accessibilityState={{ selected: muted }}
        accessibilityLabel={muted ? t('player.unmute') : t('player.mute')}
        onPress={onToggleMute}
      >
        <Text color={theme.colors.textOnPrimary}>{muted ? '🔇' : '🔊'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: theme.colors.mediaBackground },
  tap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  error: { backgroundColor: 'rgba(0,0,0,0.7)', padding: theme.spacing.lg },
  mute: {
    position: 'absolute',
    top: theme.spacing.md,
    right: theme.spacing.md,
    minWidth: theme.minTouch,
    minHeight: theme.minTouch,
    borderRadius: theme.minTouch / 2,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
