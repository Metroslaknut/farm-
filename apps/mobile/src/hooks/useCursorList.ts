import type { CursorPage } from '@farmplus/shared-types';
import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { toViewError, type ViewError } from '@/api/errors';
import { mergeCursorPage } from '@/lib/community';
import { useNetwork } from '@/network/NetworkProvider';

export interface CursorList<T> {
  items: T[];
  loading: boolean;
  loadingMore: boolean;
  error: ViewError | undefined;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
  replaceItem: (item: T) => void;
  removeItem: (id: string) => void;
  prepend: (item: T) => void;
}

interface State<T> {
  key: string;
  items: T[];
  next?: string | undefined;
  error?: ViewError | undefined;
  loadingMore: boolean;
}

/**
 * Infinite list over a cursor-paginated API. First page on mount / when `deps` change, `loadMore()` follows the
 * cursor. A response for an outdated query is discarded; a reconnect reloads from the start.
 */
export function useCursorList<T extends { id: string }>(
  fetchPage: (cursor: string | undefined, signal: AbortSignal) => Promise<CursorPage<T>>,
  deps: DependencyList,
): CursorList<T> {
  const { isOnline } = useNetwork();
  const [tick, setTick] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [wasOnline, setWasOnline] = useState(isOnline);
  if (wasOnline !== isOnline) {
    setWasOnline(isOnline);
    if (isOnline) setEpoch((e) => e + 1);
  }
  const key = `${JSON.stringify(deps)}#${tick}#${epoch}`;
  const [state, setState] = useState<State<T>>({ key: '', items: [], loadingMore: false });
  const fetchRef = useRef(fetchPage);
  const keyRef = useRef(key);
  useEffect(() => {
    fetchRef.current = fetchPage;
    keyRef.current = key;
  });

  useEffect(() => {
    const controller = new AbortController();
    fetchRef
      .current(undefined, controller.signal)
      .then(
        (page) =>
          !controller.signal.aborted &&
          setState({ key, items: page.items, next: page.nextCursor, loadingMore: false }),
      )
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({ key, items: [], loadingMore: false, error: toViewError(error) });
      });
    return () => controller.abort();
  }, [key]);

  const current = state.key === key;
  const loadMore = useCallback(() => {
    if (!current || state.loadingMore || state.error || !state.next) return;
    const requestKey = key;
    const cursor = state.next;
    setState((s) => ({ ...s, loadingMore: true }));
    fetchRef
      .current(cursor, new AbortController().signal)
      .then((page) => {
        if (keyRef.current !== requestKey) return;
        setState((s) => ({
          ...s,
          items: mergeCursorPage(s.items, page, false),
          next: page.nextCursor,
          loadingMore: false,
        }));
      })
      .catch((error: unknown) => {
        if (keyRef.current === requestKey)
          setState((s) => ({ ...s, loadingMore: false, error: toViewError(error) }));
      });
  }, [current, key, state]);

  return {
    items: current ? state.items : [],
    loading: !current,
    loadingMore: current && state.loadingMore,
    error: current ? state.error : undefined,
    hasMore: current && state.next !== undefined,
    loadMore,
    reload: useCallback(() => setTick((t) => t + 1), []),
    replaceItem: (item) =>
      setState((s) => ({ ...s, items: s.items.map((i) => (i.id === item.id ? item : i)) })),
    removeItem: (id) => setState((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) })),
    prepend: (item) =>
      setState((s) => ({ ...s, items: [item, ...s.items.filter((i) => i.id !== item.id)] })),
  };
}
