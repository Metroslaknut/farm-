import { Types } from 'mongoose';
import { sellerSideUserIds } from '../notifications/events';
import { notify } from '../notifications/service';
import {
  OPEN_LISTING_STATUSES,
  type AnimalStatus,
  type CursorPage,
  type FavoriteResult,
  type ListingDTO,
  type ListingEventDTO,
  type ListingStatus,
  type SellEligibilityDTO,
} from '@farmplus/shared-types';
import type { CreateListingInput, UpdateListingInput } from '@farmplus/validation';
import type { Actor } from '../../context';
import { HttpError, conflict, forbidden, notFound } from '../../lib/errors';
import {
  Animal,
  AnimalType,
  FarmMember,
  Listing,
  ListingFavorite,
  Negotiation,
  type ListingDoc,
} from '../../models';
import { recordAudit } from '../../services/audit.service';
import { assertMediaUrlAllowed, type MediaPolicy } from '../animals/animals.service';
import {
  authorOf,
  authorsById,
  decodeCursor,
  encodeCursor,
  invalid,
  isDuplicateKey,
} from '../community/shared';
import { assertFarmActive, requireFarmPermission, type FarmAccess } from '../farms/farm-access';
import { getBooleanSetting, getNumberSetting } from '../settings/settings.service';
import {
  archivedFarmIds,
  assertAnimalSellable,
  escapeRegex,
  eventDTOs,
  isFarmArchived,
  isModerator,
  isSellerSide,
  logEvent,
} from './common';
import { cancelOpenNegotiations, completeNegotiation } from './negotiations.service';

type SearchQuery = {
  cursor?: string | undefined;
  limit: number;
  q?: string | undefined;
  animalTypeId?: string | undefined;
  breed?: string | undefined;
  province?: string | undefined;
  district?: string | undefined;
  sex?: string | undefined;
  minPriceMinor?: number | undefined;
  maxPriceMinor?: number | undefined;
  sort: 'newest' | 'price_asc' | 'price_desc';
};

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------
export async function toListingDTOs(
  actor: Actor,
  listings: ListingDoc[],
  opts: { privileged?: boolean } = {},
): Promise<ListingDTO[]> {
  const ids = listings.map((l) => l._id);
  const [sellers, favs, negs, sellerFarms] = await Promise.all([
    authorsById(listings.map((l) => l.sellerId)),
    ListingFavorite.find({ userId: actor.userId, listingId: { $in: ids } }).select('listingId'),
    Negotiation.find({ buyerId: actor.userId, listingId: { $in: ids } }).select('listingId'),
    FarmMember.find({
      userId: actor.userId,
      role: { $in: ['owner', 'manager'] },
      farmId: { $in: listings.map((l) => l.farmId) },
    }).select('farmId'),
  ]);
  const fav = new Set(favs.map((f) => String(f.listingId)));
  const neg = new Map(negs.map((n) => [String(n.listingId), String(n._id)]));
  const mine = new Set(sellerFarms.map((m) => String(m.farmId)));
  return listings.map((l) => {
    const sellerSide = mine.has(String(l.farmId));
    const showReview = sellerSide || opts.privileged;
    return {
      id: String(l._id),
      farmId: String(l.farmId),
      animalId: String(l.animalId),
      seller: authorOf(sellers, l.sellerId),
      farmName: l.farmName,
      title: l.title,
      description: l.description ?? null,
      status: l.status,
      askingPriceMinor: l.askingPriceMinor,
      currency: l.currency,
      negotiable: l.negotiable,
      // The seller's floor is private: buyers just get a refusal for offers that are too low.
      ...(showReview ? { minOfferMinor: l.minOfferMinor ?? null } : {}),
      conditions: l.conditions ?? null,
      deliveryOptions: l.deliveryOptions,
      shipping: l.shipping ?? null,
      photos: l.photos.map((p) => ({ url: p.url, caption: p.caption ?? null })),
      animal: {
        animalTypeId: String(l.animal.animalTypeId),
        ...(l.animal.animalTypeKey ? { animalTypeKey: l.animal.animalTypeKey } : {}),
        animalTypeName: l.animal.animalTypeName,
        breed: l.animal.breed ?? null,
        sex: l.animal.sex,
        birthDate: l.animal.birthDate?.toISOString().slice(0, 10) ?? null,
        birthDateEstimated: l.animal.birthDateEstimated,
      },
      location: { province: l.location.province ?? null, district: l.location.district ?? null },
      favoriteCount: l.favoriteCount,
      createdAt: l.createdAt.toISOString(),
      activatedAt: l.activatedAt?.toISOString() ?? null,
      soldAt: l.soldAt?.toISOString() ?? null,
      expiresAt: l.expiresAt?.toISOString() ?? null,
      viewer: {
        isSellerSide: sellerSide,
        favorited: fav.has(String(l._id)),
        negotiationId: neg.get(String(l._id)),
      },
      ...(showReview
        ? {
            review: {
              rejectedReason: l.rejectedReason ?? null,
              pausedBy: l.pausedBy ?? null,
              pausedReason: l.pausedReason ?? null,
            },
          }
        : {}),
      // The reservation (and what was agreed) is for the two parties: buyers of other negotiations never see it.
      ...(l.reservation &&
      (sellerSide || opts.privileged || String(l.reservation.buyerId) === actor.userId)
        ? {
            reservation: {
              negotiationId: String(l.reservation.negotiationId),
              amountMinor: l.reservation.amountMinor,
              expiresAt: l.reservation.expiresAt.toISOString(),
              ...(l.reservation.orderId ? { orderId: String(l.reservation.orderId) } : {}),
            },
          }
        : {}),
    };
  });
}

const audit = (
  actor: Actor | null,
  action: string,
  l: ListingDoc,
  extra: Record<string, unknown> = {},
) =>
  recordAudit({
    actorId: actor?.userId ?? null,
    action,
    targetType: 'listing',
    targetId: l._id,
    metadata: { farmId: String(l.farmId), ...extra },
    ...(actor?.ip ? { ip: actor.ip } : {}),
  });

// ---------------------------------------------------------------------------
// The status machine. One atomic compare-and-set per transition; the event is written by whoever won the race.
// ---------------------------------------------------------------------------
export async function transition(
  id: Types.ObjectId,
  from: ListingStatus[],
  to: ListingStatus,
  actorId: string | null,
  type: string,
  opts: {
    set?: Record<string, unknown>;
    data?: Record<string, unknown>;
    extraFilter?: Record<string, unknown>;
  } = {},
): Promise<ListingDoc | null> {
  const before = await Listing.findOneAndUpdate(
    { _id: id, status: { $in: from }, ...(opts.extraFilter ?? {}) },
    { $set: { status: to, ...(opts.set ?? {}) } },
    { returnDocument: 'before' },
  );
  if (!before) return null;
  await logEvent(before, type, actorId, {
    from: before.status,
    to,
    ...(opts.data ? { data: opts.data } : {}),
  });
  await syncAnimalStatus(before, to, actorId);
  return before;
}

/** While a listing is on sale the animal shows `for_sale`. */
const ON_SALE: ListingStatus[] = ['ACTIVE', 'PAUSED', 'RESERVED'];
/** Closed without a sale: the animal goes back to what it was before this listing. */
const CLOSED_UNSOLD: ListingStatus[] = ['CANCELLED', 'REJECTED', 'EXPIRED'];

/**
 * Keeps the animal's status in line with its listing, server-side only. Each step is a compare-and-set on the animal
 * (MongoDB transactions are not assumed): only an `active` animal is switched to `for_sale`, and only an animal that is
 * still `for_sale` is switched back — so a manual change made meanwhile, or a sale (`sold`), is never overwritten.
 */
async function syncAnimalStatus(
  before: ListingDoc,
  to: ListingStatus,
  actorId: string | null,
): Promise<void> {
  const animal = { _id: before.animalId, farmId: before.farmId };
  const changed = async (from: AnimalStatus, next: AnimalStatus) =>
    recordAudit({
      actorId,
      action: 'animal.updated',
      targetType: 'animal',
      targetId: before.animalId,
      metadata: {
        fields: ['currentStatus'],
        from,
        to: next,
        via: 'listing',
        listingId: String(before._id),
      },
    });
  if (ON_SALE.includes(to) && !ON_SALE.includes(before.status)) {
    const updated = await Animal.updateOne(
      { ...animal, currentStatus: 'active', archivedAt: null },
      { $set: { currentStatus: 'for_sale' } },
    );
    if (updated.modifiedCount === 1) {
      await Listing.updateOne({ _id: before._id }, { $set: { animalStatusBefore: 'active' } });
      await changed('active', 'for_sale');
    }
  } else if (CLOSED_UNSOLD.includes(to) && before.animalStatusBefore) {
    const restore = before.animalStatusBefore;
    const updated = await Animal.updateOne(
      { ...animal, currentStatus: 'for_sale' },
      { $set: { currentStatus: restore } },
    );
    await Listing.updateOne({ _id: before._id }, { $set: { animalStatusBefore: null } });
    if (updated.modifiedCount === 1) await changed('for_sale', restore);
  }
}

const stateError = (status: ListingStatus, action: string) =>
  conflict(
    `A ${status.toLowerCase().replace('_', ' ')} listing cannot be ${action}`,
    'INVALID_STATE',
  );

// ---------------------------------------------------------------------------
// Seller side (farm-scoped; every lookup includes the farm id)
// ---------------------------------------------------------------------------
/** `GET /marketplace/sell-eligibility`: the rule `assertMaySell` enforces, for the caller only. */
export async function sellEligibility(actor: Actor): Promise<SellEligibilityDTO> {
  if (!(await getBooleanSetting('marketplace.requireSellerRole'))) return { canSell: true };
  return actor.access.roleKeys.includes('seller')
    ? { canSell: true }
    : { canSell: false, reason: 'SELLER_REQUIRED' };
}

async function assertMaySell(actor: Actor): Promise<void> {
  if (!(await sellEligibility(actor)).canSell)
    throw forbidden(
      'Only approved sellers can list animals. Submit a seller registration first.',
      'SELLER_REQUIRED',
    );
}

function checkPhotos(photos: { url: string }[], policy: MediaPolicy): void {
  const seen = new Set<string>();
  photos.forEach((p, i) => {
    assertMediaUrlAllowed(p.url, policy);
    if (seen.has(p.url)) throw invalid(`photos.${i}.url`, 'This photo is added twice');
    seen.add(p.url);
  });
}

export async function loadFarmListing(access: FarmAccess, id: Types.ObjectId): Promise<ListingDoc> {
  const listing = await Listing.findOne({ _id: id, farmId: access.farm._id });
  if (!listing) throw notFound('Listing not found');
  return listing;
}

export async function createListing(
  actor: Actor,
  access: FarmAccess,
  input: CreateListingInput,
  policy: MediaPolicy,
): Promise<ListingDTO> {
  requireFarmPermission(access, 'listings.manage');
  assertFarmActive(access);
  await assertMaySell(actor);
  checkPhotos(input.photos, policy);

  const animal = await Animal.findOne({ _id: input.animalId, farmId: access.farm._id });
  if (!animal) throw notFound('Animal not found');
  if (animal.archivedAt) throw conflict('Archived animals cannot be listed', 'ANIMAL_NOT_SELLABLE');
  if (!['active', 'for_sale'].includes(animal.currentStatus))
    throw conflict(
      `An animal that is ${animal.currentStatus.replace('_', ' ')} cannot be listed`,
      'ANIMAL_NOT_SELLABLE',
    );
  const type = await AnimalType.findById(animal.animalTypeId);
  if (await Listing.exists({ animalId: animal._id, status: { $in: [...OPEN_LISTING_STATUSES] } }))
    throw conflict('This animal already has an open listing', 'ALREADY_LISTED');
  // Editing the animal's status back to "active" must not let a marketplace sale be sold again.
  if (await Listing.exists({ animalId: animal._id, status: 'SOLD' }))
    throw conflict('This animal was already sold on the marketplace', 'ANIMAL_NOT_SELLABLE');

  try {
    const farm = access.farm;
    const listing = await Listing.create({
      sellerId: actor.userId,
      farmId: farm._id,
      animalId: animal._id,
      animal: {
        animalTypeId: animal.animalTypeId,
        animalTypeKey: type?.key ?? null,
        animalTypeName: type?.name ?? 'Animal',
        breed: animal.breed ?? null,
        sex: animal.sex,
        birthDate: animal.birthDate ?? null,
        birthDateEstimated: animal.birthDateEstimated,
      },
      farmName: farm.name,
      location: {
        province: farm.location?.province ?? null,
        district: farm.location?.district ?? null,
      },
      title: input.title,
      description: input.description ?? null,
      askingPriceMinor: input.askingPriceMinor,
      negotiable: input.negotiable,
      minOfferMinor: input.minOfferMinor ?? null,
      conditions: input.conditions ?? null,
      deliveryOptions: input.deliveryOptions,
      shipping: input.shipping ?? null,
      photos: input.photos.map((p) => ({ url: p.url, caption: p.caption ?? null })),
    });
    await logEvent(listing, 'created', actor.userId, { to: 'DRAFT' });
    await audit(actor, 'listing.created', listing, { askingPriceMinor: listing.askingPriceMinor });
    return (await toListingDTOs(actor, [listing]))[0]!;
  } catch (error) {
    // Two requests racing for the same animal: the unique partial index lets exactly one through.
    if (isDuplicateKey(error))
      throw conflict('This animal already has an open listing', 'ALREADY_LISTED');
    throw error;
  }
}

export async function getFarmListing(
  actor: Actor,
  access: FarmAccess,
  id: Types.ObjectId,
): Promise<ListingDTO> {
  requireFarmPermission(access, 'listings.manage');
  return (await toListingDTOs(actor, [await loadFarmListing(access, id)]))[0]!;
}

export async function listFarmListings(
  actor: Actor,
  access: FarmAccess,
  query: { cursor?: string | undefined; limit: number; status?: ListingStatus | undefined },
): Promise<CursorPage<ListingDTO>> {
  requireFarmPermission(access, 'listings.manage');
  const and: Record<string, unknown>[] = [{ farmId: access.farm._id }];
  if (query.status) and.push({ status: query.status });
  const cursor = decodeCursor(query.cursor);
  if (cursor)
    and.push({
      $or: [
        { createdAt: { $lt: new Date(cursor.k) } },
        { createdAt: new Date(cursor.k), _id: { $lt: cursor.id } },
      ],
    });
  const rows = await Listing.find({ $and: and })
    .sort({ createdAt: -1, _id: -1 })
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const next =
    rows.length > query.limit && last
      ? encodeCursor(last.createdAt.getTime(), last._id)
      : undefined;
  return { items: await toListingDTOs(actor, page), ...(next ? { nextCursor: next } : {}) };
}

const EDITABLE: ListingStatus[] = ['DRAFT', 'REJECTED', 'PAUSED'];

export async function updateListing(
  actor: Actor,
  access: FarmAccess,
  id: Types.ObjectId,
  input: UpdateListingInput,
  policy: MediaPolicy,
): Promise<ListingDTO> {
  requireFarmPermission(access, 'listings.manage');
  assertFarmActive(access);
  const listing = await loadFarmListing(access, id);
  if (!EDITABLE.includes(listing.status))
    throw conflict('Pause the listing before editing it', 'NOT_EDITABLE');
  if (listing.status === 'PAUSED' && listing.pausedBy === 'moderator')
    throw conflict('A moderator paused this listing', 'MODERATOR_HOLD');
  if (input.photos) checkPhotos(input.photos, policy);

  const priceBefore = listing.askingPriceMinor;
  const negotiableBefore = listing.negotiable;
  if (input.title !== undefined) listing.title = input.title;
  if (input.description !== undefined) listing.description = input.description;
  if (input.askingPriceMinor !== undefined) listing.askingPriceMinor = input.askingPriceMinor;
  if (input.negotiable !== undefined) listing.negotiable = input.negotiable;
  if (input.minOfferMinor !== undefined) listing.minOfferMinor = input.minOfferMinor;
  if (input.conditions !== undefined) listing.conditions = input.conditions;
  if (input.deliveryOptions !== undefined) listing.deliveryOptions = input.deliveryOptions;
  if (input.shipping !== undefined) listing.shipping = input.shipping;
  if (input.photos !== undefined)
    listing.set(
      'photos',
      input.photos.map((p) => ({ url: p.url, caption: p.caption ?? null })),
    );
  if (
    listing.minOfferMinor !== null &&
    listing.minOfferMinor !== undefined &&
    listing.minOfferMinor > listing.askingPriceMinor
  )
    throw invalid('minOfferMinor', 'The lowest offer cannot be above the asking price');

  const wasRejected = listing.status === 'REJECTED';
  if (wasRejected) {
    listing.status = 'DRAFT';
    listing.rejectedReason = null;
  }
  await listing.save();
  await logEvent(listing, wasRejected ? 'revised' : 'updated', actor.userId, {
    ...(wasRejected ? { from: 'REJECTED', to: 'DRAFT' } : {}),
    data: { fields: Object.keys(input) },
  });
  if (listing.askingPriceMinor !== priceBefore || listing.negotiable !== negotiableBefore)
    // Offers were made against the old terms: they would no longer satisfy the server's rules.
    await cancelOpenNegotiations(listing._id, 'listing_changed');
  await audit(actor, 'listing.updated', listing, { fields: Object.keys(input) });
  return (await toListingDTOs(actor, [listing]))[0]!;
}

export async function submitListing(
  actor: Actor,
  access: FarmAccess,
  id: Types.ObjectId,
): Promise<ListingDTO> {
  requireFarmPermission(access, 'listings.manage');
  assertFarmActive(access);
  const listing = await loadFarmListing(access, id);
  await assertMaySell(actor);
  if (listing.status !== 'DRAFT') throw stateError(listing.status, 'submitted');
  if (listing.photos.length === 0)
    throw invalid('photos', 'Add at least one photo before submitting');
  if (listing.deliveryOptions.includes('delivery') && !listing.shipping)
    throw invalid('shipping', 'Add your delivery prices, or untick delivery');
  const animal = await Animal.findOne({ _id: listing.animalId, farmId: access.farm._id });
  if (!animal || animal.archivedAt || !['active', 'for_sale'].includes(animal.currentStatus))
    throw conflict('This animal can no longer be listed', 'ANIMAL_NOT_SELLABLE');

  const review = await getBooleanSetting('marketplace.requireReview');
  const to: ListingStatus = review ? 'PENDING_REVIEW' : 'ACTIVE';
  const set = review ? {} : await activationFields();
  const done = await transition(
    listing._id,
    ['DRAFT'],
    to,
    actor.userId,
    review ? 'submitted' : 'published',
    { set },
  );
  if (!done) throw stateError(listing.status, 'submitted');
  await audit(actor, review ? 'listing.submitted' : 'listing.published', listing);
  return getFarmListing(actor, access, id);
}

async function activationFields(): Promise<Record<string, unknown>> {
  const days = await getNumberSetting('marketplace.listingDays', 1, 365);
  const now = new Date();
  return {
    activatedAt: now,
    expiresAt: new Date(now.getTime() + days * 86_400_000),
    rejectedReason: null,
  };
}

export async function pauseListing(
  actor: Actor,
  access: FarmAccess,
  id: Types.ObjectId,
  reason?: string,
): Promise<ListingDTO> {
  requireFarmPermission(access, 'listings.manage');
  assertFarmActive(access);
  const l = await loadFarmListing(access, id);
  const done = await transition(l._id, ['ACTIVE'], 'PAUSED', actor.userId, 'paused', {
    set: { pausedBy: 'seller', pausedReason: reason ?? null },
    ...(reason ? { data: { reason } } : {}),
  });
  if (!done) throw stateError(l.status, 'paused');
  await audit(actor, 'listing.paused', l);
  return getFarmListing(actor, access, id);
}

export async function resumeListing(
  actor: Actor,
  access: FarmAccess,
  id: Types.ObjectId,
): Promise<ListingDTO> {
  requireFarmPermission(access, 'listings.manage');
  assertFarmActive(access);
  const l = await loadFarmListing(access, id);
  if (l.status === 'PAUSED' && l.pausedBy === 'moderator')
    throw conflict('A moderator paused this listing', 'MODERATOR_HOLD');
  if (l.expiresAt && l.expiresAt < new Date())
    throw conflict('This listing expired: renew it instead', 'EXPIRED');
  const done = await transition(l._id, ['PAUSED'], 'ACTIVE', actor.userId, 'resumed', {
    set: { pausedBy: null, pausedReason: null },
    extraFilter: { pausedBy: 'seller' },
  });
  if (!done) throw stateError(l.status, 'resumed');
  await audit(actor, 'listing.resumed', l);
  return getFarmListing(actor, access, id);
}

export async function renewListing(
  actor: Actor,
  access: FarmAccess,
  id: Types.ObjectId,
): Promise<ListingDTO> {
  requireFarmPermission(access, 'listings.manage');
  assertFarmActive(access);
  const l = await loadFarmListing(access, id);
  if (l.status === 'EXPIRED') await assertAnimalSellable(l.animalId);
  let done;
  try {
    done = await transition(l._id, ['EXPIRED'], 'ACTIVE', actor.userId, 'renewed', {
      set: await activationFields(),
    });
  } catch (error) {
    // Another listing of the same animal was opened meanwhile (unique open-listing index).
    if (isDuplicateKey(error))
      throw conflict('This animal already has an open listing', 'ALREADY_LISTED');
    throw error;
  }
  if (!done) throw stateError(l.status, 'renewed');
  await audit(actor, 'listing.renewed', l);
  return getFarmListing(actor, access, id);
}

export async function cancelListing(
  actor: Actor,
  access: FarmAccess,
  id: Types.ObjectId,
  reason?: string,
): Promise<ListingDTO> {
  requireFarmPermission(access, 'listings.manage');
  assertFarmActive(access);
  const l = await loadFarmListing(access, id);
  if (l.status === 'RESERVED')
    throw conflict('Cancel the reservation first (or complete the sale)', 'RESERVED');
  const done = await transition(
    l._id,
    ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'REJECTED', 'EXPIRED'],
    'CANCELLED',
    actor.userId,
    'cancelled',
    reason ? { data: { reason } } : {},
  );
  if (!done) throw stateError(l.status, 'cancelled');
  await cancelOpenNegotiations(l._id, 'listing_cancelled');
  await audit(actor, 'listing.cancelled', l);
  return getFarmListing(actor, access, id);
}

/** The seller confirms the animal was handed over (after a reservation, or a sale made off-platform). */
export async function markSold(
  actor: Actor,
  access: FarmAccess,
  id: Types.ObjectId,
): Promise<ListingDTO> {
  requireFarmPermission(access, 'listings.manage');
  assertFarmActive(access);
  const l = await loadFarmListing(access, id);
  if (l.reservation?.orderId)
    throw conflict(
      'An order exists for this sale: it completes when the buyer confirms delivery',
      'ORDER_EXISTS',
    );
  const done = await transition(l._id, ['RESERVED', 'ACTIVE'], 'SOLD', actor.userId, 'sold', {
    set: { soldAt: new Date() },
    data: l.reservation
      ? {
          negotiationId: String(l.reservation.negotiationId),
          amountMinor: l.reservation.amountMinor,
        }
      : {},
  });
  if (!done) throw stateError(l.status, 'marked as sold');
  if (done.reservation) await completeNegotiation(done.reservation.negotiationId, actor.userId);
  await cancelOpenNegotiations(l._id, 'animal_sold');
  // A sold animal can never be listed (or bought) again.
  await Animal.updateOne(
    { _id: l.animalId, farmId: l.farmId },
    { $set: { currentStatus: 'sold' } },
  );
  await audit(actor, 'listing.sold', l, { amountMinor: done.reservation?.amountMinor });
  return getFarmListing(actor, access, id);
}

export async function farmListingEvents(
  access: FarmAccess,
  id: Types.ObjectId,
): Promise<ListingEventDTO[]> {
  requireFarmPermission(access, 'listings.manage');
  const l = await loadFarmListing(access, id);
  return eventDTOs(l._id);
}

// ---------------------------------------------------------------------------
// Public browsing
// ---------------------------------------------------------------------------
const PUBLIC_STATUSES: ListingStatus[] = ['ACTIVE', 'RESERVED', 'SOLD'];

/** Who may open a listing: everyone signed in for ACTIVE/RESERVED/SOLD; otherwise only its seller side and moderators. */
export async function loadViewableListing(actor: Actor, id: Types.ObjectId): Promise<ListingDoc> {
  const l = await Listing.findById(id);
  if (!l) throw notFound('Listing not found');
  // An ACTIVE listing of an archived farm is not on offer: hidden like a paused one (RESERVED/SOLD stay visible).
  if (
    PUBLIC_STATUSES.includes(l.status) &&
    !(l.status === 'ACTIVE' && (await isFarmArchived(l.farmId)))
  )
    return l;
  if (isModerator(actor) || (await isSellerSide(actor.userId, l.farmId))) return l;
  throw notFound('Listing not found');
}

export async function getListing(actor: Actor, id: Types.ObjectId): Promise<ListingDTO> {
  const l = await loadViewableListing(actor, id);
  return (await toListingDTOs(actor, [l], { privileged: isModerator(actor) }))[0]!;
}

export async function searchListings(
  actor: Actor,
  q: SearchQuery,
): Promise<CursorPage<ListingDTO>> {
  const and: Record<string, unknown>[] = [
    { status: 'ACTIVE' },
    { $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] },
    { farmId: { $nin: await archivedFarmIds() } },
  ];
  if (q.animalTypeId) and.push({ 'animal.animalTypeId': new Types.ObjectId(q.animalTypeId) });
  if (q.sex) and.push({ 'animal.sex': q.sex });
  const ci = (v: string) => ({ $regex: `^${escapeRegex(v)}$`, $options: 'i' });
  if (q.breed) and.push({ 'animal.breed': ci(q.breed) });
  if (q.province) and.push({ 'location.province': ci(q.province) });
  if (q.district) and.push({ 'location.district': ci(q.district) });
  if (q.minPriceMinor !== undefined || q.maxPriceMinor !== undefined)
    and.push({
      askingPriceMinor: {
        ...(q.minPriceMinor !== undefined ? { $gte: q.minPriceMinor } : {}),
        ...(q.maxPriceMinor !== undefined ? { $lte: q.maxPriceMinor } : {}),
      },
    });
  if (q.q) {
    const rx = { $regex: escapeRegex(q.q), $options: 'i' };
    and.push({
      $or: [
        { title: rx },
        { description: rx },
        { 'animal.breed': rx },
        { 'animal.animalTypeName': rx },
      ],
    });
  }

  const cursor = decodeCursor(q.cursor);
  let sort: Record<string, 1 | -1>;
  let keyOf: (l: ListingDoc) => number;
  if (q.sort === 'newest') {
    sort = { activatedAt: -1, _id: -1 };
    keyOf = (l) => (l.activatedAt ?? l.createdAt).getTime();
    if (cursor)
      and.push({
        $or: [
          { activatedAt: { $lt: new Date(cursor.k) } },
          { activatedAt: new Date(cursor.k), _id: { $lt: cursor.id } },
        ],
      });
  } else {
    const asc = q.sort === 'price_asc';
    sort = { askingPriceMinor: asc ? 1 : -1, _id: asc ? 1 : -1 };
    keyOf = (l) => l.askingPriceMinor;
    if (cursor)
      and.push({
        $or: [
          { askingPriceMinor: { [asc ? '$gt' : '$lt']: cursor.k } },
          { askingPriceMinor: cursor.k, _id: { [asc ? '$gt' : '$lt']: cursor.id } },
        ],
      });
  }
  const rows = await Listing.find({ $and: and })
    .sort(sort)
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  const next = rows.length > q.limit && last ? encodeCursor(keyOf(last), last._id) : undefined;
  return { items: await toListingDTOs(actor, page), ...(next ? { nextCursor: next } : {}) };
}

// ---------------------------------------------------------------------------
// Favorites (one row per user and listing; the counter only moves when a row really changes)
// ---------------------------------------------------------------------------
export async function favorite(actor: Actor, id: Types.ObjectId): Promise<FavoriteResult> {
  const l = await loadViewableListing(actor, id);
  if (!['ACTIVE', 'RESERVED'].includes(l.status))
    throw conflict('This listing is not available', 'LISTING_UNAVAILABLE');
  try {
    const res = await ListingFavorite.updateOne(
      { userId: actor.userId, listingId: l._id },
      { $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
    if (res.upsertedCount === 1)
      await Listing.updateOne({ _id: l._id }, { $inc: { favoriteCount: 1 } });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
  return { favorited: true, favoriteCount: (await Listing.findById(l._id))?.favoriteCount ?? 0 };
}

export async function unfavorite(actor: Actor, id: Types.ObjectId): Promise<FavoriteResult> {
  const res = await ListingFavorite.deleteOne({ userId: actor.userId, listingId: id });
  if (res.deletedCount === 1)
    await Listing.updateOne(
      { _id: id, favoriteCount: { $gt: 0 } },
      { $inc: { favoriteCount: -1 } },
    );
  return { favorited: false, favoriteCount: (await Listing.findById(id))?.favoriteCount ?? 0 };
}

export async function listFavorites(
  actor: Actor,
  q: { cursor?: string | undefined; limit: number },
): Promise<CursorPage<ListingDTO>> {
  const cursor = decodeCursor(q.cursor);
  const and: Record<string, unknown>[] = [{ userId: actor.userId }];
  if (cursor)
    and.push({
      $or: [
        { createdAt: { $lt: new Date(cursor.k) } },
        { createdAt: new Date(cursor.k), _id: { $lt: cursor.id } },
      ],
    });
  const rows = await ListingFavorite.find({ $and: and })
    .sort({ createdAt: -1, _id: -1 })
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  const next =
    rows.length > q.limit && last ? encodeCursor(last.createdAt.getTime(), last._id) : undefined;
  // Listings that are no longer public simply drop out of the list.
  const listings = await Listing.find({
    _id: { $in: page.map((p) => p.listingId) },
    status: { $in: PUBLIC_STATUSES },
  });
  const byId = new Map(listings.map((l) => [String(l._id), l]));
  const ordered = page.flatMap((p) =>
    byId.has(String(p.listingId)) ? [byId.get(String(p.listingId))!] : [],
  );
  return { items: await toListingDTOs(actor, ordered), ...(next ? { nextCursor: next } : {}) };
}

// ---------------------------------------------------------------------------
// Moderation (route layer requires `listings.moderate`)
// ---------------------------------------------------------------------------
async function loadForModeration(actor: Actor, id: Types.ObjectId): Promise<ListingDoc> {
  const l = await Listing.findById(id);
  if (!l) throw notFound('Listing not found');
  if (await FarmMember.exists({ farmId: l.farmId, userId: actor.userId }))
    throw forbidden('You cannot moderate your own listing', 'SELF_MODERATION');
  return l;
}

export async function listForModeration(
  actor: Actor,
  q: { cursor?: string | undefined; limit: number; status: ListingStatus },
): Promise<CursorPage<ListingDTO>> {
  const and: Record<string, unknown>[] = [{ status: q.status }];
  const cursor = decodeCursor(q.cursor);
  if (cursor)
    and.push({
      $or: [
        { updatedAt: { $lt: new Date(cursor.k) } },
        { updatedAt: new Date(cursor.k), _id: { $lt: cursor.id } },
      ],
    });
  const rows = await Listing.find({ $and: and })
    .sort({ updatedAt: -1, _id: -1 })
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  const next =
    rows.length > q.limit && last ? encodeCursor(last.updatedAt.getTime(), last._id) : undefined;
  return {
    items: await toListingDTOs(actor, page, { privileged: true }),
    ...(next ? { nextCursor: next } : {}),
  };
}

/** The farm's owners and managers hear about moderation decisions on their listing. */
async function tellSellers(
  l: ListingDoc,
  type:
    | 'moderation.listing_approved'
    | 'moderation.listing_rejected'
    | 'moderation.listing_suspended'
    | 'moderation.listing_restored',
  extra: { reason?: string },
): Promise<void> {
  await notify({
    to: await sellerSideUserIds(l.farmId),
    type,
    params: { title: l.title, reason: extra.reason ?? '' },
  } as never);
}

export async function approveListing(actor: Actor, id: Types.ObjectId): Promise<ListingDTO> {
  const l = await loadForModeration(actor, id);
  const done = await transition(l._id, ['PENDING_REVIEW'], 'ACTIVE', actor.userId, 'approved', {
    set: await activationFields(),
  });
  if (!done) throw stateError(l.status, 'approved');
  await audit(actor, 'listing.approved', l);
  await tellSellers(l, 'moderation.listing_approved', {});
  return getListing(actor, id);
}

/** Reject a submission, or take an active/paused listing down. The seller can revise and resubmit. */
export async function rejectListing(
  actor: Actor,
  id: Types.ObjectId,
  reason: string,
): Promise<ListingDTO> {
  const l = await loadForModeration(actor, id);
  const done = await transition(
    l._id,
    ['PENDING_REVIEW', 'ACTIVE', 'PAUSED'],
    'REJECTED',
    actor.userId,
    'rejected',
    {
      set: { rejectedReason: reason, pausedBy: null },
      data: { reason },
    },
  );
  if (!done) throw stateError(l.status, 'rejected');
  await cancelOpenNegotiations(l._id, 'listing_rejected');
  await audit(actor, 'listing.rejected', l, { reason });
  await tellSellers(l, 'moderation.listing_rejected', { reason });
  return getListing(actor, id);
}

export async function suspendListing(
  actor: Actor,
  id: Types.ObjectId,
  reason: string,
): Promise<ListingDTO> {
  const l = await loadForModeration(actor, id);
  const done = await transition(l._id, ['ACTIVE'], 'PAUSED', actor.userId, 'suspended', {
    set: { pausedBy: 'moderator', pausedReason: reason },
    data: { reason },
  });
  if (!done) throw stateError(l.status, 'suspended');
  await audit(actor, 'listing.suspended', l, { reason });
  await tellSellers(l, 'moderation.listing_suspended', { reason });
  return getListing(actor, id);
}

export async function restoreListing(actor: Actor, id: Types.ObjectId): Promise<ListingDTO> {
  const l = await loadForModeration(actor, id);
  const done = await transition(l._id, ['PAUSED'], 'ACTIVE', actor.userId, 'restored', {
    set: { pausedBy: null, pausedReason: null },
    extraFilter: { pausedBy: 'moderator' },
  });
  if (!done) throw stateError(l.status, 'restored');
  await audit(actor, 'listing.restored', l);
  await tellSellers(l, 'moderation.listing_restored', {});
  return getListing(actor, id);
}

export async function moderationEvents(id: Types.ObjectId): Promise<ListingEventDTO[]> {
  const l = await Listing.findById(id).select('_id');
  if (!l) throw notFound('Listing not found');
  return eventDTOs(l._id);
}

export { HttpError };
