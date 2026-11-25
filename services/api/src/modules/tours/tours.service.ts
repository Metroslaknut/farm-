import { Types } from 'mongoose';
import type { TourProgressDTO } from '@farmplus/shared-types';
import type { TourProgressInput } from '@farmplus/validation';
import { UserTourProgress, type UserTourProgressDoc } from '../../models';

const toDTO = (d: UserTourProgressDoc): TourProgressDTO => ({
  tourId: d.tourId,
  version: d.version,
  status: d.status,
  lastStep: d.lastStep,
  updatedAt: d.updatedAt.toISOString(),
});

/** The caller's progress on every tour they have finished, skipped or dismissed. */
export async function listMyTours(userId: string): Promise<TourProgressDTO[]> {
  const rows = await UserTourProgress.find({ userId: new Types.ObjectId(userId) }).sort({
    tourId: 1,
  });
  return rows.map(toDTO);
}

/**
 * Records how the caller left a tour (one document per user and tour; the latest answer wins). Only ever the caller's
 * own: the user comes from the token, never from the request.
 */
export async function saveMyTour(
  userId: string,
  tourId: string,
  input: TourProgressInput,
): Promise<TourProgressDTO> {
  const doc = await UserTourProgress.findOneAndUpdate(
    { userId: new Types.ObjectId(userId), tourId },
    { $set: { version: input.version, status: input.status, lastStep: input.lastStep } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  );
  return toDTO(doc!);
}
