import { parseArticle, type Article, type Block, type Inline } from './parse';

/**
 * All help articles, parsed once. The Markdown is bundled into the (lazy) help chunk only: nothing here loads on pages
 * that do not show help.
 */
const files = import.meta.glob('./content/*/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export type HelpLocale = 'th' | 'en';

function load(): Record<HelpLocale, Article[]> {
  const out: Record<HelpLocale, Article[]> = { th: [], en: [] };
  for (const [path, source] of Object.entries(files)) {
    const m = /\.\/content\/(th|en)\/([a-z0-9-]+)\.md$/.exec(path);
    if (!m) throw new Error(`help content in an unexpected place: ${path}`);
    const locale = m[1] as HelpLocale;
    const article = parseArticle(source, locale, path);
    if (article.slug !== m[2]) throw new Error(`${path}: slug must match the file name`);
    out[locale].push(article);
  }
  for (const list of Object.values(out))
    list.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  return out;
}

const ARTICLES = load();

export const articles = (locale: HelpLocale): Article[] => ARTICLES[locale];
export const article = (locale: HelpLocale, slug: string): Article | undefined =>
  ARTICLES[locale].find((a) => a.slug === slug);

/** "Getting started" first, then the others in the order they first appear. */
export function byCategory(
  locale: HelpLocale,
): { category: Article['category']; items: Article[] }[] {
  const groups = new Map<Article['category'], Article[]>();
  for (const a of ARTICLES[locale]) groups.set(a.category, [...(groups.get(a.category) ?? []), a]);
  const order = [...groups.keys()].sort((a, b) =>
    a === 'getting-started' ? -1 : b === 'getting-started' ? 1 : 0,
  );
  return order.map((category) => ({ category, items: groups.get(category)! }));
}

/** Plain text of an article (for search and, later, the assistant's index). */
export function plainText(a: Article): string {
  const inline = (xs: Inline[]) => xs.map((x) => x.text).join('');
  const walk = (blocks: Block[]): string[] =>
    blocks.flatMap((b) =>
      b.kind === 'paragraph'
        ? [inline(b.content)]
        : b.kind === 'heading'
          ? [b.text]
          : b.kind === 'steps'
            ? b.items.map((it) => inline(it.content))
            : b.kind === 'bullets'
              ? b.items.map(inline)
              : [b.title, ...walk(b.blocks)],
    );
  return walk(a.blocks).join('\n');
}
