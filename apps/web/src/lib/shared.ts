const inflight = new Map<string, Promise<unknown>>();

/**
 * Shares one request among callers that ask for the same thing at the same time (e.g. the layout and the page both
 * reading the farm). Nothing is cached once it settles, so a later call always reads fresh data.
 */
export function shared<T>(key: string, run: () => Promise<T>): Promise<T> {
  const hit = inflight.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const p = run();
  inflight.set(key, p);
  // Callers get `p` itself (no extra hop); the cleanup chain swallows the rejection it would otherwise re-raise.
  p.finally(() => inflight.delete(key)).catch(() => undefined);
  return p;
}

const recent = new Map<string, { at: number; value: Promise<unknown> }>();
let generation = 0;

/**
 * Like `shared`, and a successful result is also reused for `keepMs` afterwards, so a page that mounts right
 * after its layout (or a return to a page) does not read the same thing again. Only for data a stale copy of
 * which is harmless for a few seconds; the API still checks every action. Failures are never kept, and
 * `forgetRecent()` drops everything (called on every change the user makes and when the signed-in user changes).
 */
export function sharedRecent<T>(key: string, run: () => Promise<T>, keepMs = 5_000): Promise<T> {
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < keepMs) return hit.value as Promise<T>;
  const gen = generation;
  const p = shared(key, run);
  p.then(
    // A change made while this was in flight may not be reflected in it: keep it only if nothing changed.
    () => gen === generation && recent.set(key, { at: Date.now(), value: p }),
    () => undefined,
  );
  return p;
}

/** Drops every result kept by `sharedRecent` (requests in flight are not cached when they settle). */
export function forgetRecent(): void {
  generation += 1;
  recent.clear();
}
