/**
 * FARM+ translations shared by Web and Mobile. Tiny on purpose (no runtime dependency): a catalog is a pair of flat
 * Thai and English message maps with identical keys; `{name}` placeholders are filled from params.
 */
export const LOCALES = ['th', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
/** First visit: Thai. The user's choice is remembered per device. */
export const DEFAULT_LOCALE: Locale = 'th';

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value);

export type Params = Record<string, string | number>;

/** Thai is the source of truth; English must provide every Thai key (and nothing else). */
export interface Catalog<K extends string = string> {
  th: Record<K, string>;
  en: Record<K, string>;
}
export function defineMessages<K extends string>(catalog: Catalog<K>): Catalog<K> {
  return catalog;
}

/** Replaces `{name}` with `params.name`; unknown placeholders are left visible so they are noticed. */
export function format(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

export function translate<K extends string>(
  catalog: Catalog<K>,
  locale: Locale,
  key: K,
  params?: Params,
): string {
  return format(catalog[locale][key] ?? catalog.th[key] ?? key, params);
}

/** BCP 47 tag for Intl (dates, numbers): Thai uses the Buddhist calendar, as Thai users expect. */
export const intlLocale = (locale: Locale): string => (locale === 'th' ? 'th-TH' : 'en-GB');

export function formatDate(
  value: string | number | Date,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(intlLocale(locale), { timeZone: 'Asia/Bangkok', ...options });
}

export function formatDateTime(value: string | number | Date, locale: Locale): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(intlLocale(locale), {
        timeZone: 'Asia/Bangkok',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

export function formatNumber(value: number, locale: Locale): string {
  return value.toLocaleString(intlLocale(locale));
}
