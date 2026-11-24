import type { HelpFeedbackInput } from '@farmplus/validation';
import { HelpFeedback } from '../../models';

/**
 * Adds one anonymous vote to an article's counters (one document per article and language, created on first vote).
 * Not audited: it is an anonymous counter, not business data, and records nothing about who voted.
 */
export async function recordHelpFeedback(input: HelpFeedbackInput): Promise<void> {
  await HelpFeedback.updateOne(
    { slug: input.slug, locale: input.locale },
    { $inc: input.helpful ? { helpful: 1 } : { notHelpful: 1 } },
    { upsert: true },
  );
}
