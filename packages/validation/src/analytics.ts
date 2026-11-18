import { z } from 'zod';
import {
  ADMIN_EXPORT_SECTIONS,
  FARM_DASHBOARD_SECTIONS,
  FARM_EXPORT_SECTIONS,
  GRANULARITIES,
} from '@farmplus/shared-types';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const key = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Invalid filter');
const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/** Dates are calendar days in Thailand time; both ends inclusive. Empty = the last 30 days. */
const range = {
  from: day.optional(),
  to: day.optional(),
  granularity: z.enum(GRANULARITIES).optional(),
  /** Bypass the short-lived cache. */
  fresh: bool.optional(),
};

export const farmDashboardQuerySchema = z
  .object({
    ...range,
    animalType: key.optional(),
    orderKind: z.enum(['animal', 'product']).optional(),
    sections: z
      .string()
      .transform((v) => v.split(',').filter(Boolean))
      .pipe(z.array(z.enum(FARM_DASHBOARD_SECTIONS)).max(FARM_DASHBOARD_SECTIONS.length))
      .optional(),
  })
  .strict();

export const adminDashboardQuerySchema = z
  .object({ ...range, orderKind: z.enum(['animal', 'product']).optional() })
  .strict();

export const farmExportQuerySchema = z
  .object({
    ...range,
    section: z.enum(FARM_EXPORT_SECTIONS),
    animalType: key.optional(),
    orderKind: z.enum(['animal', 'product']).optional(),
  })
  .strict();
export const adminExportQuerySchema = z
  .object({
    ...range,
    section: z.enum(ADMIN_EXPORT_SECTIONS),
    orderKind: z.enum(['animal', 'product']).optional(),
  })
  .strict();
