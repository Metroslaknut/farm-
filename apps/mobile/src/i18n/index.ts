import { translate, type Catalog, type Params } from '@farmplus/i18n';
import auth from './messages/auth';
import common from './messages/common';
import community from './messages/community';
import errors from './messages/errors';
import farms from './messages/farms';
import home from './messages/home';
import market from './messages/market';
import profile from './messages/profile';
import tabs from './messages/tabs';
import videos from './messages/videos';
import { getLocale, useLocale } from './locale';

/** One catalog per area of the app, so different parts can be translated independently. */
export const catalogs = {
  common,
  tabs,
  home,
  auth,
  profile,
  errors,
  farms,
  market,
  community,
  videos,
};
export type Area = keyof typeof catalogs;
export type KeyOf<A extends Area> = (typeof catalogs)[A] extends Catalog<infer K> ? K : never;
export type Translate<A extends Area> = (key: KeyOf<A>, params?: Params) => string;

/** `const t = useT('market'); t('listing.title')` — re-renders when the language changes. */
export function useT<A extends Area>(area: A): Translate<A> {
  const [locale] = useLocale();
  const catalog = catalogs[area] as Catalog<KeyOf<A>>;
  return (key, params) => translate(catalog, locale, key, params);
}

/** Outside components (pure helpers, alerts): uses the current language but does not re-render by itself. */
export function t<A extends Area>(area: A, key: KeyOf<A>, params?: Params): string {
  return translate(catalogs[area] as Catalog<KeyOf<A>>, getLocale(), key, params);
}

export {
  LOCALE_STORAGE_KEY,
  getLocale,
  initLocale,
  onLocaleChange,
  setLocale,
  useLocale,
  useLocaleReady,
} from './locale';
