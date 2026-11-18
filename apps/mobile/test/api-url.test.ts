import { describe, expect, it } from 'vitest';
import { resolveApiBaseUrl } from '../src/config/api-url';

const base = { configured: undefined, platform: 'ios', hostUri: undefined, isDev: true } as const;
const url = (over: Partial<Parameters<typeof resolveApiBaseUrl>[0]>) =>
  resolveApiBaseUrl({ ...base, ...over });

describe('API base URL resolution', () => {
  it('uses the machine serving the bundle in dev (real phones work with no setup)', () => {
    expect(url({ hostUri: '192.168.1.20:8081' })).toEqual({
      ok: true,
      url: 'http://192.168.1.20:4000',
    });
  });

  it('falls back to localhost on iOS and 10.0.2.2 on the Android emulator', () => {
    expect(url({})).toEqual({ ok: true, url: 'http://localhost:4000' });
    expect(url({ platform: 'android' })).toEqual({ ok: true, url: 'http://10.0.2.2:4000' });
  });

  it('ignores a loopback Metro host (it would point at the phone itself)', () => {
    expect(url({ hostUri: 'localhost:8081', platform: 'android' })).toEqual({
      ok: true,
      url: 'http://10.0.2.2:4000',
    });
  });

  it('an explicit URL wins, trailing slashes removed', () => {
    expect(
      url({ configured: 'https://api.farmplus.example///', hostUri: '192.168.1.20:8081' }),
    ).toEqual({ ok: true, url: 'https://api.farmplus.example' });
  });

  it('rewrites loopback to 10.0.2.2 on Android only', () => {
    expect(url({ configured: 'http://localhost:4000', platform: 'android' })).toEqual({
      ok: true,
      url: 'http://10.0.2.2:4000',
    });
    expect(url({ configured: 'http://127.0.0.1:4000', platform: 'android' })).toEqual({
      ok: true,
      url: 'http://10.0.2.2:4000',
    });
    expect(url({ configured: 'http://localhost:4000', platform: 'ios' })).toEqual({
      ok: true,
      url: 'http://localhost:4000',
    });
  });

  it('production requires an https URL and never falls back to localhost', () => {
    const prod = { isDev: false } as const;
    expect(url({ ...prod })).toMatchObject({ ok: false });
    expect(url({ ...prod, hostUri: '192.168.1.20:8081' })).toMatchObject({ ok: false });
    expect(url({ ...prod, configured: 'http://api.example.com' })).toMatchObject({
      ok: false,
      reason: expect.stringContaining('https'),
    });
    expect(url({ ...prod, configured: 'https://api.example.com' })).toEqual({
      ok: true,
      url: 'https://api.example.com',
    });
  });

  it('rejects a malformed URL instead of crashing later', () => {
    expect(url({ configured: 'not a url' })).toMatchObject({ ok: false });
  });
});
