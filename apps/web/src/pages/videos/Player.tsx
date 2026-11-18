import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaybackInfo } from '@farmplus/shared-types';
import { Button } from '../../components/ui';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/format';
import { WatchClock, isExpiringSoon } from './videoFeed';

type Status = 'idle' | 'loading' | 'ready' | 'error';
type MessageKey =
  | 'player.unsupported'
  | 'player.stopped'
  | 'player.loadFailed'
  | 'player.streamUnavailable'
  | 'player.playFailed';
/** A message of ours (translated at render time) or an API error already in the user's language. */
type Message = { key: MessageKey } | { text: string };

interface Props {
  /** Asks the API for a short-lived playback URL (after it authorised the viewer). */
  fetchPlayback: () => Promise<PlaybackInfo>;
  /** The slide on screen: plays. */
  active: boolean;
  /** Next/previous slide: resolves the source and preloads, but does not play. */
  preload?: boolean;
  muted: boolean;
  onToggleMute: () => void;
  loop?: boolean;
  /** Live streams: no seeking/looping, "reconnecting" copy. */
  live?: boolean;
  label: string;
  /** Called once per activation when `watchedSeconds` crosses `reportAfter`. */
  onWatched?: (watchedSeconds: number) => void;
  reportAfter?: number;
}

const NATIVE_HLS = (v: HTMLVideoElement) => v.canPlayType('application/vnd.apple.mpegurl') !== '';

/**
 * One video surface with the behaviours the feed needs: lazy source resolution, HLS (native or hls.js), play / pause /
 * mute, buffering state, and recovery from playback errors (one silent retry with a fresh URL, then a visible Retry button).
 */
export function Player({
  fetchPlayback,
  active,
  preload = false,
  muted,
  onToggleMute,
  loop = true,
  live = false,
  label,
  onWatched,
  reportAfter = 3,
}: Props) {
  const t = useT('videos');
  const ref = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [attempt, setAttempt] = useState(0);
  const [paused, setPaused] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [message, setMessage] = useState<Message>();
  const wanted = active || preload;
  const info = useRef<PlaybackInfo>(undefined);
  const autoRetries = useRef(0);
  const clock = useRef(new WatchClock());
  const reported = useRef(false);
  const fetchRef = useRef(fetchPlayback);
  useEffect(() => {
    fetchRef.current = fetchPlayback;
  });

  const fail = useCallback((value: MessageKey | Message) => {
    setStatus('error');
    setMessage(typeof value === 'string' ? { key: value } : value);
  }, []);

  // Resolve + attach the source whenever the slide is wanted (and again on every retry).
  useEffect(() => {
    const video = ref.current;
    if (!wanted || !video) return;
    let cancelled = false;
    let hls: { destroy: () => void } | undefined;

    const run = async () => {
      setStatus('loading');
      setMessage(undefined);
      try {
        // Reuse a still-valid URL (swiping back and forth must not hit the API each time).
        if (!info.current || attempt > 0 || isExpiringSoon(info.current.expiresAt))
          info.current = await fetchRef.current();
        if (cancelled) return;
        const url = info.current.url;
        if (/\.m3u8(\?|$)/i.test(url) && !NATIVE_HLS(video)) {
          const { default: Hls } = await import('hls.js');
          if (cancelled) return;
          if (!Hls.isSupported()) return fail('player.unsupported');
          const instance = new Hls({ enableWorker: true });
          hls = instance;
          let recovered = false;
          instance.on(Hls.Events.ERROR, (_e, data) => {
            if (!data.fatal) return;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !recovered) {
              recovered = true;
              instance.startLoad();
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
              recovered = true;
              instance.recoverMediaError();
            } else {
              fail('player.stopped');
            }
          });
          instance.loadSource(url);
          instance.attachMedia(video);
        } else {
          video.src = url;
        }
        video.preload = 'auto';
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        info.current = undefined;
        fail(e instanceof Error && e.message ? { text: errorMessage(e) } : 'player.loadFailed');
      }
    };
    void run();
    return () => {
      cancelled = true;
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [wanted, attempt, fail]);

  // Play only the active slide.
  useEffect(() => {
    const video = ref.current;
    if (!video || status !== 'ready') return;
    if (active) {
      video.play().catch(() => setPaused(true)); // autoplay can be refused: the play button covers it
    } else {
      video.pause();
    }
  }, [active, status]);

  // A new activation restarts the watch clock (a view is judged per play-through, the server dedupes per day).
  useEffect(() => {
    if (active) {
      clock.current.reset();
      reported.current = false;
      autoRetries.current = 0;
    }
  }, [active]);

  const onError = () => {
    // Most playback errors are an expired/revoked URL or a flaky network: try once more with a fresh URL.
    info.current = undefined;
    if (autoRetries.current < 1) {
      autoRetries.current += 1;
      setAttempt((n) => n + 1);
      return;
    }
    fail(live ? 'player.streamUnavailable' : 'player.playFailed');
  };

  const toggle = () => {
    const video = ref.current;
    if (!video || status !== 'ready') return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  };

  return (
    <div className="vf-player" data-status={status} data-active={active ? 'true' : 'false'}>
      <video
        ref={ref}
        className="vf-video"
        aria-label={label}
        muted={muted}
        loop={loop && !live}
        playsInline
        preload="none"
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => {
          setBuffering(false);
          autoRetries.current = 0;
        }}
        onError={onError}
        onTimeUpdate={(e) => {
          if (!active || !onWatched || reported.current) return;
          const v = e.currentTarget;
          if (clock.current.tick(v.currentTime, !v.paused) >= reportAfter) {
            reported.current = true;
            onWatched(clock.current.seconds);
          }
        }}
      />
      {status === 'ready' && (
        <button
          type="button"
          className="vf-tap"
          onClick={toggle}
          aria-label={paused ? t('player.play', { label }) : t('player.pause', { label })}
        >
          {paused && (
            <span className="vf-play" aria-hidden="true">
              ▶
            </span>
          )}
        </button>
      )}
      {(status === 'loading' || buffering) && status !== 'error' && (
        <div className="vf-overlay" role="status">
          {live ? t('player.connecting') : t('common.loading')}
        </div>
      )}
      {status === 'error' && (
        <div className="vf-overlay vf-error" role="alert">
          <p>{!message ? t('player.failed') : 'key' in message ? t(message.key) : message.text}</p>
          <Button
            variant="primary"
            onClick={() => {
              autoRetries.current = 0;
              setAttempt((n) => n + 1);
            }}
          >
            {t('common.tryAgain')}
          </Button>
        </div>
      )}
      <button
        type="button"
        className="vf-mute"
        onClick={onToggleMute}
        aria-pressed={muted}
        aria-label={muted ? t('player.unmute') : t('player.mute')}
      >
        {muted ? '🔇' : '🔊'}
      </button>
    </div>
  );
}
