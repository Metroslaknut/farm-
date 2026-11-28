import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseArticle,
  type Article,
  type Block,
  type Inline,
} from '../../../../../apps/web/src/help/parse';

/**
 * The assistant's knowledge: every help article cut into chunks (the article's header, then one chunk per heading),
 * built from the same Markdown the help centre shows. Written to help-index.json by `pnpm --filter @farmplus/api
 * assistant:index`; a test rebuilds it and fails when the committed file is out of date.
 */
export interface KnowledgeChunk {
  id: string;
  slug: string;
  locale: 'th' | 'en';
  title: string;
  /** Section heading (empty for the article's header chunk). */
  heading: string;
  text: string;
  /** Words people type for this article (weighted higher in search). */
  keywords: string[];
  relatedRoutes: string[];
}

const CONTENT = join(import.meta.dirname, '../../../../../apps/web/src/help/content');

const inline = (parts: Inline[]): string => parts.map((p) => p.text).join('');

function blockText(b: Block): string {
  switch (b.kind) {
    case 'paragraph':
      return inline(b.content);
    case 'heading':
      return b.text;
    case 'steps':
      return b.items.map((it, i) => `${i + 1}. ${inline(it.content)}`).join('\n');
    case 'bullets':
      return b.items.map((it) => `- ${inline(it)}`).join('\n');
    case 'box':
      return [b.title, ...b.blocks.map(blockText)].join('\n');
  }
}

function chunksOf(a: Article): KnowledgeChunk[] {
  const base = {
    slug: a.slug,
    locale: a.locale,
    title: a.title,
    keywords: a.keywords,
    relatedRoutes: a.relatedRoutes,
  };
  const out: KnowledgeChunk[] = [];
  let heading = '';
  let parts: string[] = [a.summary];
  const flush = () => {
    const text = parts.filter(Boolean).join('\n').trim();
    if (text) out.push({ ...base, id: `${a.locale}:${a.slug}:${out.length}`, heading, text });
  };
  for (const b of a.blocks) {
    if (b.kind === 'heading') {
      flush();
      heading = b.text;
      parts = [];
    } else parts.push(blockText(b));
  }
  flush();
  return out;
}

export function buildKnowledge(): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  for (const locale of ['th', 'en'] as const) {
    const dir = join(CONTENT, locale);
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort())
      chunks.push(...chunksOf(parseArticle(readFileSync(join(dir, file), 'utf8'), locale, file)));
  }
  return chunks;
}
