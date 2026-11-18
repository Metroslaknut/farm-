import { useSyncExternalStore } from 'react';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@farmplus/i18n';

/**
 * The UI language, shared by every part of the web app (public pages, admin, sub-apps) without a provider:
 * components read it with `useLocale()` / `useT()` and re-render when it changes. Remembered per browser.
 */
const STORAGE_KEY = 'farmplus.locale';
const listeners = new Set<() => void>();

function stored(): Locale {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isLocale(value) ? value : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE; // storage blocked (private mode): Thai, not remembered
  }
}

let current: Locale = stored();
const applyDocumentLang = (locale: Locale) => {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
};
applyDocumentLang(current);

/** Current language for code outside React (error messages, formatters). */
export const getLocale = (): Locale => current;

export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, locale);
  } catch {
    /* not remembered: still switches for this visit */
  }
  applyDocumentLang(locale);
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useLocale(): [Locale, (locale: Locale) => void] {
  return [useSyncExternalStore(subscribe, getLocale, getLocale), setLocale];
}
