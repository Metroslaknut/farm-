import { translate, type Catalog, type Params } from '@farmplus/i18n';
import admin from './messages/admin';
import auth from './messages/auth';
import common from './messages/common';
import community from './messages/community';
import farms from './messages/farms';
import home from './messages/home';
import inbox from './messages/inbox';
import layout from './messages/layout';
import live from './messages/live';
import market from './messages/market';
import shop from './messages/shop';
import videos from './messages/videos';
import { getLocale, useLocale } from './locale';

/** One catalog per area of the app, so different parts can be translated independently. */
const catalogs = {
  common,
  layout,
  home,
  auth,
  farms,
  market,
  shop,
  community,
  videos,
  live,
  inbox,
  admin,
};
export type Area = keyof typeof catalogs;
type KeyOf<A extends Area> = (typeof catalogs)[A] extends Catalog<infer K> ? K : never;
export type Translate<A extends Area> = (key: KeyOf<A>, params?: Params) => string;

/** `const t = useT('shop'); t('cart.title')` — re-renders when the language changes. */
export function useT<A extends Area>(area: A): Translate<A> {
  const [locale] = useLocale();
  const catalog = catalogs[area] as Catalog<KeyOf<A>>;
  return (key, params) => translate(catalog, locale, key, params);
}

/** Outside components (rarely needed): uses the current language but does not re-render by itself. */
export function t<A extends Area>(area: A, key: KeyOf<A>, params?: Params): string {
  return translate(catalogs[area] as Catalog<KeyOf<A>>, getLocale(), key, params);
}

export { getLocale, setLocale, useLocale } from './locale';
