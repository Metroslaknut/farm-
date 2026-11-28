import { translate, type Catalog, type Params } from '@farmplus/i18n';
import type admin from './messages/admin';
import type analytics from './messages/analytics';
import auth from './messages/auth';
import common from './messages/common';
import community from './messages/community';
import type farms from './messages/farms';
import help from './messages/help';
import home from './messages/home';
import inbox from './messages/inbox';
import layout from './messages/layout';
import live from './messages/live';
import type market from './messages/market';
import type shop from './messages/shop';
import tours from './messages/tours';
import videos from './messages/videos';
import { getLocale, useLocale } from './locale';

/** One catalog per area of the app, so different parts can be translated independently. */
const eager = {
  common,
  layout,
  home,
  help,
  auth,
  community,
  videos,
  live,
  inbox,
  tours,
};

/**
 * The five big catalogs (farm, admin, market, shop, dashboards: about 70% of all text) are not needed on the home page:
 * they load with the first area page (`./areaCatalogs`, fetched together with every lazily loaded area in main.tsx)
 * instead of with the site's first script (staging QA #20).
 */
export interface AreaCatalogs {
  admin: typeof admin;
  analytics: typeof analytics;
  farms: typeof farms;
  market: typeof market;
  shop: typeof shop;
}
type Catalogs = typeof eager & AreaCatalogs;
const catalogs: Partial<Catalogs> = { ...eager };

export function registerAreaCatalogs(area: AreaCatalogs): void {
  Object.assign(catalogs, area);
}

function catalogOf<A extends Area>(area: A): Catalog<KeyOf<A>> {
  const catalog = catalogs[area];
  // Every page that uses an area catalog is loaded after it (main.tsx); this only fires on a wiring mistake.
  if (!catalog) throw new Error(`The "${area}" texts are not loaded`);
  return catalog as Catalog<KeyOf<A>>;
}

export type Area = keyof Catalogs;
type KeyOf<A extends Area> = Catalogs[A] extends Catalog<infer K> ? K : never;
export type Translate<A extends Area> = (key: KeyOf<A>, params?: Params) => string;

/** `const t = useT('shop'); t('cart.title')` — re-renders when the language changes. */
export function useT<A extends Area>(area: A): Translate<A> {
  const [locale] = useLocale();
  const catalog = catalogOf(area);
  return (key, params) => translate(catalog, locale, key, params);
}

/** Outside components (rarely needed): uses the current language but does not re-render by itself. */
export function t<A extends Area>(area: A, key: KeyOf<A>, params?: Params): string {
  return translate(catalogOf(area), getLocale(), key, params);
}

export { getLocale, setLocale, useLocale } from './locale';
