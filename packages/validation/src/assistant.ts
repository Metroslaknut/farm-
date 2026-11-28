import { z } from 'zod';

/** A question to the assistant: short text, the page it was asked from (only used to rank related articles). */
export const assistantAskSchema = z
  .object({
    message: z.string().trim().min(2, 'At least 2 characters').max(500, 'At most 500 characters'),
    locale: z.enum(['th', 'en']).default('th'),
    context: z
      .object({ route: z.string().trim().max(200).optional() })
      .strict()
      .default({}),
  })
  .strict();
export type AssistantAskInput = z.infer<typeof assistantAskSchema>;
