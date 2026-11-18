import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Seeds a page's filter state from the URL (`/shop?q=…`, links from the site header and home page) and re-seeds it
 * whenever the URL query changes while the page stays mounted (a new header search on the same page). The page keeps
 * owning its draft/applied state; this only reports "the URL asked for these filters".
 */
export function useUrlSeed<T>(
  read: (search: URLSearchParams) => T,
  onChange: (seed: T) => void,
): T {
  const [search] = useSearchParams();
  const key = search.toString();
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    // Adjusting state while rendering (React's documented pattern for "reset when a prop changes").
    setSeen(key);
    onChange(read(search));
  }
  return read(search);
}
