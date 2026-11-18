export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'farmplus.theme';
export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

const isPreference = (value: unknown): value is ThemePreference =>
  typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);

function readStored(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(value) ? value : 'system';
  } catch {
    return 'system'; // storage blocked (private mode, sandbox): fall back to following the OS
  }
}

const systemQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

export interface ThemeSnapshot {
  preference: ThemePreference;
  resolved: ResolvedTheme;
}

const listeners = new Set<() => void>();
let snapshot: ThemeSnapshot | null = null;
let unsubscribeSystem: (() => void) | null = null;

function compute(preference: ThemePreference): ThemeSnapshot {
  const resolved: ResolvedTheme =
    preference === 'system' ? (systemQuery()?.matches ? 'dark' : 'light') : preference;
  return { preference, resolved };
}

/** Reflect the choice on <html>. "system" removes the attribute so the OS setting applies. */
function apply(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
}

function publish(next: ThemeSnapshot): void {
  if (snapshot && snapshot.preference === next.preference && snapshot.resolved === next.resolved)
    return;
  snapshot = next;
  listeners.forEach((l) => l());
}

export const themeStore = {
  getSnapshot(): ThemeSnapshot {
    if (!snapshot) {
      snapshot = compute(readStored());
      apply(snapshot.preference);
    }
    return snapshot;
  },
  setPreference(preference: ThemePreference): void {
    try {
      if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      /* not persisted, still applied for this page view */
    }
    apply(preference);
    publish(compute(preference));
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    if (listeners.size === 1) {
      // While following the OS, react to OS theme changes live.
      const query = systemQuery();
      const onChange = () => {
        const current = themeStore.getSnapshot();
        if (current.preference === 'system') publish(compute('system'));
      };
      query?.addEventListener('change', onChange);
      unsubscribeSystem = () => query?.removeEventListener('change', onChange);
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        unsubscribeSystem?.();
        unsubscribeSystem = null;
      }
    };
  },
  /** Test helper: forget cached state. */
  reset(): void {
    snapshot = null;
  },
};
