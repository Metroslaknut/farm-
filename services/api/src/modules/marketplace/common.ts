import type { Types } from 'mongoose';
import type { ListingEventDTO, ListingStatus } from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { conflict } from '../../lib/errors';
import { Animal, Farm, FarmMember, ListingEvent, type ListingDoc } from '../../models';
import { authorOf, authorsById } from '../community/shared';

export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The seller side of a listing = owners and managers of its farm (not platform staff, not workers/viewers). */
export async function isSellerSide(userId: string, farmId: Types.ObjectId): Promise<boolean> {
  return Boolean(await FarmMember.exists({ farmId, userId, role: { $in: ['owner', 'manager'] } }));
}

/**
 * The animal behind a listing can still be sold: not archived, active / for sale, and not already sold through the
 * marketplace. Checked when listing, and again when a deal is struck (its status may have changed meanwhile).
 */
export async function assertAnimalSellable(animalId: Types.ObjectId): Promise<void> {
  const animal = await Animal.findById(animalId).select('archivedAt currentStatus');
  if (!animal || animal.archivedAt)
    throw conflict('Archived animals cannot be sold', 'ANIMAL_NOT_SELLABLE');
  if (!['active', 'for_sale'].includes(animal.currentStatus))
    throw conflict(
      `An animal that is ${animal.currentStatus.replace('_', ' ')} cannot be sold`,
      'ANIMAL_NOT_SELLABLE',
    );
}

/**
 * An archived farm is read-only (farms.md), and that includes its shop window: its listings drop out of public browsing
 * and nobody can start, counter or accept a deal on them. Nothing is changed on the listings themselves, so a restored
 * farm's listings are simply public again (a deal already struck before archiving is left to complete).
 */
export const archivedFarmIds = (): Promise<Types.ObjectId[]> =>
  Farm.distinct('_id', { status: 'archived' });

export const isFarmArchived = async (farmId: Types.ObjectId): Promise<boolean> =>
  Boolean(await Farm.exists({ _id: farmId, status: 'archived' }));

export async function assertFarmTrading(farmId: Types.ObjectId): Promise<void> {
  if (await isFarmArchived(farmId))
    throw conflict('This farm is archived and is not trading', 'FARM_ARCHIVED');
}

/** Platform moderators (permission `listings.moderate`, MFA-verified) may review listings and read negotiations. */
export const isModerator = (actor: Actor): boolean =>
  actor.access.permissions.has('listings.moderate');

export async function logEvent(
  listing: Pick<ListingDoc, '_id' | 'farmId'>,
  type: string,
  actorId: string | Types.ObjectId | null,
  extra: { from?: ListingStatus; to?: ListingStatus; data?: Record<string, unknown> } = {},
): Promise<void> {
  await ListingEvent.create({
    listingId: listing._id,
    farmId: listing.farmId,
    type,
    actorId,
    from: extra.from ?? null,
    to: extra.to ?? null,
    data: extra.data,
  });
}

export async function eventDTOs(listingId: Types.ObjectId): Promise<ListingEventDTO[]> {
  const rows = await ListingEvent.find({ listingId }).sort({ at: 1, _id: 1 }).limit(500);
  const people = await authorsById(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])));
  return rows.map((r) => ({
    id: String(r._id),
    type: r.type,
    ...(r.actorId ? { actor: authorOf(people, r.actorId) } : {}),
    from: r.from ?? null,
    to: r.to ?? null,
    ...(r.data ? { data: r.data } : {}),
    at: r.at.toISOString(),
  }));
}
