import { useSyncExternalStore } from 'react';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@farmplus/i18n';

/**
 * The UI language, shared by every screen without a provider: components read it with `useLocale()` / `useT()` and
 * re-render when it changes (tab titles and headers included). Remembered per device in the secure store.
 *
 * Reading the store is async, so the app starts in Thai (the default) and switches once the saved choice is known;
 * the root layout keeps the splash screen up until then (`useLocaleReady()`), so nobody sees the wrong language.
 */
export const LOCALE_STORAGE_KEY = 'farmplus.locale';

/** The part of expo-secure-store we need (tests pass a fake). */
export interface LocaleStore {
  isAvailableAsync(): Promise<boolean>;
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
}

const listeners = new Set<() => void>();
let current: Locale = DEFAULT_LOCALE;
let ready = false;
let store: LocaleStore | undefined;
/** True once the user picked a language in this session: a late read of the saved value must not undo it. */
let chosen = false;

const notify = () => listeners.forEach((listener) => listener());

/** Current language for code outside React (error messages, formatters). */
export const getLocale = (): Locale => current;

export function setLocale(locale: Locale): void {
  chosen = true;
  if (locale !== current) {
    current = locale;
    notify();
  }
  store?.setItemAsync(LOCALE_STORAGE_KEY, locale).catch(() => undefined); // not remembered: still switches now
}

/** Load the saved language (once, at startup). Missing, invalid or unreadable → Thai. */
export async function initLocale(secureStore: LocaleStore): Promise<Locale> {
  try {
    if (await secureStore.isAvailableAsync().catch(() => false)) {
      store = secureStore;
      const saved = await secureStore.getItemAsync(LOCALE_STORAGE_KEY).catch(() => null);
      if (!chosen && isLocale(saved) && saved !== current) {
        current = saved;
      }
    }
  } finally {
    ready = true;
    notify();
  }
  return current;
}

/** Test helper: forget the store and go back to the first-launch state. */
export function resetLocaleForTests(): void {
  current = DEFAULT_LOCALE;
  ready = false;
  store = undefined;
  chosen = false;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function useLocale(): [Locale, (locale: Locale) => void] {
  return [useSyncExternalStore(subscribe, getLocale, getLocale), setLocale];
}

/** False until the saved language has been read (the root layout keeps the splash screen up meanwhile). */
const isReady = () => ready;
export function useLocaleReady(): boolean {
  return useSyncExternalStore(subscribe, isReady, isReady);
}

/** Subscribe outside React (tests, non-component code). Returns the unsubscribe function. */
export const onLocaleChange = subscribe;
