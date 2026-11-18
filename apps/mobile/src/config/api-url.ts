export const DEFAULT_API_PORT = 4000;
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/i;

export interface ApiUrlInput {
  /** EXPO_PUBLIC_API_BASE_URL (may be empty). */
  configured: string | undefined;
  platform: 'ios' | 'android' | 'web' | string;
  /** Metro's host (e.g. "192.168.1.20:8081") — in dev this is the dev machine as seen from the device. */
  hostUri: string | undefined;
  isDev: boolean;
}

export type ApiUrlResult = { ok: true; url: string } | { ok: false; reason: string };

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Decide the API origin for this device.
 *  - An explicit EXPO_PUBLIC_API_BASE_URL always wins. On the Android emulator `localhost` is the emulator
 *    itself, so loopback hosts are rewritten to 10.0.2.2 (the host machine).
 *  - In development without a value, use the machine that serves the JS bundle (works on real phones too).
 *  - In production the URL is required and must be https (no cleartext traffic, no silent fallback to localhost).
 */
export function resolveApiBaseUrl({
  configured,
  platform,
  hostUri,
  isDev,
}: ApiUrlInput): ApiUrlResult {
  const value = configured?.trim().replace(/\/+$/, '');

  if (value) {
    const host = hostOf(value);
    if (!host)
      return { ok: false, reason: `EXPO_PUBLIC_API_BASE_URL is not a valid URL: "${value}"` };
    if (!isDev && !value.startsWith('https://')) {
      return { ok: false, reason: 'Production builds require an https:// API URL.' };
    }
    if (platform === 'android' && LOOPBACK.test(host)) {
      return { ok: true, url: value.replace(host, '10.0.2.2') };
    }
    return { ok: true, url: value };
  }

  if (!isDev)
    return { ok: false, reason: 'EXPO_PUBLIC_API_BASE_URL is not set for this production build.' };

  const metroHost = hostUri?.split(':')[0];
  if (metroHost && !LOOPBACK.test(metroHost))
    return { ok: true, url: `http://${metroHost}:${DEFAULT_API_PORT}` };
  return {
    ok: true,
    url: `http://${platform === 'android' ? '10.0.2.2' : 'localhost'}:${DEFAULT_API_PORT}`,
  };
}
