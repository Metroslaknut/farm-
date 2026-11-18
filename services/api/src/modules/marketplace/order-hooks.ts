import type { Types } from 'mongoose';
import { Animal, Listing } from '../../models';
import { logEvent } from './common';
import {
  cancelAcceptedNegotiation,
  cancelOpenNegotiations,
  completeNegotiation,
} from './negotiations.service';

/**
 * What the order module may do to the marketplace. Every function is a single atomic update keyed on the reservation
 * that belongs to THIS negotiation, so an order can only ever touch the deal it was created from.
 */

/** Pin the reservation to the order and keep it alive until the payment deadline. */
export async function attachOrder(
  listingId: Types.ObjectId,
  negotiationId: Types.ObjectId,
  orderId: Types.ObjectId,
  holdUntil: Date,
): Promise<boolean> {
  const res = await Listing.updateOne(
    {
      _id: listingId,
      status: 'RESERVED',
      'reservation.negotiationId': negotiationId,
      'reservation.orderId': null,
      'reservation.expiresAt': { $gt: new Date() }, // an expired hold is cleanup's to release, not to extend
    },
    { $set: { 'reservation.orderId': orderId, 'reservation.expiresAt': holdUntil } },
  );
  return res.modifiedCount === 1;
}

/** The order fell through (cancelled, expired, refunded): the animal is available again. */
export async function releaseForOrder(
  listingId: Types.ObjectId,
  negotiationId: Types.ObjectId,
  orderId: Types.ObjectId,
  reason: string,
): Promise<void> {
  const before = await Listing.findOneAndUpdate(
    { _id: listingId, status: 'RESERVED', 'reservation.orderId': orderId },
    { $set: { status: 'ACTIVE', reservation: null } },
    { returnDocument: 'before' },
  );
  if (before) {
    await logEvent(before, 'reservation_released', null, {
      from: 'RESERVED',
      to: 'ACTIVE',
      data: { negotiationId: String(negotiationId), orderId: String(orderId), reason },
    });
  }
  await cancelAcceptedNegotiation(negotiationId, reason);
}

/** The buyer received the animal: the sale is complete and the animal can never be sold again. */
export async function completeSaleForOrder(
  listingId: Types.ObjectId,
  negotiationId: Types.ObjectId,
  orderId: Types.ObjectId,
  actorId: string | null,
): Promise<void> {
  const before = await Listing.findOneAndUpdate(
    { _id: listingId, status: 'RESERVED', 'reservation.orderId': orderId },
    { $set: { status: 'SOLD', soldAt: new Date() } },
    { returnDocument: 'before' },
  );
  if (!before) return;
  await logEvent(before, 'sold', actorId, {
    from: 'RESERVED',
    to: 'SOLD',
    data: {
      negotiationId: String(negotiationId),
      orderId: String(orderId),
      amountMinor: before.reservation?.amountMinor,
    },
  });
  await completeNegotiation(negotiationId, actorId ?? String(before.sellerId));
  await cancelOpenNegotiations(listingId, 'animal_sold');
  await Animal.updateOne(
    { _id: before.animalId, farmId: before.farmId },
    { $set: { currentStatus: 'sold' } },
  );
}
