import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { palette } from '../src/theme/palette';
import { theme } from '../src/theme/theme';

function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
const c = theme.colors;

describe('white + red theme', () => {
  it('main background is white and the brand is red', () => {
    expect(c.background).toBe('#FFFFFF');
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.primary.slice(i, i + 2), 16)) as [
      number,
      number,
      number,
    ];
    expect(r).toBeGreaterThan(150);
    expect(g).toBeLessThan(80);
    expect(b).toBeLessThan(80);
  });

  it('secondary surfaces are neutral grays (no hue)', () => {
    for (const hex of [c.surface, c.surfaceAlt, c.border, c.borderStrong, c.textMuted]) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
        number,
        number,
        number,
      ];
      expect(Math.max(r, g, b) - Math.min(r, g, b), hex).toBeLessThanOrEqual(12);
    }
  });

  const TEXT: [string, string, string][] = [
    ['text', c.text, c.background],
    ['text on surface', c.text, c.surface],
    ['muted', c.textMuted, c.background],
    ['muted on surface', c.textMuted, c.surface],
    ['on primary', c.textOnPrimary, c.primary],
    ['on primary pressed', c.textOnPrimary, c.primaryPressed],
    ['primary text', c.primary, c.background],
    ['primary text on soft', c.primary, c.primarySoft],
    ['tab active', c.tabActive, c.background],
    ['tab inactive', c.tabInactive, c.background],
    ['success', c.success.fg, c.success.bg],
    ['warning', c.warning.fg, c.warning.bg],
    ['error', c.error.fg, c.error.bg],
    ['error on white', c.error.fg, c.background],
    ['success on white', c.success.fg, c.background],
  ];
  it.each(TEXT)('%s meets WCAG AA text contrast (4.5:1)', (_n, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('control outlines meet 3:1 against the surfaces they sit on', () => {
    expect(ratio(c.borderStrong, c.background)).toBeGreaterThanOrEqual(3);
    expect(ratio(c.borderStrong, c.surface)).toBeGreaterThanOrEqual(3);
  });

  it('error is distinguishable from the brand red by more than hue (own role, own background)', () => {
    expect(c.error.fg).not.toBe(c.primary);
    expect(c.error.bg).not.toBe(c.primarySoft);
  });

  it('touch targets meet the minimum', () => {
    expect(theme.minTouch).toBeGreaterThanOrEqual(44);
  });
});

describe('colours are centralized', () => {
  const root = resolve(__dirname, '..');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
    });

  it('hex colours appear only in theme/palette.ts', () => {
    const offenders = [...walk(join(root, 'src')), ...walk(join(root, 'app'))]
      .filter((f) => !f.endsWith(join('theme', 'palette.ts')))
      .filter((f) =>
        /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/.test(
          readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''),
        ),
      );
    expect(offenders.map((f) => f.replace(root, ''))).toEqual([]);
  });

  it('every theme colour comes from the palette', () => {
    const known = new Set(Object.values(palette));
    const flat = [
      c.background,
      c.surface,
      c.surfaceAlt,
      c.border,
      c.borderStrong,
      c.text,
      c.textMuted,
      c.textOnPrimary,
      c.primary,
      c.primaryPressed,
      c.primarySoft,
      c.tabActive,
      c.tabInactive,
      c.success.fg,
      c.success.bg,
      c.warning.fg,
      c.warning.bg,
      c.error.fg,
      c.error.bg,
    ];
    for (const hex of flat) expect(known.has(hex as never), hex).toBe(true);
  });
});
