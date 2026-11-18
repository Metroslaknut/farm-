import { describe, expect, it } from 'vitest';
import {
  WatchClock,
  isExpiringSoon,
  resolveUploadUrl,
  shouldLoadMore,
  slideWindow,
  validateVideoFile,
} from '@farmplus/shared-utils';
import { toPickedVideo } from '../src/lib/pickedVideo';

describe('vertical feed windowing', () => {
  it('mounts active ± 1 and prefetches the neighbours', () => {
    expect(slideWindow(3, 10)).toEqual({ mount: [2, 3, 4], prefetch: [4, 2] });
    expect(slideWindow(0, 1)).toEqual({ mount: [0], prefetch: [] });
  });
  it('loads more near the end only', () => {
    expect(shouldLoadMore(8, 10, true)).toBe(true);
    expect(shouldLoadMore(8, 10, false)).toBe(false);
    expect(shouldLoadMore(1, 10, true)).toBe(false);
  });
});

describe('playback tokens and watch time', () => {
  it('refreshes tokens before they expire', () => {
    expect(isExpiringSoon(new Date(Date.now() + 5_000).toISOString())).toBe(true);
    expect(isExpiringSoon(new Date(Date.now() + 600_000).toISOString())).toBe(false);
  });
  it('counts real playback only', () => {
    const c = new WatchClock();
    [0, 0.5, 1, 1.5, 2].forEach((t) => c.tick(t, true));
    expect(c.seconds).toBeCloseTo(2);
    c.tick(40, true); // seek
    c.tick(0, true); // loop
    c.tick(0.5, false); // paused
    expect(c.seconds).toBeCloseTo(2);
  });
});

describe('upload preparation', () => {
  it('guesses missing file info from the picker', () => {
    expect(toPickedVideo({ uri: 'file:///tmp/clip.mov' })).toEqual({
      uri: 'file:///tmp/clip.mov',
      name: 'clip.mov',
      mimeType: 'video/quicktime',
      size: 0,
    });
    expect(
      toPickedVideo({
        uri: 'file:///a/b.mp4',
        fileName: 'My Clip.mp4',
        mimeType: 'video/mp4',
        fileSize: 1234,
      }),
    ).toMatchObject({ name: 'My Clip.mp4', size: 1234 });
    expect(toPickedVideo({ uri: 'file:///x/y.webm' }).mimeType).toBe('video/webm');
  });
  it('checks type and size like the API does', () => {
    const rules = { maxUploadBytes: 1000, mimeTypes: ['video/mp4'] };
    expect(
      validateVideoFile({ name: 'a.mp4', type: 'video/mp4', size: 10 }, rules),
    ).toBeUndefined();
    expect(validateVideoFile({ name: 'a.gif', type: 'image/gif', size: 10 }, rules)).toBeTruthy();
    expect(validateVideoFile({ name: 'a.mp4', type: 'video/mp4', size: 99999 }, rules)).toMatch(
      /too large/,
    );
  });
  it('resolves provider and dev upload URLs', () => {
    expect(
      resolveUploadUrl('https://up.example.test/x', 'http://192.168.1.2:4000', 'http://localhost'),
    ).toBe('https://up.example.test/x');
    expect(
      resolveUploadUrl(
        '/api/v1/media/dev/uploads/a',
        'http://192.168.1.2:4000',
        'http://localhost',
      ),
    ).toBe('http://192.168.1.2:4000/api/v1/media/dev/uploads/a');
  });
});
