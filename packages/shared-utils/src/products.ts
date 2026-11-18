/** Pure product helpers shared by the API and the apps. Integer satang throughout. */

export interface PromotionLike {
  priceMinor: number;
  startsAt: Date;
  endsAt: Date;
}

/** The unit price a buyer pays at `now`: the promotion price while it runs (and is really lower), otherwise the list price. */
export function effectivePrice(
  priceMinor: number,
  promotion: PromotionLike | null | undefined,
  now: Date = new Date(),
): { priceMinor: number; onSale: boolean } {
  if (
    promotion &&
    promotion.priceMinor < priceMinor &&
    now >= promotion.startsAt &&
    now < promotion.endsAt
  )
    return { priceMinor: promotion.priceMinor, onSale: true };
  return { priceMinor, onSale: false };
}

/** Terms settings are free text: comma- or newline-separated, case-insensitive, blanks ignored. */
export function parseTerms(raw: string | undefined | null): string[] {
  return [
    ...new Set(
      (raw ?? '')
        .split(/[\n,;]+/)
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length >= 2),
    ),
  ];
}

/** Normalise for matching: lower case, Unicode-folded, runs of whitespace/punctuation become one space. */
const fold = (s: string): string =>
  s
    .normalize('NFKC')
    .toLowerCase()
    // whitespace and zero-width characters collapse to one space
    .replace(new RegExp('[\\s\\u200B-\\u200D\\uFEFF]+', 'g'), ' ')
    .trim();

/**
 * Returns the terms found in `texts`. Latin terms must match whole words (so "cure" does not flag "secure");
 * terms in other scripts (e.g. Thai, which has no spaces between words) match as substrings.
 */
export function findTerms(
  texts: readonly (string | null | undefined)[],
  terms: readonly string[],
): string[] {
  const haystack = ` ${fold(texts.filter(Boolean).join(' \n '))} `;
  const found: string[] = [];
  for (const raw of terms) {
    const term = fold(raw);
    if (!term) continue;
    const latin = [...term].every((ch) => ch.charCodeAt(0) < 128);
    const hit = latin
      ? new RegExp(`(?<![a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`).test(
          haystack,
        )
      : haystack.includes(term);
    if (hit) found.push(raw);
  }
  return found;
}
