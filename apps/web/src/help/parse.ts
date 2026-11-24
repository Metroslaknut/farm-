/**
 * Help articles are Markdown files with frontmatter (`src/help/content/{th,en}/<slug>.md`). They are the single source
 * for the help centre, the guided tours' "read more" links and (later) the assistant's knowledge.
 *
 * Only a small, documented subset of Markdown is supported, parsed here into plain data (rendered as React elements —
 * never as HTML, so content cannot inject markup). Anything outside the subset is an error, caught by the content test.
 *
 *   ---                                   frontmatter: `key: value`, lists as `[a, b, c]`
 *   slug: register-email
 *   ---
 *   Intro paragraph.                      paragraph (consecutive lines are joined)
 *   ## Heading                            section heading (h2)
 *   1. Do this "Button"                   numbered step (the steps make the table of contents)
 *      ![What the picture shows](img:1)   the step's picture: img:<id> → /help/img/<slug>/<id>-<locale>-<width>.webp
 *   - item                                bullet list
 *   :::trouble Did not get the email?     "if something goes wrong" box, until the closing `:::`
 *   …paragraphs / bullets…
 *   :::
 *   :::note …  /  :::warning …            notice boxes (same syntax)
 *   Inline: **bold**, [text](/route) for a page in FARM+, [text](help:slug) for another article.
 */

export const AUDIENCES = ['guest', 'member', 'farm_owner', 'seller', 'staff'] as const;
export type Audience = (typeof AUDIENCES)[number];
export const CATEGORIES = ['getting-started', 'account', 'farm', 'selling', 'buying'] as const;
export type Category = (typeof CATEGORIES)[number];
/** `messaging-pending`: the article depends on e-mail / SMS delivery, which is not switched on yet. */
export const AVAILABILITY = ['available', 'messaging-pending'] as const;
export type Availability = (typeof AVAILABILITY)[number];

export interface ArticleMeta {
  slug: string;
  title: string;
  summary: string;
  audience: Audience;
  category: Category;
  /** Routes (react-router patterns) the article is about: matched against the current page. */
  relatedRoutes: string[];
  /** Words people are likely to type, e.g. "ไม่ได้รับอีเมล". */
  keywords: string[];
  order: number;
  updatedAt: string;
  /** The "go to this page" button. */
  goTo?: string;
  availability: Availability;
}

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'link'; text: string; to: string }
  | { kind: 'help'; text: string; slug: string };

export interface ImageRef {
  id: string;
  alt: string;
}

export type Block =
  | { kind: 'paragraph'; content: Inline[] }
  | { kind: 'heading'; text: string; id: string }
  | { kind: 'steps'; items: { content: Inline[]; image?: ImageRef }[] }
  | { kind: 'bullets'; items: Inline[][] }
  | { kind: 'box'; tone: 'trouble' | 'note' | 'warning'; title: string; blocks: Block[] };

export interface Article extends ArticleMeta {
  locale: 'th' | 'en';
  blocks: Block[];
}

export class HelpContentError extends Error {}

const LIST_KEYS = new Set(['relatedRoutes', 'keywords']);
const REQUIRED = [
  'slug',
  'title',
  'summary',
  'audience',
  'category',
  'order',
  'updatedAt',
] as const;

function parseFrontmatter(lines: string[], file: string): { meta: ArticleMeta; rest: string[] } {
  if (lines[0]?.trim() !== '---')
    throw new HelpContentError(`${file}: must start with --- frontmatter`);
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new HelpContentError(`${file}: frontmatter is not closed with ---`);
  const raw: Record<string, string | string[]> = {};
  for (const line of lines.slice(1, end)) {
    if (!line.trim()) continue;
    const m = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!m) throw new HelpContentError(`${file}: bad frontmatter line "${line}"`);
    const [, key, value] = m as unknown as [string, string, string];
    if (LIST_KEYS.has(key)) {
      const list = /^\[(.*)\]$/.exec(value.trim());
      if (!list) throw new HelpContentError(`${file}: ${key} must be a [list]`);
      raw[key] = list[1]!
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    } else raw[key] = value.trim();
  }
  for (const key of REQUIRED)
    if (!raw[key]) throw new HelpContentError(`${file}: frontmatter "${key}" is required`);
  const str = (k: string) => raw[k] as string;
  const audience = str('audience');
  const category = str('category');
  const availability = (raw['availability'] as string | undefined) ?? 'available';
  if (!(AUDIENCES as readonly string[]).includes(audience))
    throw new HelpContentError(`${file}: unknown audience "${audience}"`);
  if (!(CATEGORIES as readonly string[]).includes(category))
    throw new HelpContentError(`${file}: unknown category "${category}"`);
  if (!(AVAILABILITY as readonly string[]).includes(availability))
    throw new HelpContentError(`${file}: unknown availability "${availability}"`);
  const order = Number(str('order'));
  if (!Number.isInteger(order)) throw new HelpContentError(`${file}: order must be a whole number`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str('updatedAt')))
    throw new HelpContentError(`${file}: updatedAt must be YYYY-MM-DD`);
  const meta: ArticleMeta = {
    slug: str('slug'),
    title: str('title'),
    summary: str('summary'),
    audience: audience as Audience,
    category: category as Category,
    relatedRoutes: (raw['relatedRoutes'] as string[] | undefined) ?? [],
    keywords: (raw['keywords'] as string[] | undefined) ?? [],
    order,
    updatedAt: str('updatedAt'),
    availability: availability as Availability,
    ...(raw['goTo'] ? { goTo: str('goTo') } : {}),
  };
  return { meta, rest: lines.slice(end + 1) };
}

/** `**bold**`, `[text](/route)`, `[text](help:slug)`; anything else is text. External links are refused. */
export function parseInline(text: string, file: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: 'bold', text: m[1] });
    else {
      const [label, target] = [m[2]!, m[3]!];
      if (target.startsWith('help:'))
        out.push({ kind: 'help', text: label, slug: target.slice(5) });
      else if (target.startsWith('/')) out.push({ kind: 'link', text: label, to: target });
      else
        throw new HelpContentError(
          `${file}: only /routes and help:slug links are allowed ("${target}")`,
        );
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

const headingId = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');

function parseBlocks(
  lines: string[],
  file: string,
  nested = false,
): { blocks: Block[]; used: number } {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'paragraph', content: parseInline(para.join(' '), file) });
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      i++;
      continue;
    }
    if (trimmed === ':::') {
      if (!nested) throw new HelpContentError(`${file}: ::: closes a box that was never opened`);
      flush();
      return { blocks, used: i + 1 };
    }
    const box = /^:::(trouble|note|warning)\s+(.+)$/.exec(trimmed);
    if (box) {
      flush();
      if (nested) throw new HelpContentError(`${file}: boxes cannot be nested`);
      const inner = parseBlocks(lines.slice(i + 1), file, true);
      blocks.push({
        kind: 'box',
        tone: box[1] as 'trouble' | 'note' | 'warning',
        title: box[2]!,
        blocks: inner.blocks,
      });
      i += 1 + inner.used;
      continue;
    }
    if (trimmed.startsWith('### ') || trimmed.startsWith('# '))
      throw new HelpContentError(`${file}: only "## " headings are allowed ("${trimmed}")`);
    if (trimmed.startsWith('## ')) {
      flush();
      const text = trimmed.slice(3).trim();
      blocks.push({ kind: 'heading', text, id: headingId(text) });
      i++;
      continue;
    }
    if (/^\d+\.\s/.test(trimmed)) {
      flush();
      const items: { content: Inline[]; image?: ImageRef }[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i]!.trim())) {
        const item: { content: Inline[]; image?: ImageRef } = {
          content: parseInline(lines[i]!.trim().replace(/^\d+\.\s+/, ''), file),
        };
        i++;
        const img = /^\s+!\[([^\]]+)\]\(img:([a-z0-9-]+)\)\s*$/.exec(lines[i] ?? '');
        if (img) {
          item.image = { alt: img[1]!, id: img[2]! };
          i++;
        }
        items.push(item);
      }
      blocks.push({ kind: 'steps', items });
      continue;
    }
    if (trimmed.startsWith('- ')) {
      flush();
      const items: Inline[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('- ')) {
        items.push(parseInline(lines[i]!.trim().slice(2), file));
        i++;
      }
      blocks.push({ kind: 'bullets', items });
      continue;
    }
    if (trimmed.startsWith('!['))
      throw new HelpContentError(`${file}: pictures belong to a numbered step`);
    para.push(trimmed);
    i++;
  }
  if (nested) throw new HelpContentError(`${file}: a ::: box is not closed`);
  flush();
  return { blocks, used: i };
}

export function parseArticle(source: string, locale: 'th' | 'en', file: string): Article {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const { meta, rest } = parseFrontmatter(lines, file);
  return { ...meta, locale, blocks: parseBlocks(rest, file).blocks };
}

/** Every step picture of an article, in order. */
export const imagesOf = (article: Article): ImageRef[] =>
  article.blocks.flatMap((b) =>
    b.kind === 'steps' ? b.items.flatMap((it) => (it.image ? [it.image] : [])) : [],
  );

/** Every internal link (routes and help articles) an article makes, including inside boxes. */
export function linksOf(article: Article): Inline[] {
  const fromInline = (xs: Inline[]) => xs.filter((x) => x.kind === 'link' || x.kind === 'help');
  const walk = (blocks: Block[]): Inline[] =>
    blocks.flatMap((b) =>
      b.kind === 'paragraph'
        ? fromInline(b.content)
        : b.kind === 'steps'
          ? b.items.flatMap((it) => fromInline(it.content))
          : b.kind === 'bullets'
            ? b.items.flatMap(fromInline)
            : b.kind === 'box'
              ? walk(b.blocks)
              : [],
    );
  return walk(article.blocks);
}

/** Screenshot widths: phone and desktop. */
export const IMAGE_WIDTHS = [375, 1280] as const;
export const imagePath = (slug: string, id: string, locale: string, width: number) =>
  `/help/img/${slug}/${id}-${locale}-${width}.webp`;
