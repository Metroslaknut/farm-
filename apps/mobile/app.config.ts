import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic layer over app.json. Custom-scheme links (farmplus://…) work out of the box. HTTPS universal/app links
 * additionally need your domain: set FARMPLUS_LINK_HOST (e.g. app.farmplus.co.th) at build time AND host
 * /.well-known/apple-app-site-association (iOS) and /.well-known/assetlinks.json (Android) on that domain.
 * This value is public by nature (it is in the app manifest); never put secrets here.
 */
const HOST = process.env.FARMPLUS_LINK_HOST?.trim();

/**
 * Release builds (EAS profile `production`, or FARMPLUS_RELEASE=true) must know where the API is and must reach it over
 * https. Failing here, at build time, is far cheaper than shipping a store build that cannot log in. Everything read
 * here is public by nature: it is compiled into the app. Store/signing credentials are never in this repository; they
 * live in EAS (see docs/ops/release-mobile.md).
 */
export function releaseConfigProblems(env: Record<string, string | undefined>): string[] {
  const release = env['EAS_BUILD_PROFILE'] === 'production' || env['FARMPLUS_RELEASE'] === 'true';
  if (!release) return [];
  const problems: string[] = [];
  const api = env['EXPO_PUBLIC_API_BASE_URL']?.trim();
  if (!api) problems.push('EXPO_PUBLIC_API_BASE_URL is required for a release build');
  else if (!/^https:\/\/[^/\s]+/.test(api))
    problems.push('EXPO_PUBLIC_API_BASE_URL must be an https:// URL in a release build');
  else if (/\/\/(localhost|127\.|10\.0\.2\.2|192\.168\.)/.test(api))
    problems.push('EXPO_PUBLIC_API_BASE_URL must not point at a local address in a release build');
  if (!env['EAS_PROJECT_ID']?.trim())
    problems.push('EAS_PROJECT_ID is required for a release build (run `eas init`)');
  return problems;
}

// Keep in sync with DEEP_LINK_PATTERNS in src/lib/deep-links.ts (a test enforces it).
const LINK_PREFIXES = [
  '/farm',
  '/animal',
  '/videos',
  '/live',
  '/marketplace',
  '/product',
  '/wallet',
  '/chat',
  '/notifications',
];

export default ({ config }: ConfigContext): ExpoConfig => {
  const problems = releaseConfigProblems(process.env);
  if (problems.length > 0)
    throw new Error(
      `Invalid release configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
  return buildConfig(config);
};

const buildConfig = (config: ConfigContext['config']): ExpoConfig => ({
  ...(config as ExpoConfig),
  // Identifier of the EAS project (not a credential). Absent in local development.
  ...(process.env['EAS_PROJECT_ID']
    ? { extra: { ...config.extra, eas: { projectId: process.env['EAS_PROJECT_ID'] } } }
    : {}),
  // One runtime per app version: a binary only ever talks to a JS bundle built for it (no OTA updates are configured).
  runtimeVersion: { policy: 'appVersion' },
  name: config.name ?? 'FARM+',
  slug: config.slug ?? 'farm-plus',
  ios: {
    ...config.ios,
    ...(HOST ? { associatedDomains: [`applinks:${HOST}`] } : {}),
  },
  android: {
    ...config.android,
    ...(HOST
      ? {
          intentFilters: [
            {
              action: 'VIEW',
              autoVerify: true,
              data: LINK_PREFIXES.map((pathPrefix) => ({
                scheme: 'https',
                host: HOST,
                pathPrefix,
              })),
              category: ['BROWSABLE', 'DEFAULT'],
            },
          ],
        }
      : {}),
  },
});
