import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import {
  ORDER_LIMITS,
  type Destination,
  type ListingDTO,
  type ShippingOption,
  type ShippingQuoteDTO,
} from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { conflict, notFound } from '../../lib/errors';
import { Listing, ShippingQuote, type ListingDoc, type ShippingQuoteDoc } from '../../models';
import { invalid } from '../community/shared';
import { isSellerSide } from '../marketplace/common';
import type { ShippingProvider } from './provider';

const norm = (s: string) => s.trim().toLowerCase();

/** What a quote depends on. If any of it changes, existing quotes are stale and must be recalculated. */
export const termsHash = (
  l: Pick<ListingDoc, 'shipping' | 'deliveryOptions' | 'askingPriceMinor'>,
): string =>
  createHash('sha256')
    .update(JSON.stringify({ s: l.shipping ?? null, d: [...l.deliveryOptions].sort() }))
    .digest('hex');

interface Computed {
  options: ShippingOption[];
  unavailableReason?: string | undefined;
}

/**
 * Quote sources, in order of trust: (1) the SELLER's own declared delivery terms on the listing, (2) a configured provider.
 * Nothing is ever estimated by FARM+ itself; a transit time is shown only when the seller/provider gave one, and then flagged as an estimate.
 */
export async function computeOptions(
  listing: ListingDoc,
  destination: Destination,
  provider: ShippingProvider | null,
): Promise<Computed> {
  if (!listing.deliveryOptions.includes('delivery') || !listing.shipping)
    return {
      options: [],
      unavailableReason: 'The seller does not offer delivery for this animal (pickup only).',
    };
  const cfg = listing.shipping;
  const options: ShippingOption[] = [];
  const requirements = cfg.requirements ?? [];

  let price: number | undefined;
  if (cfg.mode === 'flat') price = cfg.flatPriceMinor;
  else
    price = cfg.provinces?.find((p) => norm(p.province) === norm(destination.province))?.priceMinor;
  if (price !== undefined) {
    options.push({
      id: 'seller',
      source: 'seller_rule',
      label: 'Delivery arranged by the seller',
      priceMinor: price,
      currency: listing.currency,
      ...(cfg.estimatedDays ? { estimatedDays: cfg.estimatedDays } : {}),
      isEstimate: Boolean(cfg.estimatedDays),
      requirements,
    });
  }
  if (provider) {
    const rates = await provider.quote({
      listing: {
        id: String(listing._id),
        animal: {
          ...listing.animal,
          animalTypeId: String(listing.animal.animalTypeId),
          birthDate: null,
        },
      } as Pick<ListingDTO, 'id' | 'animal'>,
      destination,
    });
    for (const r of rates)
      options.push({
        id: `provider:${r.id}`,
        source: 'provider',
        label: r.label,
        priceMinor: r.priceMinor,
        currency: listing.currency,
        ...(r.estimatedDays ? { estimatedDays: r.estimatedDays } : {}),
        isEstimate: Boolean(r.estimatedDays),
        requirements: [...new Set([...(r.requirements ?? []), ...requirements])],
      });
  }
  if (options.length === 0)
    return {
      options,
      unavailableReason: `The seller does not deliver to ${destination.province}.`,
    };
  return { options };
}

const toDTO = (q: ShippingQuoteDoc): ShippingQuoteDTO => ({
  id: String(q._id),
  listingId: String(q.listingId),
  destination: {
    province: q.destination.province,
    ...(q.destination.district ? { district: q.destination.district } : {}),
    ...(q.destination.postalCode ? { postalCode: q.destination.postalCode } : {}),
  },
  options: q.options.map((o) => ({
    id: o.optionId,
    source: o.source,
    label: o.label,
    priceMinor: o.priceMinor,
    currency: o.currency,
    ...(o.estimatedDays ? { estimatedDays: o.estimatedDays } : {}),
    isEstimate: o.isEstimate,
    requirements: o.requirements,
  })),
  expiresAt: q.expiresAt.toISOString(),
  ...(q.unavailableReason ? { unavailableReason: q.unavailableReason } : {}),
});

/** A quote is for one buyer, one listing and one destination region, and expires quickly. */
export async function createQuote(
  actor: Actor,
  input: { listingId: string; destination: Destination },
  provider: ShippingProvider | null,
): Promise<ShippingQuoteDTO> {
  const listing = await Listing.findById(input.listingId);
  if (listing && (await isSellerSide(actor.userId, listing.farmId)))
    throw conflict('You cannot buy from your own farm', 'OWN_LISTING');
  const mine = listing?.reservation && String(listing.reservation.buyerId) === actor.userId;
  if (!listing || !(listing.status === 'ACTIVE' || (listing.status === 'RESERVED' && mine)))
    throw notFound('Listing not found');
  if (await isSellerSide(actor.userId, listing.farmId))
    throw conflict('You cannot buy from your own farm', 'OWN_LISTING');
  const computed = await computeOptions(listing, input.destination, provider);
  const now = Date.now();
  const expiresAt = new Date(now + ORDER_LIMITS.quoteMinutes * 60_000);
  const q = await ShippingQuote.create({
    buyerId: actor.userId,
    listingId: listing._id,
    destination: {
      province: input.destination.province,
      district: input.destination.district ?? null,
      postalCode: input.destination.postalCode ?? null,
    },
    options: computed.options.map(({ id, ...o }) => ({
      ...o,
      optionId: id,
      estimatedDays: o.estimatedDays ?? null,
    })),
    termsHash: termsHash(listing),
    unavailableReason: computed.unavailableReason ?? null,
    expiresAt,
    purgeAt: new Date(expiresAt.getTime() + 7 * 86_400_000),
  });
  return toDTO(q);
}

export interface ChosenOption {
  quote: ShippingQuoteDoc;
  option: ShippingQuoteDoc['options'][number];
}

/**
 * Re-validate a quote at checkout. It must be this buyer's, unused, unexpired, for the same destination region and computed from
 * the listing's CURRENT shipping terms — otherwise the buyer must get a fresh quote (`409 QUOTE_STALE`).
 */
export async function useQuote(
  buyerId: string,
  listing: ListingDoc,
  quoteId: string,
  optionId: string,
  destination: Destination,
): Promise<ChosenOption> {
  const quote = await ShippingQuote.findOne({
    _id: new Types.ObjectId(quoteId),
    buyerId,
    listingId: listing._id,
  });
  if (!quote) throw invalid('quoteId', 'Unknown shipping quote');
  const stale = (why: string) => conflict(`${why}: get a new shipping quote`, 'QUOTE_STALE');
  if (quote.usedByOrderId) throw stale('This quote was already used');
  if (quote.expiresAt < new Date()) throw stale('This quote expired');
  if (quote.termsHash !== termsHash(listing)) throw stale('The seller changed the delivery terms');
  if (norm(quote.destination.province) !== norm(destination.province))
    throw stale('The delivery address is in a different province than the quote');
  const option = quote.options.find((o) => o.optionId === optionId);
  if (!option) throw invalid('optionId', 'Unknown shipping option');
  return { quote, option };
}
