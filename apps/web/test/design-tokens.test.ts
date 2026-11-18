import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BREAKPOINTS } from '../src/themes/breakpoints';

const css = (name: string) => readFileSync(resolve(__dirname, '../src/styles', name), 'utf8');
const tokensCss = css('tokens.css');
const componentCss = ['base.css', 'ui.css', 'layout.css'].map((f) => [f, css(f)] as const);

/** token name -> [light, dark] for every `light-dark(#hex, #hex)` token. */
const colours = new Map<string, [string, string]>();
for (const m of tokensCss.matchAll(
  /--ds-([\w-]+):\s*light-dark\(\s*(#[0-9a-fA-F]{6})\s*,\s*(#[0-9a-fA-F]{6})\s*\)/g,
)) {
  colours.set(m[1]!, [m[2]!, m[3]!]);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
const pick = (name: string, mode: 0 | 1): string => {
  const v = colours.get(name);
  if (!v) throw new Error(`token --ds-${name} missing`);
  return v[mode];
};

/** [foreground, background, minimum ratio] — WCAG 2.1 AA: 4.5 text, 3 for UI components / focus. */
const PAIRS: [string, string, number][] = [
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['text', 'surface-2', 4.5],
  ['text-muted', 'bg', 4.5],
  ['text-muted', 'surface', 4.5],
  ['text-muted', 'surface-2', 4.5],
  ['link', 'bg', 4.5],
  ['link', 'surface', 4.5],
  ['on-primary', 'primary', 4.5],
  ['on-danger', 'danger', 4.5],
  ['success-fg', 'success-bg', 4.5],
  ['warning-fg', 'warning-bg', 4.5],
  ['danger-fg', 'danger-bg', 4.5],
  ['info-fg', 'info-bg', 4.5],
  ['danger-fg', 'surface', 4.5], // field error text on cards
  ['focus', 'bg', 3],
  ['focus', 'surface', 3],
  ['focus', 'surface-2', 3],
  ['border-strong', 'bg', 3],
  ['border-strong', 'surface', 3],
  ['primary', 'surface', 3],
  ['danger', 'surface', 3], // solid controls against their surroundings
];

describe('accessible colour contrast (both themes)', () => {
  it('defines a light and dark value for every colour token', () => {
    expect(colours.size).toBeGreaterThan(20);
    for (const [, [light, dark]] of colours) {
      expect(light).toMatch(/^#[0-9a-f]{6}$/i);
      expect(dark).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  const CASES: [fg: string, bg: string, min: number, theme: 'light' | 'dark', mode: 0 | 1][] =
    PAIRS.flatMap(([fg, bg, min]) => [
      [fg, bg, min, 'light', 0],
      [fg, bg, min, 'dark', 1],
    ]);
  it.each(CASES)('%s on %s ≥ %s:1 (%s)', (fg, bg, min, theme, mode) => {
    const ratio = contrast(pick(fg, mode), pick(bg, mode));
    expect(ratio, `${fg} on ${bg} (${theme}) = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min);
  });

  it('light and dark actually differ (dark mode is real)', () => {
    for (const name of ['bg', 'surface', 'text', 'primary'])
      expect(pick(name, 0)).not.toBe(pick(name, 1));
    expect(luminance(pick('bg', 0))).toBeGreaterThan(0.5);
    expect(luminance(pick('bg', 1))).toBeLessThan(0.1);
  });
});

describe('stylesheets only use shared tokens', () => {
  it('every var(--ds-*) used by components is defined in tokens.css', () => {
    const defined = new Set([...tokensCss.matchAll(/(--ds-[\w-]+):/g)].map((m) => m[1]));
    for (const [file, content] of componentCss) {
      for (const m of content.matchAll(/var\((--ds-[\w-]+)/g)) {
        expect(defined.has(m[1]!), `${file} uses undefined ${m[1]}`).toBe(true);
      }
    }
  });

  it('component CSS has no hard-coded colours', () => {
    for (const [file, content] of componentCss) {
      const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(stripped, `${file} contains a hex colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(stripped, `${file} contains rgb()/hsl()`).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
    }
  });

  it('tokens are scoped to .ds-root, never :root/body (existing pages stay untouched)', () => {
    const selectors = [...tokensCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)].map(
      (m) => m[1]!.trim(),
    );
    for (const s of selectors) {
      if (s.startsWith('@')) continue;
      expect(s, `unscoped selector "${s}"`).toMatch(/\.ds-root/);
    }
    for (const [file, content] of componentCss) {
      const sels = [...content.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}@]+)\{/g)].map((m) =>
        m[1]!.trim(),
      );
      for (const s of sels.filter((x) => /^(html|body|:root|\*)\b/.test(x)))
        expect.fail(`${file}: global selector "${s}"`);
    }
  });
});

describe('breakpoints', () => {
  it('stylesheets only use the declared breakpoint widths', () => {
    const allowed = new Set(Object.values(BREAKPOINTS));
    for (const [file, content] of componentCss) {
      for (const m of content.matchAll(/@media\s*\(min-width:\s*(\d+)px\)/g)) {
        expect(allowed.has(Number(m[1]) as never), `${file}: unknown breakpoint ${m[1]}px`).toBe(
          true,
        );
      }
    }
  });

  it('are ordered mobile → desktop', () => {
    const values = Object.values(BREAKPOINTS);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });
});

describe('regression: component colours are never overridden by base link styles', () => {
  it('base.css styles only unclassed links, through a zero-specificity :where()', () => {
    const base = css('base.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(base).not.toMatch(/\.ds-root\s+a\s*[{,:]/); // a bare `.ds-root a` would beat .ds-btn--primary
    expect(base).toMatch(/\.ds-root\s+:where\(a:not\(\[class\]\)\)/);
  });
  it('no !important in component stylesheets (specificity is solved structurally; reduced-motion in base.css is the one conventional exception)', () => {
    for (const [file, content] of componentCss.filter(([f]) => f !== 'base.css')) {
      expect(content.replace(/\/\*[\s\S]*?\*\//g, ''), file).not.toMatch(/!important/);
    }
  });
});

describe('public and admin layouts stay separate', () => {
  const imports = (p: string): string[] =>
    [...readFileSync(resolve(__dirname, '../src', p), 'utf8').matchAll(/from\s+'([^']+)'/g)].map(
      (m) => m[1]!,
    );

  it('the public side never imports admin code', () => {
    for (const f of [
      'app/layouts/PublicLayout.tsx',
      'pages/design-system/index.tsx',
      'pages/design-system/DesignSystemPreview.tsx',
    ]) {
      expect(
        imports(f).filter((i) => /admin/i.test(i)),
        f,
      ).toEqual([]);
    }
  });

  it('the admin layout never imports the design-system layout, components or styles', () => {
    for (const f of [
      'components/admin/AdminLayout.tsx',
      'components/admin/AdminHeader.tsx',
      'components/admin/AdminSidebar.tsx',
    ]) {
      expect(
        imports(f).filter((i) =>
          /PublicLayout|components\/layout|components\/ui|styles\/index/.test(i),
        ),
        f,
      ).toEqual([]);
    }
  });
});
