import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HelpContentError,
  IMAGE_WIDTHS,
  imagePath,
  imagesOf,
  linksOf,
  parseArticle,
  type Article,
} from '../src/help/parse';

/**
 * The help content is the single source for /help, the tours and the assistant: it must be complete in both
 * languages, every picture must exist, and every link must lead somewhere real. (Vitest runs from apps/web.)
 */
const CONTENT = join(process.cwd(), 'src/help/content');
const PUBLIC = join(process.cwd(), 'public');

/** Pages an article may link to or send people to ("go to this page"). Add a page here when an article needs it. */
const APP_ROUTES = new Set([
  '/',
  '/help',
  '/farms',
  '/farms/register',
  '/farms/sign-in',
  '/farms/verify-email',
  '/farms/forgot-password',
  '/farms/reset-password',
  '/farms/new',
  '/farms/seller',
  '/farms/owner-request',
  '/farms/profile',
  '/farms/settings',
  '/admin/account/security',
  '/market',
  '/shop',
]);

function load(locale: 'th' | 'en'): Article[] {
  return readdirSync(join(CONTENT, locale))
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const a = parseArticle(
        readFileSync(join(CONTENT, locale, f), 'utf8'),
        locale,
        `${locale}/${f}`,
      );
      expect(a.slug, `${locale}/${f}: slug must match the file name`).toBe(f.replace(/\.md$/, ''));
      return a;
    });
}

const th = load('th');
const en = load('en');
const slugs = new Set(th.map((a) => a.slug));

describe('help content', () => {
  it('every article exists in Thai and English, with the same steps, pictures and settings', () => {
    expect([...slugs].sort()).toEqual(en.map((a) => a.slug).sort());
    for (const a of th) {
      const b = en.find((x) => x.slug === a.slug)!;
      expect(
        imagesOf(b).map((i) => i.id),
        a.slug,
      ).toEqual(imagesOf(a).map((i) => i.id));
      for (const key of ['audience', 'category', 'order', 'goTo', 'availability'] as const)
        expect(b[key], `${a.slug}.${key}`).toEqual(a[key]);
      expect(b.relatedRoutes, `${a.slug}.relatedRoutes`).toEqual(a.relatedRoutes);
      expect(a.keywords.length, `${a.slug}: Thai keywords`).toBeGreaterThan(0);
      expect(b.keywords.length, `${a.slug}: English keywords`).toBeGreaterThan(0);
    }
  });

  it('has the getting-started set', () => {
    for (const slug of [
      'account-overview',
      'register-email',
      'register-phone',
      'register-google',
      'sign-in',
      'forgot-password',
      'request-farm-owner',
    ])
      expect(slugs.has(slug), slug).toBe(true);
  });

  it('every link and "go to this page" leads to a real page or article', () => {
    for (const a of [...th, ...en]) {
      if (a.goTo) expect(APP_ROUTES.has(a.goTo), `${a.locale}/${a.slug} goTo ${a.goTo}`).toBe(true);
      for (const l of linksOf(a)) {
        if (l.kind === 'help')
          expect(slugs.has(l.slug), `${a.locale}/${a.slug} → help:${l.slug}`).toBe(true);
        if (l.kind === 'link')
          expect(APP_ROUTES.has(l.to), `${a.locale}/${a.slug} → ${l.to}`).toBe(true);
      }
    }
  });

  it('every picture exists for both languages and both widths, with a description', () => {
    const missing: string[] = [];
    for (const a of [...th, ...en])
      for (const img of imagesOf(a)) {
        expect(img.alt.trim().length, `${a.locale}/${a.slug} img:${img.id} alt`).toBeGreaterThan(3);
        for (const w of IMAGE_WIDTHS) {
          const file = join(PUBLIC, imagePath(a.slug, img.id, a.locale, w));
          if (!existsSync(file)) missing.push(file.slice(PUBLIC.length));
        }
      }
    expect(missing, 'run `pnpm help:screenshots`').toEqual([]);
  });

  it('the parser refuses what the content may not contain', () => {
    const fm =
      '---\nslug: x\ntitle: t\nsummary: s\naudience: guest\ncategory: account\norder: 1\nupdatedAt: 2026-11-24\n---\n';
    for (const body of [
      'See [this](https://example.com)', // external links
      '### Small heading',
      ':::trouble Open\nnever closed',
      '![a picture](img:1)', // a picture outside a step
    ])
      expect(() => parseArticle(fm + body, 'th', 'test.md'), body).toThrow(HelpContentError);
    expect(() =>
      parseArticle(fm.replace('audience: guest', 'audience: everyone'), 'th', 't.md'),
    ).toThrow(/unknown audience/);
  });
});
