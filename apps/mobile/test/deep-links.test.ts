import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEEP_LINK_PATTERNS, pathFromUrl, safeRedirect, toRoute } from '../src/lib/deep-links';

describe('deep links → routes', () => {
  it.each([
    ['farmplus://farm/42', '/farm/42'],
    ['farmplus://animal/a_1-b', '/animal/a_1-b'],
    ['farmplus://videos/9', '/videos/9'],
    ['farmplus://live/abc', '/live/abc'],
    ['farmplus://marketplace/77', '/marketplace/77'],
    ['farmplus://product/p1', '/product/p1'],
    ['farmplus://farm/42/animals', '/farm/42/animals'],
    ['farmplus://farm/new', '/farm/new'],
    ['farmplus://wallet', '/wallet'],
    ['farmplus://chat', '/chat'],
    ['farmplus://chat/c9', '/chat/c9'],
    ['farmplus://notifications', '/notifications'],
    ['farmplus://market', '/market'],
    ['farmplus://my-farm', '/my-farm'],
    ['https://app.example.com/farm/42', '/farm/42'],
    ['https://app.example.com/farm/42?utm=x#frag', '/farm/42'],
    ['exp://192.168.1.172:8081/--/farm/42', '/farm/42'],
    ['exp://192.168.1.172:8081/--/videos/9?x=1', '/videos/9'],
    ['exp+farmplus://192.168.1.172:8081/--/wallet', '/wallet'],
    ['/product/p1', '/product/p1'],
    ['farmplus://', '/'],
  ])('%s → %s', (input, expected) => {
    expect(toRoute(input)).toBe(expected);
  });

  it.each([
    'farmplus://admin/users',
    'farmplus://sign-in',
    'farmplus://farm/../../etc/passwd',
    'farmplus://farm/%2e%2e',
    'farmplus://farm/' + 'a'.repeat(65),
    'farmplus://farm/1/extra',
    'farmplus://farm/1/animals/new',
    'farmplus://farm/1/animals/../../x',
    'javascript:alert(1)',
    'exp://192.168.1.172:8081/--/admin/users',
    'exp://192.168.1.172:8081/farm/42',
    'http://evil.example/farm/1',
    'intent://x#Intent;end',
    '',
  ])('refuses %j (falls back to Home)', (input) => {
    expect(toRoute(input)).toBe('/');
  });

  it('pathFromUrl returns null for non-links', () => {
    expect(pathFromUrl('javascript:alert(1)')).toBeNull();
    expect(pathFromUrl('ftp://x/y')).toBeNull();
  });
});

describe('OAuth callback deep link (only route whose query survives)', () => {
  const ticket = 'T'.repeat(43);
  it.each([
    [`farmplus://oauth-callback?ticket=${ticket}`, `/oauth-callback?ticket=${ticket}`],
    [`farmplus://oauth-callback/?ticket=${ticket}#_=_`, `/oauth-callback?ticket=${ticket}`],
    [`/oauth-callback?ticket=${ticket}`, `/oauth-callback?ticket=${ticket}`],
    [
      `exp://192.168.1.2:8081/--/oauth-callback?ticket=${ticket}`,
      `/oauth-callback?ticket=${ticket}`,
    ],
    ['farmplus://oauth-callback?error=account_exists', '/oauth-callback?error=account_exists'],
    // only ticket/error pass, and only well-formed values
    [
      `farmplus://oauth-callback?ticket=${ticket}&redirect=https://evil.example`,
      `/oauth-callback?ticket=${ticket}`,
    ],
    ['farmplus://oauth-callback?error=%3Cscript%3E', '/oauth-callback?error=provider_error'],
    ['farmplus://oauth-callback?ticket=../../x', '/oauth-callback?error=provider_error'],
    ['farmplus://oauth-callback', '/oauth-callback?error=provider_error'],
  ])('%s → %s', (input, expected) => {
    expect(toRoute(input)).toBe(expected);
  });

  it.each([
    `farmplus://oauth-callback/extra?ticket=${ticket}`,
    `farmplus://oauth-callbacks?ticket=${ticket}`,
    `farmplus://admin?ticket=${ticket}`,
    `farmplus://sign-in?redirect=/wallet`,
    `http://evil.example/oauth-callback?ticket=${ticket}`,
  ])('still refuses %j', (input) => {
    expect(toRoute(input)).toBe('/');
  });

  it('other allowed routes still drop their query', () => {
    expect(toRoute(`farmplus://farm/42?ticket=${ticket}`)).toBe('/farm/42');
  });
});

describe('safeRedirect (post-login return target)', () => {
  it('allows internal paths', () => {
    expect(safeRedirect('/farm/42')).toBe('/farm/42');
    expect(safeRedirect(['/wallet', '/x'])).toBe('/wallet');
  });
  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    'farm/42',
    '',
    undefined,
  ])('blocks open-redirect attempt %j', (value) => {
    expect(safeRedirect(value as string | undefined)).toBe('/');
  });
  it('rejects absurdly long targets', () => {
    expect(safeRedirect('/' + 'a'.repeat(500))).toBe('/');
  });
});

describe('app.config.ts stays in sync with the whitelist', () => {
  it('every https link prefix is an allowed route, and every detail route has a prefix', () => {
    const src = readFileSync(resolve(__dirname, '../app.config.ts'), 'utf8');
    const prefixes = [
      ...(/LINK_PREFIXES = \[([^\]]+)\]/.exec(src)?.[1] ?? '').matchAll(/'(\/[\w-]+)'/g),
    ].map((m) => m[1]!);
    expect(prefixes.length).toBeGreaterThan(5);
    for (const prefix of prefixes) {
      const sample = [prefix, `${prefix}/abc1`];
      expect(
        sample.some((p) => DEEP_LINK_PATTERNS.some((re) => re.test(p))),
        prefix,
      ).toBe(true);
    }
    for (const root of ['farm', 'animal', 'videos', 'live', 'marketplace', 'product'])
      expect(prefixes).toContain(`/${root}`);
  });
});
