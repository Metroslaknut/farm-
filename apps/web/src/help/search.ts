import type { Article } from './parse';
import { plainText } from './content';

/**
 * Client-side help search. Thai has no spaces between words, so text is split with `Intl.Segmenter` (word granularity);
 * where it is missing, a whitespace split is the fallback. Each query word counts where it appears: keywords (what
 * people type, e.g. "ไม่ได้รับอีเมล") weigh most, then the title, the summary and the body. A query that appears whole
 * inside a keyword or the title gets a bonus, so a phrase beats scattered single words.
 */
const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter('th', { granularity: 'word' })
    : undefined;

const STOP = new Set([
  'ที่',
  'และ',
  'ของ',
  'ได้',
  'ให้',
  'ใน',
  'the',
  'a',
  'an',
  'to',
  'of',
  'and',
  'how',
  'i',
]);

export function words(text: string): string[] {
  const lower = text.toLowerCase();
  const raw = segmenter
    ? [...segmenter.segment(lower)].filter((s) => s.isWordLike).map((s) => s.segment)
    : lower.split(/[^\p{L}\p{N}]+/u);
  return raw.map((w) => w.trim()).filter((w) => w.length > 0 && !STOP.has(w));
}

const WEIGHTS = { keywords: 5, title: 3, summary: 2, body: 1 } as const;

interface Indexed {
  article: Article;
  fields: Record<keyof typeof WEIGHTS, Set<string>>;
  phrases: string[];
}

const cache = new WeakMap<Article, Indexed>();
function indexOf(a: Article): Indexed {
  let hit = cache.get(a);
  if (!hit) {
    hit = {
      article: a,
      fields: {
        keywords: new Set(a.keywords.flatMap(words)),
        title: new Set(words(a.title)),
        summary: new Set(words(a.summary)),
        body: new Set(words(plainText(a))),
      },
      phrases: [...a.keywords, a.title].map((p) => p.toLowerCase().replace(/\s+/g, '')),
    };
    cache.set(a, hit);
  }
  return hit;
}

export function search(list: Article[], query: string, limit = 10): Article[] {
  const q = words(query);
  if (q.length === 0) return [];
  const compact = query.toLowerCase().replace(/\s+/g, '');
  return list
    .map((a) => {
      const ix = indexOf(a);
      let score = 0;
      for (const w of q)
        for (const [field, weight] of Object.entries(WEIGHTS) as [keyof typeof WEIGHTS, number][])
          if (ix.fields[field].has(w)) score += weight;
      if (compact.length > 1 && ix.phrases.some((p) => p.includes(compact) || compact.includes(p)))
        score += 10;
      return { a, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || x.a.order - y.a.order)
    .slice(0, limit)
    .map((x) => x.a);
}
