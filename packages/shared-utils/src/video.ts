/** Pure helpers for the vertical video feed and uploads — shared by Web and Mobile (no React/DOM/RN imports). */

/**
 * Which slides do what around the active one:
 *  - `mount`: a <video> element exists (active ± 1) — keeps memory and decoders bounded however long the feed is
 *  - `prefetch`: playback is resolved and the browser preloads (the next slide; the previous one for swiping back)
 */
export function slideWindow(
  active: number,
  count: number,
): { mount: number[]; prefetch: number[] } {
  const inRange = (i: number) => i >= 0 && i < count;
  return {
    mount: [active - 1, active, active + 1].filter(inRange),
    prefetch: [active + 1, active - 1].filter(inRange),
  };
}

/** Fetch the next page when the user is within `threshold` slides of the end. */
export const shouldLoadMore = (
  active: number,
  count: number,
  hasMore: boolean,
  threshold = 3,
): boolean => hasMore && count - 1 - active <= threshold;

export const clampIndex = (i: number, count: number): number =>
  count === 0 ? 0 : Math.min(Math.max(i, 0), count - 1);

/** A playback token is refreshed a little before it expires, not after the player already failed. */
export const isExpiringSoon = (expiresAt: string, now = Date.now(), marginMs = 60_000): boolean =>
  new Date(expiresAt).getTime() - now <= marginMs;

/** Watch-time accumulator: counts real playing time (ignores seeks and paused/buffering gaps). */
export class WatchClock {
  private last: number | null = null;
  seconds = 0;
  tick(currentTime: number, playing: boolean): number {
    if (playing && this.last !== null) {
      const delta = currentTime - this.last;
      // forward progress under 2.5 s per tick is playback; anything else is a seek or a loop restart
      if (delta > 0 && delta < 2.5) this.seconds += delta;
    }
    this.last = currentTime;
    return this.seconds;
  }
  reset(): void {
    this.last = null;
    this.seconds = 0;
  }
}

export interface UploadRules {
  maxUploadBytes: number;
  mimeTypes: readonly string[];
}

/** Client-side pre-check; the API and the provider enforce the same limits again. */
export function validateVideoFile(
  file: { name: string; type: string; size: number },
  rules: UploadRules,
): string | undefined {
  if (!rules.mimeTypes.includes(file.type)) return 'Choose an MP4, MOV, M4V or WebM video.';
  if (file.size <= 0) return 'The file is empty.';
  if (file.size > rules.maxUploadBytes)
    return `The video is too large (max ${Math.floor(rules.maxUploadBytes / 1024 / 1024)} MB).`;
  return undefined;
}

/** Resolve the ticket's URL: the real provider gives an absolute URL; the dev stand-in a path on our own API. */
export const resolveUploadUrl = (url: string, apiBase: string, origin: string): string =>
  /^https?:\/\//i.test(url)
    ? url
    : `${(apiBase || origin).replace(/\/+$/, '')}${url.startsWith('/') ? url : `/${url}`}`;
