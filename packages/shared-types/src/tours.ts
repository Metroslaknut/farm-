/** Guided tours: how a signed-in user left a tour (`/me/tours`). */
export const TOUR_STATUSES = ['completed', 'skipped', 'dismissed_forever'] as const;
export type TourStatus = (typeof TOUR_STATUSES)[number];

export interface TourProgressDTO {
  tourId: string;
  version: number;
  status: TourStatus;
  lastStep: number;
  updatedAt: string;
}
