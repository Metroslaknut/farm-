import { useCallback, useEffect, useRef, useState } from 'react';
import type { CursorPage } from '@farmplus/shared-types';
import { api } from '../../api';
import { errorMessage } from '../../lib/format';

/**
 * Cursor-paginated list: loads the first page when `key` changes and appends further pages on `loadMore()`.
 * A response for an outdated key/request is ignored, so switching tabs quickly never mixes lists.
 */
export function usePagedList<T extends { id: string }>(
  path: string,
  query: Record<string, string | number | undefined>,
  enabled = true,
) {
  const [items, setItems] = useState<T[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const key = `${path}?${JSON.stringify(query)}`;
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  });

  const fetchPage = useCallback(
    async (cursor: string | undefined, replace: boolean) => {
      const mine = ++generation.current;
      setLoading(true);
      setError(undefined);
      try {
        const page = await api.request<CursorPage<T>>('GET', path, {
          query: { ...queryRef.current, ...(cursor ? { cursor } : {}) },
        });
        if (mine !== generation.current) return;
        setItems((prev) => {
          if (replace) return page.items;
          const seen = new Set(prev.map((i) => i.id));
          return [...prev, ...page.items.filter((i) => !seen.has(i.id))];
        });
        setNext(page.nextCursor);
      } catch (e) {
        if (mine === generation.current) setError(errorMessage(e));
      } finally {
        if (mine === generation.current) setLoading(false);
      }
    },
    [path],
  );

  useEffect(() => {
    // Synchronising with the API whenever the list's key changes is exactly what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (enabled) void fetchPage(undefined, true);
  }, [key, fetchPage, enabled]);

  return {
    items,
    loading,
    error,
    hasMore: next !== undefined,
    loadMore: () => (next ? fetchPage(next, false) : Promise.resolve()),
    reload: () => fetchPage(undefined, true),
    replaceItem: (item: T) => setItems((all) => all.map((i) => (i.id === item.id ? item : i))),
    removeItem: (id: string) => setItems((all) => all.filter((i) => i.id !== id)),
    prepend: (item: T) => setItems((all) => [item, ...all.filter((i) => i.id !== item.id)]),
  };
}
