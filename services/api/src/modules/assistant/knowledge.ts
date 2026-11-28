import type { KnowledgeChunk } from './build-index';
import index from './help-index.json';

/**
 * Search over the help chunks: BM25 on Thai word segments (Intl.Segmenter, as the help centre's own search) and
 * English words, with the article's keywords and title weighted higher, and a small boost for articles about the page
 * the question was asked from. No model involved: this is also the whole answer in "search" mode.
 */
const CHUNKS = index as KnowledgeChunk[];

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter('th', { granularity: 'word' })
    : null;
const STOP = new Set([
  'ที่',
  'และ',
  'ได้',
  'ให้',
  'ของ',
  'ใน',
  'จะ',
  'ไม่',
  'มี',
  'เป็น',
  'การ',
  'ยังไง',
  'ยัง',
  'ไง',
  'ทำ',
  'ต้อง',
  'บ้าง',
  'อะไร',
  'ทำไม',
  'อย่างไร',
  'ไหม',
  'ครับ',
  'ค่ะ',
  'คะ',
  'นะ',
  'the',
  'a',
  'an',
  'to',
  'of',
  'and',
  'how',
  'i',
  'do',
  'is',
  'my',
  'can',
]);

export function words(text: string): string[] {
  const lower = text.toLowerCase();
  const raw = segmenter
    ? [...segmenter.segment(lower)].filter((s) => s.isWordLike).map((s) => s.segment)
    : lower.split(/[^\p{L}\p{N}]+/u);
  return raw.map((w) => w.trim()).filter((w) => w.length > 0 && !STOP.has(w));
}

interface Doc {
  chunk: KnowledgeChunk;
  tf: Map<string, number>;
  length: number;
}

const WEIGHT = { keywords: 3, title: 2, heading: 1.5, text: 1 } as const;

function docOf(c: KnowledgeChunk): Doc {
  const tf = new Map<string, number>();
  const add = (ws: string[], w: number) => ws.forEach((t) => tf.set(t, (tf.get(t) ?? 0) + w));
  add(c.keywords.flatMap(words), WEIGHT.keywords);
  add(words(c.title), WEIGHT.title);
  add(words(c.heading), WEIGHT.heading);
  add(words(c.text), WEIGHT.text);
  let length = 0;
  tf.forEach((v) => (length += v));
  return { chunk: c, tf, length };
}

const byLocale = new Map<'th' | 'en', { docs: Doc[]; df: Map<string, number>; avg: number }>();
function corpus(locale: 'th' | 'en') {
  let hit = byLocale.get(locale);
  if (!hit) {
    const docs = CHUNKS.filter((c) => c.locale === locale).map(docOf);
    const df = new Map<string, number>();
    for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    const avg = docs.reduce((a, d) => a + d.length, 0) / Math.max(1, docs.length);
    hit = { docs, df, avg };
    byLocale.set(locale, hit);
  }
  return hit;
}

const K1 = 1.2;
const B = 0.75;

const routeMatches = (pattern: string, route: string) =>
  new RegExp(
    `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[^/]+/g, '[^/]+')}$`,
  ).test(route);

export interface Hit {
  chunk: KnowledgeChunk;
  score: number;
}

/** The best chunks for a question, most relevant first. */
export function searchChunks(
  query: string,
  locale: 'th' | 'en',
  options: { route?: string | undefined; limit?: number } = {},
): Hit[] {
  const { docs, df, avg } = corpus(locale);
  const terms = [...new Set(words(query))];
  // Also match the question as one run of letters against keywords ("รหัสsmsไม่มา"): people type without spaces.
  const compact = query.toLowerCase().replace(/\s+/g, '');
  const n = docs.length;
  const hits: Hit[] = [];
  for (const d of docs) {
    let score = 0;
    for (const t of terms) {
      const f = d.tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (n - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      score += (idf * (f * (K1 + 1))) / (f + K1 * (1 - B + (B * d.length) / avg));
    }
    if (
      d.chunk.keywords.some(
        (k) => k.length >= 4 && compact.includes(k.toLowerCase().replace(/\s+/g, '')),
      )
    )
      score += 5;
    if (
      score > 0 &&
      options.route &&
      d.chunk.relatedRoutes.some((r) => routeMatches(r, options.route!))
    )
      score *= 1.2;
    if (score > 0) hits.push({ chunk: d.chunk, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, options.limit ?? 5);
}

/** Distinct articles of the hits, in order (for citations and search mode). */
export function articlesOf(hits: Hit[], limit = 3): { slug: string; title: string }[] {
  const seen = new Map<string, string>();
  for (const h of hits) if (!seen.has(h.chunk.slug)) seen.set(h.chunk.slug, h.chunk.title);
  return [...seen].slice(0, limit).map(([slug, title]) => ({ slug, title }));
}
