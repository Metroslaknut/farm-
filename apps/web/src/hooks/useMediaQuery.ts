import { useSyncExternalStore } from 'react';
import { minWidthQuery, type Breakpoint } from '../themes/breakpoints';

/** Subscribe to a CSS media query. Returns false where matchMedia does not exist (tests/SSR). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mql = typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
      mql?.addEventListener('change', notify);
      return () => mql?.removeEventListener('change', notify);
    },
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** True when the viewport is at least the given breakpoint wide. */
export const useMinWidth = (bp: Breakpoint): boolean => useMediaQuery(minWidthQuery(bp));
