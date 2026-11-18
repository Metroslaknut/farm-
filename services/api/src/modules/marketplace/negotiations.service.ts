import type { Types } from 'mongoose';
import { offerClosed, offerCountered, offerReceived } from '../notifications/events';
import type {
  CursorPage,
  NegotiationDTO,
  NegotiationEventType,
  NegotiationStatus,
  Party,
} from '@farmplus/shared-types';
import { LISTING_LIMITS } from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { HttpError, conflict, forbidden, notFound } from '../../lib/errors';
import { Listing, Negotiation, type ListingDoc, type NegotiationDoc } from '../../models';
import { recordAudit } from '../../services/audit.service';
import {
  authorOf,
  authorsById,
  decodeCursor,
  encodeCursor,
  invalid,
  isDuplicateKey,
} from '../community/shared';
import { getNumberSetting } from '../settings/settings.service';
import {
  assertAnimalSellable,
  assertFarmTrading,
  isModerator,
  isSellerSide,
  logEvent,
} from './common';

const HOUR = 3_600_000;
const CLOSED: NegotiationStatus[] = ['rejected', 'withdrawn', 'expired', 'cancelled'];
const MAX_OPEN_AS_BUYER = 20;

async function assertOpenCap(actor: Actor): Promise<void> {
  if (
    (await Negotiation.countDocuments({ buyerId: actor.userId, status: 'open' })) >=
    MAX_OPEN_AS_BUYER
  )
    throw err(429, 'TOO_MANY_NEGOTIATIONS', 'You have too many open negotiations');
}

const err = (status: number, code: string, message: string) => new HttpError(status, code, message);
const unavailable = () => err(409, 'LISTING_UNAVAILABLE', 'This listing is no longer available');
const stale = () =>
  err(409, 'STALE_OFFER', 'The offer changed while you were looking: reload and try again');

// ---------------------------------------------------------------------------
// Rules for amounts — all validated here, never trusted from the client
// ---------------------------------------------------------------------------
function assertAmount(listing: ListingDoc, amountMinor: number, currency: string): void {
  if (currency !== listing.currency)
    throw invalid('currency', `This listing is priced in ${listing.currency}`);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
    throw invalid('amountMinor', 'Invalid amount');
  if (amountMinor > listing.askingPriceMinor)
    throw invalid('amountMinor', 'An offer cannot be above the asking price');
  if (listing.minOfferMinor && amountMinor < listing.minOfferMinor)
    throw invalid('amountMinor', 'This amount is below what the seller will consider');
  if (!listing.negotiable && amountMinor !== listing.askingPriceMinor)
    throw invalid('amountMinor', 'The price is fixed: the offer must equal the asking price');
}

const rounds = (n: NegotiationDoc): number =>
  n.history.filter((h) => h.type === 'offer' || h.type === 'counter').length;

// ---------------------------------------------------------------------------
// One atomic step of the negotiation. `history: { $size }` makes concurrent steps conflict: the loser re-reads.
// ---------------------------------------------------------------------------
interface StepEvent {
  type: NegotiationEventType;
  by: Party;
  actorId: string;
  amountMinor?: number;
  currency?: string;
  message?: string | undefined;
  reason?: string | undefined;
}

async function step(
  neg: NegotiationDoc,
  guard: Record<string, unknown>,
  set: (seq: number) => Record<string, unknown>,
  event: StepEvent,
): Promise<NegotiationDoc | null> {
  const seq = neg.history.length + 1;
  return Negotiation.findOneAndUpdate(
    { _id: neg._id, history: { $size: neg.history.length }, ...guard },
    {
      $set: set(seq),
      $push: {
        history: {
          seq,
          type: event.type,
          by: event.by,
          actorId: event.actorId,
          amountMinor: event.amountMinor ?? null,
          currency: event.currency ?? null,
          message: event.message ?? null,
          reason: event.reason ?? null,
          at: new Date(),
        },
      },
    },
    { returnDocument: 'after' },
  );
}

const audit = (
  actor: Actor | null,
  action: string,
  n: NegotiationDoc,
  extra: Record<string, unknown> = {},
) =>
  recordAudit({
    actorId: actor?.userId ?? null,
    action,
    targetType: 'negotiation',
    targetId: n._id,
    metadata: { listingId: String(n.listingId), ...extra },
    ...(actor?.ip ? { ip: actor.ip } : {}),
  });

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------
type Role = Party | 'moderator';

async function partyOf(actor: Actor, neg: NegotiationDoc): Promise<Role | null> {
  if (String(neg.buyerId) === actor.userId) return 'buyer';
  if (await isSellerSide(actor.userId, neg.farmId)) return 'seller';
  if (isModerator(actor)) return 'moderator';
  return null;
}

/** Expire an open negotiation whose offer ran out (lazily on access, and by the cleanup job). */
export async function expireNegotiation(neg: NegotiationDoc): Promise<NegotiationDoc> {
  if (neg.status !== 'open' || !neg.offerExpiresAt || neg.offerExpiresAt > new Date()) return neg;
  const done = await step(
    neg,
    { status: 'open', offerExpiresAt: { $lte: new Date() } },
    () => ({ status: 'expired', turn: null }),
    {
      type: 'expire',
      by: neg.turn ?? 'buyer',
      actorId: String(neg.buyerId),
      reason: 'offer_expired',
    },
  );
  if (done)
    await logEvent({ _id: neg.listingId, farmId: neg.farmId }, 'negotiation.expired', null, {
      data: { negotiationId: String(neg._id) },
    });
  return done ?? (await Negotiation.findById(neg._id)) ?? neg;
}

async function loadFor(
  actor: Actor,
  id: Types.ObjectId,
): Promise<{ neg: NegotiationDoc; listing: ListingDoc; role: Role }> {
  let neg = await Negotiation.findById(id);
  if (!neg) throw notFound('Negotiation not found');
  const role = await partyOf(actor, neg);
  if (!role) throw notFound('Negotiation not found'); // not a party: indistinguishable from missing
  neg = await expireNegotiation(neg);
  const listing = await Listing.findById(neg.listingId);
  if (!listing) throw notFound('Negotiation not found');
  return { neg, listing, role };
}

async function sellerActing(actor: Actor, neg: NegotiationDoc): Promise<void> {
  if (!(await isSellerSide(actor.userId, neg.farmId))) throw notFound('Negotiation not found');
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------
export async function toNegotiationDTOs(
  actor: Actor,
  negs: NegotiationDoc[],
  role?: Role,
): Promise<NegotiationDTO[]> {
  const listings = new Map(
    (await Listing.find({ _id: { $in: negs.map((n) => n.listingId) } })).map((l) => [
      String(l._id),
      l,
    ]),
  );
  const people = await authorsById([
    ...negs.map((n) => n.buyerId),
    ...negs.map((n) => n.sellerId),
    ...negs.flatMap((n) => n.history.map((h) => h.actorId)),
  ]);
  const out: NegotiationDTO[] = [];
  for (const n of negs) {
    const l = listings.get(String(n.listingId));
    if (!l) continue;
    const r: Role =
      role ??
      (String(n.buyerId) === actor.userId
        ? 'buyer'
        : (await isSellerSide(actor.userId, n.farmId))
          ? 'seller'
          : 'moderator');
    const live = n.status === 'open' && (!n.offerExpiresAt || n.offerExpiresAt > new Date());
    out.push({
      id: String(n._id),
      listingId: String(n.listingId),
      listingTitle: l.title,
      listingStatus: l.status,
      askingPriceMinor: l.askingPriceMinor,
      buyer: authorOf(people, n.buyerId),
      seller: authorOf(people, n.sellerId),
      status: n.status,
      ...(n.turn && n.status === 'open' ? { turn: n.turn } : {}),
      currentOfferMinor: n.currentOfferMinor,
      currency: n.currency,
      currentSeq: n.currentSeq,
      offerExpiresAt: n.offerExpiresAt?.toISOString() ?? null,
      history: n.history.map((h) => ({
        seq: h.seq,
        type: h.type,
        by: h.by,
        actor: authorOf(people, h.actorId),
        amountMinor: h.amountMinor ?? null,
        currency: h.currency ?? null,
        message: h.message ?? null,
        reason: h.reason ?? null,
        at: h.at.toISOString(),
      })),
      viewer: { party: r, canAct: r !== 'moderator' && live && n.turn === r },
      ...(n.status === 'accepted' &&
      l.reservation &&
      String(l.reservation.negotiationId) === String(n._id)
        ? {
            order: {
              status: 'awaiting_payment' as const,
              amountMinor: l.reservation.amountMinor,
              currency: l.currency,
              reservedUntil: l.reservation.expiresAt.toISOString(),
              ...(l.reservation.orderId ? { orderId: String(l.reservation.orderId) } : {}),
            },
          }
        : {}),
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    });
  }
  return out;
}

export async function getNegotiation(actor: Actor, id: Types.ObjectId): Promise<NegotiationDTO> {
  const { neg, role } = await loadFor(actor, id);
  return (await toNegotiationDTOs(actor, [neg], role))[0]!;
}

async function page(
  actor: Actor,
  filter: Record<string, unknown>,
  q: { cursor?: string | undefined; limit: number },
): Promise<CursorPage<NegotiationDTO>> {
  const and: Record<string, unknown>[] = [filter];
  const cursor = decodeCursor(q.cursor);
  if (cursor)
    and.push({
      $or: [
        { updatedAt: { $lt: new Date(cursor.k) } },
        { updatedAt: new Date(cursor.k), _id: { $lt: cursor.id } },
      ],
    });
  const rows = await Negotiation.find({ $and: and })
    .sort({ updatedAt: -1, _id: -1 })
    .limit(q.limit + 1);
  const items = await Promise.all(rows.slice(0, q.limit).map(expireNegotiation));
  const last = items[items.length - 1];
  const next =
    rows.length > q.limit && last ? encodeCursor(last.updatedAt.getTime(), last._id) : undefined;
  return { items: await toNegotiationDTOs(actor, items), ...(next ? { nextCursor: next } : {}) };
}

export const listMyNegotiations = (
  actor: Actor,
  q: { cursor?: string | undefined; limit: number },
) => page(actor, { buyerId: actor.userId }, q);

/** Seller side: negotiations of one farm (optionally one listing). The caller must be owner/manager of that farm. */
export async function listFarmNegotiations(
  actor: Actor,
  farmId: Types.ObjectId,
  q: {
    cursor?: string | undefined;
    limit: number;
    listingId?: Types.ObjectId | undefined;
    status?: NegotiationStatus | undefined;
  },
): Promise<CursorPage<NegotiationDTO>> {
  if (!(await isSellerSide(actor.userId, farmId))) throw notFound('Farm not found');
  return page(
    actor,
    {
      farmId,
      ...(q.listingId ? { listingId: q.listingId } : {}),
      ...(q.status ? { status: q.status } : {}),
    },
    q,
  );
}

// ---------------------------------------------------------------------------
// Buyer: make an offer
// ---------------------------------------------------------------------------
export async function startNegotiation(
  actor: Actor,
  listingId: Types.ObjectId,
  input: { amountMinor: number; currency: string; message?: string | undefined },
): Promise<NegotiationDTO> {
  const listing = await Listing.findById(listingId);
  if (
    !listing ||
    listing.status !== 'ACTIVE' ||
    (listing.expiresAt && listing.expiresAt < new Date())
  )
    throw notFound('Listing not found');
  if (await isSellerSide(actor.userId, listing.farmId))
    throw conflict('You cannot make an offer on your own farm’s listing', 'OWN_LISTING');
  await assertFarmTrading(listing.farmId);
  assertAmount(listing, input.amountMinor, input.currency);

  const hours = await getNumberSetting('marketplace.offerHours', 1, 720);
  const expiresAt = new Date(Date.now() + hours * HOUR);
  const existing = await Negotiation.findOne({ listingId, buyerId: actor.userId });

  if (existing) {
    const current = await expireNegotiation(existing);
    if (current.status === 'open')
      throw err(409, 'NEGOTIATION_EXISTS', 'You already have an open negotiation for this listing');
    if (!CLOSED.includes(current.status))
      throw err(409, 'NEGOTIATION_CLOSED', 'This negotiation is final');
    if (rounds(current) >= LISTING_LIMITS.maxRounds)
      throw err(409, 'TOO_MANY_ROUNDS', 'Too many offers on this listing');
    await assertOpenCap(actor);
    const reopened = await step(
      current,
      { status: { $in: CLOSED } },
      (seq) => ({
        status: 'open',
        turn: 'seller',
        currentOfferMinor: input.amountMinor,
        currentSeq: seq,
        offerExpiresAt: expiresAt,
      }),
      {
        type: 'offer',
        by: 'buyer',
        actorId: actor.userId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        message: input.message,
      },
    );
    if (!reopened) throw stale();
    await logEvent(listing, 'negotiation.offer', actor.userId, {
      data: { negotiationId: String(reopened._id), amountMinor: input.amountMinor, by: 'buyer' },
    });
    await audit(actor, 'negotiation.offer', reopened, { amountMinor: input.amountMinor });
    await offerReceived(offerCtx(reopened, listing, input.amountMinor), actor.userId);
    return (await toNegotiationDTOs(actor, [reopened], 'buyer'))[0]!;
  }

  await assertOpenCap(actor);
  try {
    const neg = await Negotiation.create({
      listingId,
      farmId: listing.farmId,
      sellerId: listing.sellerId,
      buyerId: actor.userId,
      status: 'open',
      turn: 'seller',
      currentOfferMinor: input.amountMinor,
      currency: listing.currency,
      currentSeq: 1,
      offerExpiresAt: expiresAt,
      history: [
        {
          seq: 1,
          type: 'offer',
          by: 'buyer',
          actorId: actor.userId,
          amountMinor: input.amountMinor,
          currency: input.currency as 'THB',
          message: input.message ?? null,
          at: new Date(),
        },
      ],
    });
    await logEvent(listing, 'negotiation.offer', actor.userId, {
      data: { negotiationId: String(neg._id), amountMinor: input.amountMinor, by: 'buyer' },
    });
    await audit(actor, 'negotiation.offer', neg, { amountMinor: input.amountMinor });
    await offerReceived(offerCtx(neg, listing, input.amountMinor), actor.userId);
    return (await toNegotiationDTOs(actor, [neg], 'buyer'))[0]!;
  } catch (error) {
    if (isDuplicateKey(error))
      throw err(409, 'NEGOTIATION_EXISTS', 'You already have a negotiation for this listing');
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Counter / accept / reject / withdraw
// ---------------------------------------------------------------------------
function assertCanAct(
  neg: NegotiationDoc,
  role: Role,
  expectedSeq?: number,
): asserts role is Party {
  if (role === 'moderator')
    throw forbidden('Moderators can read negotiations but not take part', 'READ_ONLY');
  if (neg.status === 'expired') throw err(409, 'OFFER_EXPIRED', 'This offer has expired');
  if (neg.status !== 'open') throw err(409, 'NEGOTIATION_CLOSED', 'This negotiation is closed');
  if (neg.turn !== role) throw err(409, 'NOT_YOUR_TURN', 'It is not your turn');
  if (expectedSeq !== undefined && expectedSeq !== neg.currentSeq) throw stale();
}

const offerCtx = (neg: NegotiationDoc, listing: ListingDoc, amountMinor: number) => ({
  negotiationId: neg._id,
  seq: neg.currentSeq,
  buyerId: neg.buyerId,
  farmId: neg.farmId,
  title: listing.title,
  amountMinor,
});

export async function counter(
  actor: Actor,
  id: Types.ObjectId,
  input: {
    amountMinor: number;
    currency: string;
    message?: string | undefined;
    expectedSeq: number;
  },
): Promise<NegotiationDTO> {
  const { neg, listing, role } = await loadFor(actor, id);
  assertCanAct(neg, role, input.expectedSeq);
  if (role === 'seller') await sellerActing(actor, neg);
  if (listing.status !== 'ACTIVE') throw unavailable();
  await assertFarmTrading(listing.farmId);
  if (!listing.negotiable)
    throw err(409, 'PRICE_FIXED', 'The price is fixed: accept or reject the offer');
  assertAmount(listing, input.amountMinor, input.currency);
  // Offers must move toward each other: a seller never counters below the buyer's offer, a buyer never above the seller's.
  if (role === 'seller' && input.amountMinor < neg.currentOfferMinor)
    throw invalid('amountMinor', 'A counter-offer cannot be below the buyer’s offer');
  if (role === 'buyer' && input.amountMinor > neg.currentOfferMinor)
    throw invalid('amountMinor', 'A counter-offer cannot be above the seller’s price');
  if (input.amountMinor === neg.currentOfferMinor)
    throw invalid('amountMinor', 'That is the current price: accept it instead');
  if (rounds(neg) >= LISTING_LIMITS.maxRounds)
    throw err(409, 'TOO_MANY_ROUNDS', 'Too many rounds: accept or reject');

  const hours = await getNumberSetting('marketplace.offerHours', 1, 720);
  const other: Party = role === 'seller' ? 'buyer' : 'seller';
  const next = await step(
    neg,
    {
      status: 'open',
      turn: role,
      currentSeq: input.expectedSeq,
      offerExpiresAt: { $gt: new Date() },
    },
    (seq) => ({
      turn: other,
      currentOfferMinor: input.amountMinor,
      currentSeq: seq,
      offerExpiresAt: new Date(Date.now() + hours * HOUR),
    }),
    {
      type: 'counter',
      by: role,
      actorId: actor.userId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      message: input.message,
    },
  );
  if (!next) throw stale();
  await logEvent(listing, 'negotiation.counter', actor.userId, {
    data: { negotiationId: String(neg._id), amountMinor: input.amountMinor, by: role },
  });
  await audit(actor, 'negotiation.counter', next, { amountMinor: input.amountMinor, by: role });
  await offerCountered(offerCtx(next, listing, input.amountMinor), role, actor.userId);
  return (await toNegotiationDTOs(actor, [next], role))[0]!;
}

/**
 * Accept the offer on the table. The animal is held by an atomic compare-and-set on the LISTING (`ACTIVE → RESERVED`):
 * of any number of simultaneous acceptances for the same animal exactly one wins, the rest get `409 LISTING_UNAVAILABLE`.
 * (MongoDB transactions are not assumed; every step is a single-document atomic update and failures roll the reservation back.)
 */
export async function accept(
  actor: Actor,
  id: Types.ObjectId,
  input: { expectedSeq: number },
): Promise<NegotiationDTO> {
  const { neg, listing, role } = await loadFor(actor, id);
  assertCanAct(neg, role, input.expectedSeq);
  if (role === 'seller') await sellerActing(actor, neg);
  if (listing.status !== 'ACTIVE') throw unavailable();
  await assertFarmTrading(listing.farmId);
  await assertAnimalSellable(listing.animalId);

  const hours = await getNumberSetting('marketplace.reservationHours', 1, 720);
  const now = new Date();
  const reserved = await Listing.findOneAndUpdate(
    { _id: listing._id, status: 'ACTIVE', $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
    {
      $set: {
        status: 'RESERVED',
        reservation: {
          negotiationId: neg._id,
          buyerId: neg.buyerId,
          amountMinor: neg.currentOfferMinor,
          reservedAt: now,
          expiresAt: new Date(now.getTime() + hours * HOUR),
        },
      },
    },
    { returnDocument: 'before' },
  );
  if (!reserved) throw unavailable();

  const accepted = await step(
    neg,
    {
      status: 'open',
      turn: role,
      currentSeq: input.expectedSeq,
      offerExpiresAt: { $gt: new Date() },
    },
    () => ({ status: 'accepted', turn: null, offerExpiresAt: null }),
    {
      type: 'accept',
      by: role,
      actorId: actor.userId,
      amountMinor: neg.currentOfferMinor,
      currency: neg.currency,
    },
  );
  if (!accepted) {
    // Lost a race with a counter / withdrawal / expiry: give the animal back.
    await Listing.updateOne(
      { _id: listing._id, status: 'RESERVED', 'reservation.negotiationId': neg._id },
      { $set: { status: 'ACTIVE', reservation: null } },
    );
    throw stale();
  }
  await logEvent(listing, 'reserved', actor.userId, {
    from: 'ACTIVE',
    to: 'RESERVED',
    data: {
      negotiationId: String(neg._id),
      amountMinor: neg.currentOfferMinor,
      buyerId: String(neg.buyerId),
    },
  });
  // This is the hand-off to the order/payment step: the animal is held for the buyer at the agreed price.
  await logEvent(listing, 'order.initiated', actor.userId, {
    data: {
      negotiationId: String(neg._id),
      amountMinor: neg.currentOfferMinor,
      currency: neg.currency,
    },
  });
  await audit(actor, 'negotiation.accepted', accepted, {
    amountMinor: neg.currentOfferMinor,
    by: role,
  });
  await cancelOpenNegotiations(listing._id, 'another_offer_accepted', neg._id);
  await offerClosed(
    offerCtx(accepted, listing, neg.currentOfferMinor),
    'accepted',
    role,
    actor.userId,
  );
  return (await toNegotiationDTOs(actor, [accepted], role))[0]!;
}

/** Seller declines (any time while open) or the buyer declines the seller's counter. */
export async function reject(
  actor: Actor,
  id: Types.ObjectId,
  input: { reason?: string | undefined; expectedSeq?: number | undefined },
): Promise<NegotiationDTO> {
  const { neg, listing, role } = await loadFor(actor, id);
  if (role === 'moderator')
    throw forbidden('Moderators can read negotiations but not take part', 'READ_ONLY');
  if (neg.status !== 'open')
    throw err(
      409,
      neg.status === 'expired' ? 'OFFER_EXPIRED' : 'NEGOTIATION_CLOSED',
      'This negotiation is closed',
    );
  if (role === 'seller') await sellerActing(actor, neg);
  if (input.expectedSeq !== undefined && input.expectedSeq !== neg.currentSeq) throw stale();
  const closed = await step(
    neg,
    { status: 'open', currentSeq: neg.currentSeq },
    () => ({
      status: role === 'buyer' ? 'withdrawn' : 'rejected',
      turn: null,
      offerExpiresAt: null,
    }),
    {
      type: role === 'buyer' ? 'withdraw' : 'reject',
      by: role,
      actorId: actor.userId,
      reason: input.reason,
    },
  );
  if (!closed) throw stale();
  await logEvent(
    listing,
    `negotiation.${role === 'buyer' ? 'withdrawn' : 'rejected'}`,
    actor.userId,
    {
      data: { negotiationId: String(neg._id), by: role },
    },
  );
  await audit(actor, role === 'buyer' ? 'negotiation.withdrawn' : 'negotiation.rejected', closed);
  await offerClosed(
    offerCtx(closed, listing, closed.currentOfferMinor),
    role === 'buyer' ? 'withdrawn' : 'rejected',
    role,
    actor.userId,
  );
  return (await toNegotiationDTOs(actor, [closed], role))[0]!;
}

/** Either party backs out of an accepted deal before the sale is completed: the animal becomes available again. */
export async function cancelReservation(
  actor: Actor,
  id: Types.ObjectId,
  input: { reason?: string | undefined },
): Promise<NegotiationDTO> {
  const { neg, listing, role } = await loadFor(actor, id);
  if (role === 'moderator')
    throw forbidden('Moderators can read negotiations but not take part', 'READ_ONLY');
  if (neg.status !== 'accepted')
    throw err(409, 'NOT_ACCEPTED', 'There is no reservation to cancel');
  if (listing.reservation?.orderId)
    throw err(409, 'ORDER_EXISTS', 'An order exists for this deal: cancel the order instead');
  if (role === 'seller') await sellerActing(actor, neg);
  const released = await Listing.findOneAndUpdate(
    // no order may have attached since the read above: from then on the order governs the animal
    {
      _id: listing._id,
      status: 'RESERVED',
      'reservation.negotiationId': neg._id,
      'reservation.orderId': null,
    },
    { $set: { status: 'ACTIVE', reservation: null } },
    { returnDocument: 'before' },
  );
  if (!released) {
    if ((await Listing.findById(listing._id).select('reservation'))?.reservation?.orderId)
      throw err(409, 'ORDER_EXISTS', 'An order exists for this deal: cancel the order instead');
    throw unavailable();
  }
  const closed = await step(
    neg,
    { status: 'accepted' },
    () => ({ status: 'cancelled', turn: null }),
    {
      type: 'cancel',
      by: role,
      actorId: actor.userId,
      reason: input.reason ?? 'reservation_cancelled',
    },
  );
  await logEvent(listing, 'reservation_released', actor.userId, {
    from: 'RESERVED',
    to: 'ACTIVE',
    data: {
      negotiationId: String(neg._id),
      by: role,
      ...(input.reason ? { reason: input.reason } : {}),
    },
  });
  await audit(actor, 'negotiation.reservation_cancelled', neg, { by: role });
  return (await toNegotiationDTOs(actor, [closed ?? neg], role))[0]!;
}

// ---------------------------------------------------------------------------
// System transitions (no actor): used by listing changes and cleanup
// ---------------------------------------------------------------------------
export async function cancelOpenNegotiations(
  listingId: Types.ObjectId,
  reason: string,
  except?: Types.ObjectId,
): Promise<number> {
  const open = await Negotiation.find({
    listingId,
    status: 'open',
    ...(except ? { _id: { $ne: except } } : {}),
  });
  let n = 0;
  for (const neg of open) {
    const done = await step(
      neg,
      { status: 'open' },
      () => ({ status: 'cancelled', turn: null, offerExpiresAt: null }),
      {
        type: 'cancel',
        by: 'seller',
        actorId: String(neg.sellerId),
        reason,
      },
    );
    if (done) n++;
  }
  return n;
}

/** System/order use: an accepted deal falls through (order cancelled, refunded or expired). */
export async function cancelAcceptedNegotiation(
  negotiationId: Types.ObjectId,
  reason: string,
): Promise<void> {
  const neg = await Negotiation.findById(negotiationId);
  if (!neg || neg.status !== 'accepted') return;
  await step(neg, { status: 'accepted' }, () => ({ status: 'cancelled', turn: null }), {
    type: 'cancel',
    by: 'seller',
    actorId: String(neg.sellerId),
    reason,
  });
}

export async function completeNegotiation(
  negotiationId: Types.ObjectId,
  actorId: string,
): Promise<void> {
  const neg = await Negotiation.findById(negotiationId);
  if (!neg || neg.status !== 'accepted') return;
  await step(neg, { status: 'accepted' }, () => ({ status: 'completed', turn: null }), {
    type: 'complete',
    by: 'seller',
    actorId,
  });
}

/** Cleanup: expire stale offers; returns how many. */
export async function expireStaleOffers(now: Date): Promise<number> {
  const rows = await Negotiation.find({ status: 'open', offerExpiresAt: { $lte: now } }).limit(500);
  let n = 0;
  for (const neg of rows) if ((await expireNegotiation(neg)).status === 'expired') n++;
  return n;
}

/** Cleanup: release reservations that were never completed, and ones left half-written by a crash. */
export async function releaseStaleReservations(now: Date): Promise<number> {
  let n = 0;
  const stale = await Listing.find({
    status: 'RESERVED',
    'reservation.expiresAt': { $lte: now },
    'reservation.orderId': null, // an order governs the animal's fate from then on
  }).limit(200);
  for (const l of stale) {
    const released = await Listing.findOneAndUpdate(
      {
        _id: l._id,
        status: 'RESERVED',
        'reservation.negotiationId': l.reservation!.negotiationId,
        'reservation.orderId': null, // re-checked: an order may have attached since the query
      },
      { $set: { status: 'ACTIVE', reservation: null } },
      { returnDocument: 'before' },
    );
    if (!released) continue;
    const neg = await Negotiation.findById(l.reservation!.negotiationId);
    if (neg?.status === 'accepted')
      await step(neg, { status: 'accepted' }, () => ({ status: 'expired', turn: null }), {
        type: 'expire',
        by: 'buyer',
        actorId: String(neg.buyerId),
        reason: 'reservation_expired',
      });
    await logEvent(l, 'reservation_expired', null, {
      from: 'RESERVED',
      to: 'ACTIVE',
      data: { negotiationId: String(l.reservation!.negotiationId) },
    });
    n++;
  }
  return n;
}

export type { NegotiationStatus };
