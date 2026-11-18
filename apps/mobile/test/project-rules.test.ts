import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
const sources = [...walk(join(root, 'src')), ...walk(join(root, 'app'))];
const read = (f: string) => readFileSync(f, 'utf8');
/** Source without comments, so prose like "never use AsyncStorage" is not mistaken for usage. */
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
const rel = (fs: string[]) => fs.map((f) => f.replace(root, ''));

describe('required navigation structure', () => {
  it.each([
    'app/_layout.tsx',
    'app/(auth)/_layout.tsx',
    'app/(auth)/sign-in.tsx',
    'app/(tabs)/_layout.tsx',
    'app/(tabs)/index.tsx',
    'app/(tabs)/videos.tsx',
    'app/(tabs)/market.tsx',
    'app/(tabs)/my-farm.tsx',
    'app/(tabs)/profile.tsx',
    'app/farm/new.tsx',
    'app/farm/[id]/index.tsx',
    'app/farm/[id]/animals/index.tsx',
    'app/farm/[id]/animals/new.tsx',
    'app/animal/[id].tsx',
    'app/animal/edit/[id].tsx',
    'app/animal/growth/[id].tsx',
    'app/videos/[id].tsx',
    'app/live/[id].tsx',
    'app/marketplace/[id].tsx',
    'app/product/[id].tsx',
    'app/wallet/index.tsx',
    'app/chat/index.tsx',
    'app/chat/[id].tsx',
    'app/notifications/index.tsx',
  ])('%s exists', (file) => {
    expect(existsSync(join(root, file)), file).toBe(true);
  });

  it('has exactly the five main tabs, in order', () => {
    const layout = read(join(root, 'app/(tabs)/_layout.tsx'));
    const titles = [...layout.matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
    expect(titles).toEqual(['Home', 'Videos', 'Market', 'My Farm', 'Profile']);
    const names = [...layout.matchAll(/name: '([^']+)'/g)].map((m) => m[1]);
    expect(names).toEqual(['index', 'videos', 'market', 'my-farm', 'profile']);
    for (const n of names) expect(existsSync(join(root, `app/(tabs)/${n}.tsx`)), n).toBe(true);
  });

  it('screens needing an account are wrapped in RequireAuth; public ones are not', () => {
    const needsAuth = [
      'app/(tabs)/my-farm.tsx',
      'app/farm/new.tsx',
      'app/farm/[id]/index.tsx',
      'app/farm/[id]/animals/index.tsx',
      'app/farm/[id]/animals/new.tsx',
      'app/animal/[id].tsx',
      'app/animal/edit/[id].tsx',
      'app/animal/growth/[id].tsx',
      'app/wallet/index.tsx',
      'app/chat/index.tsx',
      'app/chat/[id].tsx',
      'app/notifications/index.tsx',
      // Part 10: every video/live endpoint requires an account
      'app/(tabs)/videos.tsx',
      'app/videos/upload.tsx',
      'app/videos/mine.tsx',
      'app/videos/[id].tsx',
      'app/live/index.tsx',
      'app/live/[id].tsx',
      // Part 11: the marketplace needs an account (offers, favourites, seller identity)
      'app/(tabs)/market.tsx',
      'app/marketplace/[id].tsx',
      'app/marketplace/favorites.tsx',
      'app/marketplace/offers/index.tsx',
      'app/marketplace/offers/[id].tsx',
      // Part 12: orders contain personal data (delivery address) and money
      'app/orders/index.tsx',
      'app/orders/[id].tsx',
      'app/checkout/[negotiationId].tsx',
    ];
    for (const f of needsAuth) expect(read(join(root, f)), f).toContain('<RequireAuth>');
    for (const f of ['app/product/[id].tsx']) {
      expect(read(join(root, f)), f).not.toContain('RequireAuth');
    }
  });
});

describe('security & platform rules', () => {
  it('never references server secrets', () => {
    const offenders = sources.filter((f) =>
      /JWT_ACCESS_SECRET|MFA_ENCRYPTION_KEY|MONGODB_URI|BOOTSTRAP_ADMIN|STRIPE_SECRET|PRIVATE_KEY/i.test(
        read(f),
      ),
    );
    expect(rel(offenders)).toEqual([]);
  });

  it('only EXPO_PUBLIC_ variables are read from the environment', () => {
    for (const f of sources) {
      for (const m of read(f).matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        expect(m[1], `${f}: ${m[0]}`).toMatch(/^EXPO_PUBLIC_/);
      }
    }
  });

  it('tokens are never kept in AsyncStorage / localStorage / MMKV', () => {
    const offenders = sources.filter((f) =>
      /AsyncStorage|localStorage|sessionStorage|react-native-mmkv/.test(code(f)),
    );
    expect(rel(offenders)).toEqual([]);
  });

  it('no DOM / web-UI imports in the native app', () => {
    const offenders = sources.filter(
      (f) =>
        /from ['"](react-dom|react-router-dom|@farmplus\/web)/.test(read(f)) ||
        /<(div|span|button|input|a|p|ul|li|h[1-6])[\s>]/.test(read(f).replace(/`[^`]*`/g, '')),
    );
    expect(rel(offenders)).toEqual([]);
  });

  it('the app imports only shared business packages (types, validation, api-client, config, i18n) — not web code', () => {
    const imports = new Set(
      sources.flatMap((f) => [...read(f).matchAll(/from '(@farmplus\/[\w-]+)/g)].map((m) => m[1]!)),
    );
    for (const i of imports)
      expect([
        '@farmplus/api-client',
        '@farmplus/shared-types',
        '@farmplus/validation',
        '@farmplus/config',
        '@farmplus/shared-utils',
        '@farmplus/i18n',
      ]).toContain(i);
  });

  it('uses the single shared API client (no ad-hoc fetch / client creation in screens)', () => {
    const offenders = sources
      .filter((f) => !/src[\\/]api[\\/]/.test(f))
      .filter((f) => /\bfetch\(|createApiClient\(/.test(read(f)));
    expect(rel(offenders)).toEqual([]);
  });

  it('declares camera, microphone and photo permission strings (Thai + English) and uses only the system picker for media', () => {
    const cfg = JSON.parse(read(join(root, 'app.json'))).expo;
    const plugin = (name: string) =>
      (cfg.plugins as unknown[]).find((p) => Array.isArray(p) && p[0] === name) as [
        string,
        Record<string, unknown>,
      ];
    const camera = plugin('expo-camera')[1];
    expect(camera['cameraPermission']).toMatch(/กล้อง.*camera/s);
    expect(camera['microphonePermission']).toMatch(/ไมโครโฟน.*microphone/s);
    expect(camera['recordAudioAndroidPermission']).toBe(true);
    expect(String(plugin('expo-image-picker')[1]['photosPermission'])).toMatch(/รูปภาพ.*photos/s);
    expect(cfg.android.blockedPermissions).toEqual(
      expect.arrayContaining([
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
      ]),
    );
    expect(cfg.plugins).toContain('expo-secure-store');
  });

  it('supports iOS and Android with a custom scheme for deep links, light theme only', () => {
    const cfg = JSON.parse(read(join(root, 'app.json'))).expo;
    expect(cfg.scheme).toBe('farmplus');
    expect(cfg.ios.bundleIdentifier).toBeTruthy();
    expect(cfg.android.package).toBeTruthy();
    expect(cfg.userInterfaceStyle).toBe('light');
    expect(
      cfg.splash ??
        cfg.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-splash-screen')[1]
          .backgroundColor,
    ).toBeTruthy();
  });
});
