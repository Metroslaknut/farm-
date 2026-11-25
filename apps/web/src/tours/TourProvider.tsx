import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import type { TourStatus } from '@farmplus/shared-types';
import { useAuth } from '../auth/AuthContext';
import { TOURS, tourById } from './registry';
import { autoStartOff, isDone, loadServer, readLocal, save, type Progress } from './store';
import type { TourContext, TourDefinition, TourStep } from './types';

/** The overlay is its own chunk: pages load it only when a tour is shown. */
const TourOverlay = lazy(() => import('./TourOverlay'));

interface Active {
  tour: TourDefinition;
  steps: TourStep[];
  index: number;
}

interface TourApi {
  /** Tours that run on the current page (for "show this page's tips again"). */
  toursHere: TourDefinition[];
  /** Tours this person may start from anywhere (those with a `startPath`), for the list on /help. */
  startable: TourDefinition[];
  /** Start a tour now, whatever was remembered (goes to its `startPath` first when needed). */
  start: (tourId: string) => void;
}

const Ctx = createContext<TourApi>({ toursHere: [], startable: [], start: () => undefined });
export const useTours = (): TourApi => useContext(Ctx);

/**
 * Whether an element can be seen: not `display:none` / `hidden` (e.g. the desktop menu on a phone, a closed dropdown)
 * and not parked off the side of the screen (an off-canvas drawer). Browsers without `checkVisibility` (and jsdom,
 * which has no layout) count the element as visible.
 */
function visible(el: HTMLElement): boolean {
  if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true })) return false;
  const r = el.getBoundingClientRect();
  return !(r.width > 0 && (r.right <= 0 || r.left >= window.innerWidth));
}

/** The first visible element marked `data-tour="<anchor>"`. */
export const anchorEl = (anchor: string): HTMLElement | null => {
  // Anchors are code-defined (lower-case words and hyphens; checked by test/tours.test.tsx).
  const all = document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`);
  for (const el of all) if (visible(el)) return el;
  return null;
};

const matches = (patterns: string[] | undefined, path: string) =>
  (patterns ?? []).some((r) => matchPath({ path: r, end: true }, path) !== null);
const onRoute = (tour: TourDefinition, path: string) =>
  matches(tour.routes, path) && !matches(tour.notOn, path);

const allowed = (tour: TourDefinition, ctx: TourContext) =>
  (tour.audience === 'guest' ? !ctx.signedIn : tour.audience === 'member' ? ctx.signedIn : true) &&
  (tour.when ? tour.when(ctx) : true);

/** The steps whose element is on the page right now, plus `later` ones (their element comes with the next screen). */
const presentSteps = (tour: TourDefinition) =>
  tour.steps.filter((s) => s.later || anchorEl(s.anchor) !== null);

/** Waits (up to `ms`) until the page has its first step's element and no other dialog is open. */
function whenReady(tour: TourDefinition, signal: AbortSignal, ms = 8000): Promise<boolean> {
  const required = tour.steps.find((s) => !s.optional) ?? tour.steps[0];
  const end = Date.now() + ms;
  return new Promise((resolve) => {
    const check = () => {
      if (signal.aborted) return resolve(false);
      const ready =
        required && anchorEl(required.anchor) && !document.querySelector('dialog[open]');
      if (ready) return resolve(true);
      if (Date.now() > end) return resolve(false);
      setTimeout(check, 250);
    };
    check();
  });
}

/**
 * Runs guided tours: one at a time, started automatically the first time someone opens a page that has one (after the
 * page has loaded and no other dialog is open), or on request. The person moves through it with Next / Back; nothing
 * advances by itself and nothing on the page is pressed for them. Remembers who finished, skipped or dismissed a tour.
 */
export function TourProvider({ children }: { children: ReactNode }) {
  const { status, can, user } = useAuth();
  const signedIn = status === 'authenticated';
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // What has been seen: from the server when signed in (per user), else from this browser.
  const [guest, setGuest] = useState<Progress>(() => readLocal());
  const [server, setServer] = useState<{ userId: string; progress: Progress } | null>(null);
  const userId = user?.id;
  const progress: Progress | null =
    status === 'loading'
      ? null
      : signedIn
        ? server && server.userId === userId
          ? server.progress
          : null
        : guest;
  const setProgress = (next: Progress) =>
    signedIn && userId ? setServer({ userId, progress: next }) : setGuest(next);
  const [nonce, setNonce] = useState(0); // re-runs the start check when a tour is asked for on this page
  const [active, setActive] = useState<Active | null>(null);
  const pending = useRef<string | null>(null); // a tour asked for on another page
  const returnFocus = useRef<HTMLElement | null>(null); // where focus goes back when the tour closes
  const ctx = useMemo<TourContext>(() => ({ signedIn, can }), [signedIn, can]);
  // A `later` step waits for its element (until the person moves the page on): re-render when it appears.
  const [, setAppeared] = useState(0);
  const activeAnchor = active ? active.steps[active.index]!.anchor : null;
  useEffect(() => {
    if (!activeAnchor) return;
    let id = 0;
    const check = () => {
      if (anchorEl(activeAnchor)) setAppeared((n) => n + 1);
      else id = window.setTimeout(check, 250);
    };
    id = window.setTimeout(check, 0);
    return () => window.clearTimeout(id);
  }, [activeAnchor, active]);

  useEffect(() => {
    if (!signedIn || !userId) return;
    let live = true;
    loadServer().then(
      (p) => live && setServer({ userId, progress: p }),
      () => live && setServer({ userId, progress: {} }), // cannot read: behave as if nothing was seen
    );
    return () => {
      live = false;
    };
  }, [signedIn, userId]);

  const toursHere = useMemo(
    () => TOURS.filter((t) => onRoute(t, pathname) && allowed(t, ctx)),
    [pathname, ctx],
  );

  const open = useCallback((tour: TourDefinition) => {
    const steps = presentSteps(tour);
    if (steps.length === 0) return;
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setActive({ tour, steps, index: 0 });
  }, []);

  // Automatic start on a page's first visit, or a tour requested from elsewhere.
  useEffect(() => {
    if (progress === null || active) return;
    const wanted = pending.current ? tourById(pending.current) : undefined;
    const tour =
      wanted && onRoute(wanted, pathname)
        ? wanted
        : autoStartOff()
          ? undefined
          : toursHere.find((t) => !isDone(progress, t));
    if (!tour) return;
    const abort = new AbortController();
    void whenReady(tour, abort.signal).then((ok) => {
      if (!ok) return;
      pending.current = null;
      open(tour);
    });
    return () => abort.abort();
  }, [pathname, progress, toursHere, active, open, nonce]);

  // Leaving the page ends the tour (its elements are gone); it counts as skipped where it was left.
  const finish = useCallback(
    (statusOut: TourStatus, at: number) => {
      if (!active) return;
      const { tour } = active;
      setActive(null);
      const back = returnFocus.current;
      if (back?.isConnected) setTimeout(() => back.focus(), 0);
      if (progress) setProgress(save(signedIn, progress, tour, statusOut, at));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setProgress only picks the store for signedIn/userId
    [active, progress, signedIn, userId],
  );
  useEffect(() => {
    if (!active || onRoute(active.tour, pathname)) return;
    const id = setTimeout(() => finish('skipped', active.index), 0);
    return () => clearTimeout(id);
  }, [pathname, active, finish]);

  const start = useCallback(
    (tourId: string) => {
      const tour = tourById(tourId);
      if (!tour || !allowed(tour, ctx)) return;
      setActive(null);
      if (onRoute(tour, pathname)) {
        pending.current = tour.id;
        setNonce((n) => n + 1); // re-run the start check even when nothing else changed
      } else if (tour.startPath) {
        pending.current = tour.id;
        navigate(tour.startPath);
      }
    },
    [ctx, pathname, navigate],
  );

  const startable = useMemo(() => TOURS.filter((t) => t.startPath && allowed(t, ctx)), [ctx]);
  const api = useMemo(() => ({ toursHere, startable, start }), [toursHere, startable, start]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {active && activeAnchor && anchorEl(activeAnchor) && (
        <Suspense fallback={null}>
          <TourOverlay
            key={active.tour.id}
            tour={active.tour}
            steps={active.steps}
            index={active.index}
            onBack={() => {
              // Back to the nearest earlier step still on the page (a wizard's previous screen is gone).
              let i = active.index - 1;
              while (i >= 0 && !anchorEl(active.steps[i]!.anchor)) i--;
              if (i >= 0) setActive({ ...active, index: i });
            }}
            onNext={() =>
              active.index + 1 < active.steps.length
                ? setActive({ ...active, index: active.index + 1 })
                : finish('completed', active.index)
            }
            onSkip={() => finish('skipped', active.index)}
            onDismissForever={() => finish('dismissed_forever', active.index)}
          />
        </Suspense>
      )}
    </Ctx.Provider>
  );
}
