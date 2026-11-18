import type { Page } from '@farmplus/shared-types';
import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { toViewError, type ViewError } from '@/api/errors';
import { useNetwork } from '@/network/NetworkProvider';
import { hasMorePages, mergePage } from './paging';

export interface PagedList<T> {
  items: T[];
  total: number;
  /** First page of the current query is loading. */
  loading: boolean;
  loadingMore: boolean;
  error: ViewError | undefined;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

interface State<T> {
  key: string;
  items: T[];
  total: number;
  page: number;
  error?: ViewError;
  loadingMore: boolean;
}

/**
 * Infinite list over a paged API: page 1 on mount and whenever `deps` change, then `loadMore()` appends.
 * Stale responses are discarded (key + abort), and a reconnect reloads from the start.
 */
export function usePagedList<T extends { id: string }>(
  fetchPage: (page: number, signal: AbortSignal) => Promise<Page<T>>,
  deps: DependencyList,
): PagedList<T> {
  const { isOnline } = useNetwork();
  const [tick, setTick] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [wasOnline, setWasOnline] = useState(isOnline);
  if (wasOnline !== isOnline) {
    setWasOnline(isOnline);
    if (isOnline) setEpoch((e) => e + 1);
  }

  const key = `${JSON.stringify(deps)}#${tick}#${epoch}`;
  const [state, setState] = useState<State<T>>({
    key: '',
    items: [],
    total: 0,
    page: 0,
    loadingMore: false,
  });
  const fetchRef = useRef(fetchPage);
  const keyRef = useRef(key);
  useEffect(() => {
    fetchRef.current = fetchPage;
    keyRef.current = key;
  });

  useEffect(() => {
    const controller = new AbortController();
    fetchRef
      .current(1, controller.signal)
      .then(
        (res) =>
          !controller.signal.aborted &&
          setState({ key, items: res.items, total: res.total, page: 1, loadingMore: false }),
      )
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            key,
            items: [],
            total: 0,
            page: 0,
            loadingMore: false,
            error: toViewError(error),
          });
      });
    return () => controller.abort();
  }, [key]);

  const current = state.key === key;
  const loadMore = useCallback(() => {
    if (
      !current ||
      state.loadingMore ||
      state.error ||
      !hasMorePages(state.items.length, state.total)
    )
      return;
    const next = state.page + 1;
    const requestKey = key;
    setState((s) => ({ ...s, loadingMore: true }));
    fetchRef
      .current(next, new AbortController().signal)
      .then((res) => {
        if (keyRef.current !== requestKey) return; // the query changed meanwhile
        setState((s) => ({
          ...s,
          items: mergePage(s.items, res.items, next),
          total: res.total,
          page: next,
          loadingMore: false,
        }));
      })
      .catch((error: unknown) => {
        if (keyRef.current === requestKey)
          setState((s) => ({ ...s, loadingMore: false, error: toViewError(error) }));
      });
  }, [current, key, state]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return {
    items: current ? state.items : [],
    total: current ? state.total : 0,
    loading: !current,
    loadingMore: current && state.loadingMore,
    error: current ? state.error : undefined,
    hasMore: current && hasMorePages(state.items.length, state.total),
    loadMore,
    reload,
  };
}
