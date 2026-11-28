import admin from './messages/admin';
import analytics from './messages/analytics';
import farms from './messages/farms';
import market from './messages/market';
import shop from './messages/shop';
import { registerAreaCatalogs } from '.';

/** The area catalogs (see i18n/index.ts): importing this module makes them available to useT / t. */
registerAreaCatalogs({ admin, analytics, farms, market, shop });
