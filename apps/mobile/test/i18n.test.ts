import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { apiErrorMessage } from '@farmplus/i18n';
import { afterEach, describe, expect, it } from 'vitest';
import { toViewError } from '../src/api/errors';
import { oauthErrorMessage } from '../src/auth/oauth';
import { identifierError } from '../src/auth/register-flow';
import { catalogs, t } from '../src/i18n';
import {
  LOCALE_STORAGE_KEY,
  getLocale,
  initLocale,
  onLocaleChange,
  resetLocaleForTests,
  setLocale,
  type LocaleStore,
} from '../src/i18n/locale';
import { AppError, errorText } from '../src/lib/messages';

function fakeStore(initial?: string, overrides: Partial<LocaleStore> = {}) {
  const data = new Map<string, string>(
    initial === undefined ? [] : [[LOCALE_STORAGE_KEY, initial]],
  );
  const store: LocaleStore = {
    isAvailableAsync: async () => true,
    getItemAsync: async (key) => data.get(key) ?? null,
    setItemAsync: async (key, value) => void data.set(key, value),
    ...overrides,
  };
  return { store, data };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const apiError = (status: number | undefined, message: string, code?: string, details?: unknown) =>
  Object.assign(new Error(message), { name: 'ApiClientError', status, code, details });

describe('locale store', () => {
  afterEach(() => resetLocaleForTests());

  it('starts in Thai before the saved choice is read', () => {
    resetLocaleForTests();
    expect(getLocale()).toBe('th');
  });

  it('nothing saved → Thai; an invalid saved value → Thai', async () => {
    resetLocaleForTests();
    expect(await initLocale(fakeStore().store)).toBe('th');
    resetLocaleForTests();
    expect(await initLocale(fakeStore('fr').store)).toBe('th');
    resetLocaleForTests();
    expect(
      await initLocale(
        fakeStore('en', { getItemAsync: () => Promise.reject(new Error('x')) }).store,
      ),
    ).toBe('th');
  });

  it('restores a saved language and remembers a new choice under farmplus.locale', async () => {
    resetLocaleForTests();
    const { store, data } = fakeStore('en');
    expect(await initLocale(store)).toBe('en');
    expect(getLocale()).toBe('en');
    setLocale('th');
    await flush();
    expect(data.get('farmplus.locale')).toBe('th');
  });

  it('a choice made while the saved value is still loading wins', async () => {
    resetLocaleForTests();
    const { store } = fakeStore('en');
    const loading = initLocale(store);
    setLocale('th');
    await loading;
    expect(getLocale()).toBe('th');
  });

  it('works without a secure store (not remembered)', async () => {
    resetLocaleForTests();
    const { store, data } = fakeStore(undefined, { isAvailableAsync: async () => false });
    await initLocale(store);
    setLocale('en');
    await flush();
    expect(getLocale()).toBe('en');
    expect(data.size).toBe(0);
  });

  it('notifies listeners on change (and not when the language stays the same)', () => {
    resetLocaleForTests();
    const seen: string[] = [];
    const off = onLocaleChange(() => seen.push(getLocale()));
    setLocale('en');
    setLocale('en');
    setLocale('th');
    off();
    setLocale('en');
    expect(seen).toEqual(['en', 'th']);
  });
});

describe('catalogs', () => {
  const areas = Object.keys(catalogs) as (keyof typeof catalogs)[];

  it.each(areas)('%s: Thai and English have the same keys, none empty', (area) => {
    const { th, en } = catalogs[area] as { th: Record<string, string>; en: Record<string, string> };
    expect(Object.keys(en).sort()).toEqual(Object.keys(th).sort());
    for (const [key, value] of [...Object.entries(th), ...Object.entries(en)])
      expect(value.trim(), `${area}.${key}`).not.toBe('');
  });

  it('placeholders match between languages', () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const area of areas) {
      const { th, en } = catalogs[area] as {
        th: Record<string, string>;
        en: Record<string, string>;
      };
      for (const key of Object.keys(th))
        expect(names(en[key] ?? ''), `${area}.${key}`).toEqual(names(th[key]!));
    }
  });

  it('every catalog file is registered', () => {
    const files = readdirSync(join(__dirname, '../src/i18n/messages')).map((f) =>
      f.replace(/\.ts$/, ''),
    );
    expect(files.sort()).toEqual([...areas].sort());
  });

  it('t() follows the current language', () => {
    setLocale('th');
    expect(t('tabs', 'tab.home')).toBe('หน้าหลัก');
    setLocale('en');
    expect(t('tabs', 'tab.home')).toBe('Home');
    expect(t('tabs', 'tab.a11y', { title: 'Home' })).toBe('Home tab');
  });
});

describe('error messages', () => {
  it('English keeps the server message (or the validation detail)', () => {
    expect(errorText(apiError(409, 'Already exists', 'CONFLICT'))).toBe('Already exists');
    expect(
      errorText(
        apiError(400, 'Request validation failed', 'VALIDATION', [{ message: 'Too short' }]),
      ),
    ).toBe('Too short');
    expect(errorText('nope')).toBe('Something went wrong');
  });

  it('Thai uses the error code, never the English server text', () => {
    setLocale('th');
    expect(errorText(apiError(409, 'Already exists', 'SOME_CODE'))).toBe(
      apiErrorMessage('th', 'SOME_CODE'),
    );
    expect(errorText(apiError(undefined, 'Network request failed'))).toBe(
      apiErrorMessage('th', 'NETWORK'),
    );
    expect(errorText(new TypeError('x is not a function'))).toBe(apiErrorMessage('th', undefined));
    expect(
      errorText(
        apiError(400, 'Request validation failed', 'VALIDATION', [{ message: 'Too short' }]),
      ),
    ).not.toMatch(/Too short/);
  });

  it('app-written messages are shown as they are in both languages', () => {
    setLocale('th');
    expect(errorText(new AppError('ไฟล์ใหญ่เกินไป'))).toBe('ไฟล์ใหญ่เกินไป');
  });

  it('toViewError is localised', () => {
    setLocale('th');
    expect(toViewError(apiError(undefined, 'x')).message).toMatch(/เชื่อมต่อ FARM\+ ไม่ได้/);
    expect(toViewError(apiError(409, 'Already exists', 'X')).message).not.toMatch(/Already/);
    setLocale('en');
    expect(toViewError(apiError(409, 'Already exists', 'X')).message).toBe('Already exists');
  });

  it('auth flow messages are localised', () => {
    setLocale('th');
    expect(oauthErrorMessage('account_suspended')).toMatch(/ระงับ/);
    expect(oauthErrorMessage('whatever')).toMatch(/ลองใหม่/);
    expect(identifierError('08')).toMatch(/เบอร์โทรศัพท์/);
    setLocale('en');
    expect(oauthErrorMessage('account_suspended')).toMatch(/suspended/);
  });
});
