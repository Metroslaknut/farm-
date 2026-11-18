import { z } from 'zod';
import type { HealthResponse } from '@farmplus/shared-types';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  environment: z.string(),
  deployment: z.string().optional(),
  commit: z.string().optional(),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.iso.datetime(),
}) satisfies z.ZodType<HealthResponse>;
