import { z } from 'zod';

/** `POST /help/feedback`: an anonymous "was this article helpful?" vote. */
export const helpFeedbackSchema = z
  .object({
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Invalid article')
      .max(80),
    locale: z.enum(['th', 'en']),
    helpful: z.boolean(),
  })
  .strict();
export type HelpFeedbackInput = z.infer<typeof helpFeedbackSchema>;
