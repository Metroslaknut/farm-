import { useCallback, useSyncExternalStore } from 'react';
import { themeStore, type ResolvedTheme, type ThemePreference } from '../themes';

export interface UseTheme {
  /** What the user chose: light, dark, or system (follow the OS). */
  preference: ThemePreference;
  /** What is actually showing right now. */
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

/** Theme state shared by every component (one external store, persisted in localStorage). */
export function useTheme(): UseTheme {
  const { preference, resolved } = useSyncExternalStore(
    themeStore.subscribe,
    themeStore.getSnapshot,
    themeStore.getSnapshot,
  );
  const setPreference = useCallback((next: ThemePreference) => themeStore.setPreference(next), []);
  return { preference, resolved, setPreference };
}
