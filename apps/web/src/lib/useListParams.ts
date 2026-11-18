import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

export type ListParams = Record<string, string>;

/**
 * List state (search, filters, sort, page) lives in the URL so views are shareable and survive reloads.
 * Changing anything other than `page` resets to page 1.
 */
export function useListParams(
  defaults: ListParams,
): [ListParams, (patch: Partial<ListParams>) => void] {
  const [search, setSearch] = useSearchParams();
  const params = useMemo(() => {
    const out: ListParams = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const value = search.get(key);
      if (value !== null) out[key] = value;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const update = useCallback(
    (patch: Partial<ListParams>) => {
      setSearch(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined || value === '' || value === defaults[key]) next.delete(key);
            else next.set(key, value);
          }
          if (!('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setSearch],
  );
  return [params, update];
}
