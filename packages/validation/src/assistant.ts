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

/** `GET /assistant/suggestions` — the page and (optionally) the farm being looked at. */
export const assistantSuggestionsQuerySchema = z
  .object({
    route: z.string().trim().max(200).optional(),
    farmId: z
      .string()
      .regex(/^[a-f0-9]{24}$/, 'Invalid id')
      .optional(),
  })
  .strict();

/** `PUT /me/assistant-tips/:key` — hide a tip for good, or be reminded in 7 (Thai) days. */
export const assistantTipKeySchema = z
  .string()
  .regex(/^[a-z-]+(?::[a-f0-9]{24})?$/, 'Invalid tip')
  .max(80);
export const assistantTipStateSchema = z.object({ action: z.enum(['hide', 'snooze']) }).strict();
