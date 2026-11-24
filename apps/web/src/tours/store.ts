import type { TourProgressDTO, TourStatus } from '@farmplus/shared-types';
import { api } from '../api';
import type { TourDefinition } from './types';

/**
 * Where tour progress is kept. Signed in: on the server (`/me/tours`), so a tour seen in one tab or on one device is
 * not shown again elsewhere (refresh tokens are per tab, so browser storage alone would not be enough). Signed out
 * (e.g. on /help before registering): this browser's localStorage, which may be unavailable — then nothing is
 * remembered and the tour simply shows again.
 */
export type Progress = Record<string, Pick<TourProgressDTO, 'version' | 'status' | 'lastStep'>>;

const LOCAL_KEY = 'farmplus.tours';

export function readLocal(): Progress {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Progress) : {};
  } catch {
    return {};
  }
}

function writeLocal(progress: Progress) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(progress));
  } catch {
    /* storage blocked or full: the tour will show again, which is harmless */
  }
}

export async function loadServer(): Promise<Progress> {
  const { tours } = await api.request<{ tours: TourProgressDTO[] }>('GET', '/me/tours');
  return Object.fromEntries(
    tours.map((t) => [t.tourId, { version: t.version, status: t.status, lastStep: t.lastStep }]),
  );
}

/**
 * The progress after leaving `tour` — returned at once, so the caller can use it before it is stored (otherwise the
 * tour could start again while the save is on its way) — and stored in the background.
 */
export function save(
  signedIn: boolean,
  progress: Progress,
  tour: TourDefinition,
  status: TourStatus,
  lastStep: number,
): Progress {
  const next = { ...progress, [tour.id]: { version: tour.version, status, lastStep } };
  if (signedIn)
    void api
      .request('PUT', `/me/tours/${tour.id}`, { body: { version: tour.version, status, lastStep } })
      .catch(() => undefined); // not being able to remember must never break the page
  else writeLocal(next);
  return next;
}

/**
 * `localStorage['farmplus.tours.off'] = '1'` stops tours from starting on their own in this browser (automated tests
 * set it so a tour card does not cover what they check). Starting a tour on request still works.
 */
export function autoStartOff(): boolean {
  try {
    return localStorage.getItem('farmplus.tours.off') === '1';
  } catch {
    return false;
  }
}

/** Already done for this version — or "don't show again", whatever the version. */
export const isDone = (progress: Progress, tour: TourDefinition): boolean => {
  const p = progress[tour.id];
  return !!p && (p.status === 'dismissed_forever' || p.version >= tour.version);
};
