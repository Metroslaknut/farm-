import { humanize } from '@farmplus/shared-utils';
import { getLocale, t, type KeyOf } from '@/i18n';
import market from '@/i18n/messages/market';

/**
 * Names of marketplace / order values shown to users (statuses, events, requirements…), in the current language.
 * Unknown values (a new status the app does not know yet, free text) fall back to the humanized value, as before.
 */
type MarketKey = KeyOf<'market'>;

const known = (key: string): key is MarketKey => key in market.th;

function label(group: string, value: string | null | undefined, fallback?: string): string {
  if (value == null) return '';
  const key = `${group}.${value}`;
  return known(key) ? t('market', key) : (fallback ?? humanize(value));
}

export const listingStatusLabel = (status: string) =>
  label('listingStatus', status, humanize(status.toLowerCase()));
export const negotiationStatusLabel = (status: string) => label('negotiationStatus', status);
/** What a party did in a negotiation ("made an offer"); unknown types are shown as they come. */
export const negotiationEventLabel = (type: string) => label('negotiationEvent', type, type);
export const orderStatusLabel = (status: string) =>
  label('orderStatus', status, humanize(status.toLowerCase()));
export const shipmentStatusLabel = (status: string) => label('shipmentStatus', status);
/** Who recorded a shipment event ("carrier" for the provider). */
export const shipmentSourceLabel = (source: string) => label('shipmentSource', source, source);
export const fulfillmentLabel = (method: string) => label('fulfillment', method);
export const sexLabel = (sex: string) => label('sex', sex);
export const requirementLabel = (requirement: string) => label('requirement', requirement);
/** Lower-case party name used inside sentences: "(buyer)", "Waiting for the seller." */
export const partyLabel = (party: string | undefined) =>
  party === undefined ? String(party) : label('party', party, party);
/** Who changed an order's status (buyer, seller, payment, shipping, system). */
export const actorLabel = (actor: string) => label('actor', actor);
/** A system reason code is translated; a reason typed by a person is shown as written (humanized, as before). */
export const orderReasonLabel = (reason: string) => label('orderReason', reason);

/** "3 days" / "2–4 days" for an estimate. */
export function daysText(d?: { min: number; max: number }): string {
  if (!d) return '';
  return d.min === d.max
    ? t('market', 'common.days', { n: d.min })
    : t('market', 'common.daysRange', { min: d.min, max: d.max });
}

/** Localises `formatAge` output ("3 y 2 m", "5 m", "12 d"). */
export function ageText(age: string | undefined): string | undefined {
  if (!age) return age;
  let m = /^(\d+) y (\d+) m$/.exec(age);
  if (m) return t('market', 'listing.age.yearsMonths', { y: m[1]!, m: m[2]! });
  m = /^(\d+) y$/.exec(age);
  if (m) return t('market', 'listing.age.years', { n: m[1]! });
  m = /^(\d+) m$/.exec(age);
  if (m) return t('market', 'listing.age.months', { n: m[1]! });
  m = /^(\d+) d$/.exec(age);
  if (m) return t('market', 'listing.age.days', { n: m[1]! });
  return age;
}

/** Shipping texts written by the server in English: the known ones are translated, others shown as they come. */
export function shippingLabelText(text: string): string {
  return text === market.en['server.sellerDelivery'] ? t('market', 'server.sellerDelivery') : text;
}

/** Why a delivery quote has no option; unknown reasons get a generic message in Thai (no English on a Thai screen). */
export function unavailableReasonText(reason: string | null | undefined): string {
  if (!reason) return t('market', 'checkout.noOption');
  if (reason === market.en['server.pickupOnly']) return t('market', 'server.pickupOnly');
  const to = /^The seller does not deliver to (.+)\.$/.exec(reason);
  if (to) return t('market', 'server.noDeliveryTo', { province: to[1]! });
  // English keeps the server's own text; Thai shows the generic Thai message.
  return getLocale() === 'en' ? reason : t('market', 'checkout.noOption');
}
