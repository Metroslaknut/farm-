import { z } from 'zod';
import { TOUR_STATUSES } from '@farmplus/shared-types';

/** Tour ids are code-defined (`apps/web/src/tours`): lower-case words joined by hyphens. */
export const tourIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Invalid tour')
  .max(60);

/** `PUT /me/tours/:tourId` — the caller's own progress only (there is no user field to set). */
export const tourProgressSchema = z
  .object({
    version: z.number().int().min(1).max(1000),
    status: z.enum(TOUR_STATUSES),
    lastStep: z.number().int().min(0).max(50),
  })
  .strict();
export type TourProgressInput = z.infer<typeof tourProgressSchema>;
