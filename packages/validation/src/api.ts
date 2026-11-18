import { z } from 'zod';
import type { ApiErrorResponse } from '@farmplus/shared-types';

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
}) satisfies z.ZodType<ApiErrorResponse>;
