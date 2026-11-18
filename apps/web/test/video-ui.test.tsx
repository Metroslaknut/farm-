import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackInfo } from '@farmplus/shared-types';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));
vi.mock('../src/auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));

import { Player } from '../src/pages/videos/Player';
import UploadPage from '../src/pages/videos/UploadPage';
import VideoFeedPage from '../src/pages/videos/VideoFeedPage';
import LiveHostPage from '../src/pages/live/LiveHostPage';
import { setLocale } from '../src/i18n';
import { resolveUploadUrl, uploadToProvider } from '../src/pages/videos/uploadFile';
import {
  WatchClock,
  clampIndex,
  isExpiringSoon,
  shouldLoadMore,
  slideWindow,
  validateVideoFile,
} from '../src/pages/videos/videoFeed';

const ID = (n: number) => String(n).padStart(24, '0');
const playback = (url = 'https://cdn.example.test/v.mp4', ttl = 3_600_000): PlaybackInfo => ({
  url,
  expiresAt: new Date(Date.now() + ttl).toISOString(),
});
const video = (n: number) => ({
  id: ID(n),
  creator: { id: ID(99), displayName: 'Somchai' },
  title: `Video ${n}`,
  caption: null,
  visibility: 'public',
  status: 'published',
  processing: { state: 'ready' },
  viewCount: 0,
  reactionCount: 0,
  commentCount: 0,
  createdAt: '2026-03-01T00:00:00Z',
  viewer: { reacted: false, isCreator: false, followsCreator: false },
});

beforeEach(() => {
  request.mockReset();
  // jsdom does not implement media playback
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn(() => Promise.resolve()),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'load', { configurable: true, value: vi.fn() });
  class IO {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
});

describe('feed helpers', () => {
  it('mounts active ± 1 and prefetches the next/previous only', () => {
    expect(slideWindow(0, 10)).toEqual({ mount: [0, 1], prefetch: [1] });
    expect(slideWindow(5, 10)).toEqual({ mount: [4, 5, 6], prefetch: [6, 4] });
    expect(slideWindow(9, 10)).toEqual({ mount: [8, 9], prefetch: [8] });
    expect(slideWindow(0, 0)).toEqual({ mount: [], prefetch: [] });
  });
  it('loads more near the end only when there is more', () => {
    expect(shouldLoadMore(7, 10, true)).toBe(true);
    expect(shouldLoadMore(2, 10, true)).toBe(false);
    expect(shouldLoadMore(9, 10, false)).toBe(false);
  });
  it('clamps indexes and detects expiring tokens', () => {
    expect(clampIndex(-3, 5)).toBe(0);
    expect(clampIndex(99, 5)).toBe(4);
    expect(clampIndex(3, 0)).toBe(0);
    expect(isExpiringSoon(new Date(Date.now() + 10_000).toISOString())).toBe(true);
    expect(isExpiringSoon(new Date(Date.now() + 3_600_000).toISOString())).toBe(false);
  });
  it('the watch clock counts playback, not seeks or pauses', () => {
    const c = new WatchClock();
    c.tick(0, true);
    c.tick(1, true);
    c.tick(2, true);
    expect(c.seconds).toBe(2);
    c.tick(30, true); // seek forward
    c.tick(31, false); // paused
    c.tick(0, true); // loop restart
    expect(c.seconds).toBe(2);
    c.reset();
    expect(c.seconds).toBe(0);
  });
  it('validates files against the server limits', () => {
    const rules = { maxUploadBytes: 1000, mimeTypes: ['video/mp4'] };
    expect(
      validateVideoFile({ name: 'a.mp4', type: 'video/mp4', size: 10 }, rules),
    ).toBeUndefined();
    expect(validateVideoFile({ name: 'a.pdf', type: 'application/pdf', size: 10 }, rules)).toMatch(
      /Choose an MP4/,
    );
    expect(validateVideoFile({ name: 'a.mp4', type: 'video/mp4', size: 0 }, rules)).toMatch(
      /empty/,
    );
    expect(validateVideoFile({ name: 'a.mp4', type: 'video/mp4', size: 5000 }, rules)).toMatch(
      /too large/,
    );
  });
});

describe('Player', () => {
  const props = { muted: true, onToggleMute: vi.fn(), label: 'Calf' };

  it('does not ask for playback until the slide is active or being preloaded', async () => {
    const fetchPlayback = vi.fn().mockResolvedValue(playback());
    const { rerender } = render(<Player {...props} fetchPlayback={fetchPlayback} active={false} />);
    expect(fetchPlayback).not.toHaveBeenCalled();
    rerender(<Player {...props} fetchPlayback={fetchPlayback} active={false} preload />);
    await waitFor(() => expect(fetchPlayback).toHaveBeenCalledTimes(1));
    expect(HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>).not.toHaveBeenCalled(); // preloaded, not playing
    rerender(<Player {...props} fetchPlayback={fetchPlayback} active />);
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    expect(fetchPlayback).toHaveBeenCalledTimes(1); // still-valid URL is reused
  });

  it('sets the resolved URL on the video element', async () => {
    render(
      <Player
        {...props}
        fetchPlayback={() => Promise.resolve(playback('https://cdn.example.test/x.mp4'))}
        active
      />,
    );
    await waitFor(() =>
      expect(document.querySelector('video')?.getAttribute('src')).toBe(
        'https://cdn.example.test/x.mp4',
      ),
    );
  });

  it('retries silently once with a fresh URL on a playback error, then shows a Retry button that works', async () => {
    const fetchPlayback = vi.fn().mockResolvedValue(playback());
    const user = userEvent.setup();
    render(<Player {...props} fetchPlayback={fetchPlayback} active />);
    await waitFor(() => expect(fetchPlayback).toHaveBeenCalledTimes(1));
    const el = () => document.querySelector('video')!;
    await act(async () => fireEvent.error(el()));
    await waitFor(() => expect(fetchPlayback).toHaveBeenCalledTimes(2)); // automatic recovery
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => fireEvent.error(el()));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/could not be played/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(fetchPlayback).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('a failing playback request (e.g. 502) shows the error with Retry instead of crashing', async () => {
    const fetchPlayback = vi
      .fn()
      .mockRejectedValueOnce(new Error('Playback is unavailable, try again shortly'))
      .mockResolvedValue(playback());
    const user = userEvent.setup();
    render(<Player {...props} fetchPlayback={fetchPlayback} active />);
    expect(await screen.findByText('Playback is unavailable, try again shortly')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('play/pause and mute controls are labelled and work', async () => {
    const onToggleMute = vi.fn();
    const user = userEvent.setup();
    render(
      <Player
        {...props}
        onToggleMute={onToggleMute}
        fetchPlayback={() => Promise.resolve(playback())}
        active
      />,
    );
    const mute = screen.getByRole('button', { name: 'Unmute' });
    expect(mute.getAttribute('aria-pressed')).toBe('true');
    await user.click(mute);
    expect(onToggleMute).toHaveBeenCalled();
    const tap = await screen.findByRole('button', { name: /^(Play|Pause) Calf$/ });
    await user.click(tap);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('reports watch time once after the threshold, never while inactive', async () => {
    const onWatched = vi.fn();
    const { rerender } = render(
      <Player
        {...props}
        fetchPlayback={() => Promise.resolve(playback())}
        active={false}
        preload
        onWatched={onWatched}
        reportAfter={2}
      />,
    );
    const el = () => document.querySelector('video')!;
    const tick = (t: number) => {
      Object.defineProperty(el(), 'currentTime', { configurable: true, value: t });
      Object.defineProperty(el(), 'paused', { configurable: true, value: false });
      fireEvent.timeUpdate(el());
    };
    await waitFor(() => expect(el().getAttribute('src')).toBeTruthy());
    [0, 1, 2, 3].forEach(tick);
    expect(onWatched).not.toHaveBeenCalled();
    rerender(
      <Player
        {...props}
        fetchPlayback={() => Promise.resolve(playback())}
        active
        onWatched={onWatched}
        reportAfter={2}
      />,
    );
    [0, 1, 2, 2.9, 3.5].forEach(tick);
    expect(onWatched).toHaveBeenCalledTimes(1);
  });

  it('live mode shows connecting copy and never loops', async () => {
    render(<Player {...props} live fetchPlayback={() => new Promise(() => undefined)} active />);
    expect(await screen.findByText('Connecting…')).toBeTruthy();
    expect(document.querySelector('video')?.hasAttribute('loop')).toBe(false);
  });
});

describe('vertical feed', () => {
  it('mounts players only around the active slide and preloads the next one', async () => {
    request.mockImplementation(async (_m: string, path: string) => {
      if (path === '/videos')
        return { items: Array.from({ length: 6 }, (_, i) => video(i + 1)), nextCursor: 'c' };
      if (path.endsWith('/playback')) return playback();
      throw new Error(`unexpected ${path}`);
    });
    render(
      <MemoryRouter>
        <VideoFeedPage />
      </MemoryRouter>,
    );
    await screen.findByLabelText(/Video 1 by Somchai/);
    expect(document.querySelectorAll('video')).toHaveLength(2); // slide 0 and 1
    await waitFor(() => {
      const paths = request.mock.calls.map((c) => c[1] as string);
      expect(paths).toContain(`/videos/${ID(1)}/playback`);
      expect(paths).toContain(`/videos/${ID(2)}/playback`);
    });
    expect(request.mock.calls.map((c) => c[1])).not.toContain(`/videos/${ID(4)}/playback`);
  });

  it('keyboard navigation scrolls to the next slide', async () => {
    request.mockImplementation(async (_m: string, path: string) =>
      path === '/videos' ? { items: [video(1), video(2), video(3)] } : playback(),
    );
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <VideoFeedPage />
      </MemoryRouter>,
    );
    const feed = await screen.findByRole('region', { name: /Short video feed/ });
    feed.focus();
    await user.keyboard('{ArrowDown}');
    expect(scroll).toHaveBeenCalled();
    expect((scroll.mock.instances[0] as HTMLElement).dataset['index']).toBe('1');
  });

  it('shows an empty state and a retryable error', async () => {
    request.mockResolvedValueOnce({ items: [] });
    const { unmount } = render(
      <MemoryRouter>
        <VideoFeedPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/be the first to upload/)).toBeTruthy();
    unmount();
    request.mockRejectedValueOnce(new Error('boom'));
    render(
      <MemoryRouter>
        <VideoFeedPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/boom/)).toBeTruthy();
  });

  it('liking is optimistic and rolls back when the API refuses', async () => {
    request.mockImplementation(async (m: string, path: string) => {
      if (path === '/videos') return { items: [video(1)] };
      if (path.endsWith('/reactions')) throw new Error('nope');
      return playback();
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <VideoFeedPage />
      </MemoryRouter>,
    );
    const like = await screen.findByRole('button', { name: /Like, 0 likes/ });
    await user.click(like);
    await screen.findByText(/Could not update your like/);
    expect(screen.getByRole('button', { name: /Like, 0 likes/ })).toBeTruthy();
  });
});

describe('upload', () => {
  const limits = {
    maxUploadBytes: 1000,
    maxDurationSeconds: 60,
    mimeTypes: ['video/mp4'],
    provider: 'mock',
  };
  it('refuses a wrong type or oversized file before anything is requested', async () => {
    request.mockResolvedValue(limits);
    const user = userEvent.setup({ applyAccept: false });
    render(
      <MemoryRouter>
        <UploadPage />
      </MemoryRouter>,
    );
    await screen.findByText(/up to 60 seconds/);
    await user.upload(
      screen.getByLabelText('Video file'),
      new File(['x'], 'a.pdf', { type: 'application/pdf' }),
    );
    await user.type(screen.getByLabelText('Title'), 'My video');
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    expect(await screen.findByText(/Choose an MP4/)).toBeTruthy();
    await user.upload(
      screen.getByLabelText('Video file'),
      new File([new Uint8Array(5000)], 'a.mp4', { type: 'video/mp4' }),
    );
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    expect(await screen.findByText(/too large/)).toBeTruthy();
    expect(request.mock.calls.some((c) => c[0] === 'POST')).toBe(false);
  });

  it('resolves relative dev URLs against the API and keeps provider URLs absolute', () => {
    expect(resolveUploadUrl('https://upload.example.test/x', '', 'http://localhost:5173')).toBe(
      'https://upload.example.test/x',
    );
    expect(resolveUploadUrl('/api/v1/media/dev/uploads/a', '', 'http://localhost:5173')).toBe(
      'http://localhost:5173/api/v1/media/dev/uploads/a',
    );
    expect(resolveUploadUrl('/x', 'https://api.example.test', 'http://localhost:5173')).toBe(
      'https://api.example.test/x',
    );
  });

  it('uploads raw or multipart with progress, no credentials, and surfaces failures', async () => {
    const calls: {
      method?: string;
      url?: string;
      headers: Record<string, string>;
      body?: unknown;
      credentials?: boolean;
    }[] = [];
    class FakeXhr {
      status = 0;
      upload: {
        onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void;
      } = {};
      onload?: () => void;
      onerror?: () => void;
      onabort?: () => void;
      withCredentials = true;
      private rec: (typeof calls)[number] = { headers: {} };
      open(method: string, url: string) {
        this.rec.method = method;
        this.rec.url = url;
        calls.push(this.rec);
      }
      setRequestHeader(k: string, v: string) {
        this.rec.headers[k] = v;
      }
      send(body: unknown) {
        this.rec.body = body;
        this.rec.credentials = this.withCredentials;
        this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
        this.status = FakeXhr.nextStatus;
        this.onload?.();
      }
      abort() {
        this.onabort?.();
      }
      static nextStatus = 201;
    }
    const file = new File(['abc'], 'a.mp4', { type: 'video/mp4' });
    const progress = vi.fn();
    await uploadToProvider(
      file,
      { url: '', method: 'POST', encoding: 'raw', expiresAt: '', maxBytes: 10 },
      '/u',
      progress,
      FakeXhr as unknown as typeof XMLHttpRequest,
    ).promise;
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/u', credentials: false, body: file });
    expect(calls[0]!.headers['content-type']).toBe('video/mp4');
    expect(progress).toHaveBeenCalledWith(0.5);
    await uploadToProvider(
      file,
      { url: '', method: 'POST', encoding: 'multipart', expiresAt: '', maxBytes: 10 },
      '/u2',
      progress,
      FakeXhr as unknown as typeof XMLHttpRequest,
    ).promise;
    expect(calls[1]!.body).toBeInstanceOf(FormData);
    expect((calls[1]!.body as FormData).get('file')).toBeTruthy();
    FakeXhr.nextStatus = 413;
    await expect(
      uploadToProvider(
        file,
        { url: '', method: 'POST', encoding: 'raw', expiresAt: '', maxBytes: 10 },
        '/u',
        progress,
        FakeXhr as unknown as typeof XMLHttpRequest,
      ).promise,
    ).rejects.toThrow(/too large/);
    FakeXhr.nextStatus = 500;
    await expect(
      uploadToProvider(
        file,
        { url: '', method: 'POST', encoding: 'raw', expiresAt: '', maxBytes: 10 },
        '/u',
        progress,
        FakeXhr as unknown as typeof XMLHttpRequest,
      ).promise,
    ).rejects.toThrow(/failed \(500\)/);
  });
});

describe('live host page', () => {
  it('explains when the account may not host, and never shows a stream key by default', async () => {
    request.mockImplementation(async (m: string, path: string) => {
      if (m === 'GET' && path === '/live') return { items: [] };
      throw Object.assign(
        new Error('Only approved farm owners and sellers can start a live stream.'),
        { status: 403 },
      );
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LiveHostPage />
      </MemoryRouter>,
    );
    await user.type(await screen.findByLabelText('Title'), 'Morning milking');
    await user.click(screen.getByRole('button', { name: 'Create live stream' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Only approved farm owners and sellers can start/,
    );
    expect(screen.queryByTestId('ingest-key')).toBeNull();
  });

  it('shows the key only after asking, then hides it again; ending needs a confirmation', async () => {
    const live = {
      id: ID(5),
      host: { id: 'me', displayName: 'Me' },
      title: 'Show',
      access: 'public',
      state: 'created',
      status: 'published',
      createdAt: '2026-03-01T00:00:00Z',
      viewer: { isHost: true, followsHost: false },
    };
    request.mockImplementation(async (m: string, path: string) => {
      if (m === 'GET' && path === '/live') return { items: [live] };
      if (path.endsWith('/ingest'))
        return { rtmpsUrl: 'rtmps://live.example.test/live/', streamKey: 'SECRET-KEY' };
      if (path.endsWith('/end')) return { live: { ...live, state: 'ended' } };
      throw new Error(`unexpected ${m} ${path}`);
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LiveHostPage />
      </MemoryRouter>,
    );
    await screen.findByText(/Waiting for your streaming app/);
    expect(screen.queryByText('SECRET-KEY')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show stream settings' }));
    expect(await screen.findByTestId('ingest-key')).toHaveProperty('textContent', 'SECRET-KEY');
    await user.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByTestId('ingest-key')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'End stream' }));
    expect(request).not.toHaveBeenCalledWith('POST', `/live/${ID(5)}/end`);
    await user.click(screen.getAllByRole('button', { name: 'End stream' }).at(-1)!);
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', `/live/${ID(5)}/end`));
  });
});

describe('videos and live in Thai', () => {
  beforeEach(() => setLocale('th'));

  it('renders the video feed in Thai and switches to English', async () => {
    request.mockImplementation(async (_m: string, path: string) =>
      path === '/videos' ? { items: [{ ...video(1), viewCount: 4 }] } : playback(),
    );
    render(
      <MemoryRouter>
        <VideoFeedPage />
      </MemoryRouter>,
    );
    expect(await screen.findByLabelText('Video 1 โดย Somchai')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'วิดีโอสั้น' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'วิดีโอของฉัน' })).toBeTruthy();
    expect(screen.getByText('ดู 4 ครั้ง')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'รายงานวิดีโอ' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'เปิดเสียง' })).toBeTruthy();

    act(() => setLocale('en'));
    expect(screen.getByRole('heading', { name: 'Short videos' })).toBeTruthy();
    expect(screen.getByText('4 views')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeTruthy();
  });

  it('renders the upload form and its file check in Thai', async () => {
    request.mockResolvedValue({
      maxUploadBytes: 1000,
      maxDurationSeconds: 60,
      mimeTypes: ['video/mp4'],
      provider: 'mock',
    });
    const user = userEvent.setup({ applyAccept: false });
    render(
      <MemoryRouter>
        <UploadPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/ความยาวไม่เกิน 60 วินาที/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'อัปโหลดวิดีโอ' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'สาธารณะ' })).toBeTruthy();
    await user.upload(
      screen.getByLabelText('ไฟล์วิดีโอ'),
      new File(['x'], 'a.pdf', { type: 'application/pdf' }),
    );
    await user.click(screen.getByRole('button', { name: 'อัปโหลด' }));
    expect(await screen.findByText(/กรุณาเลือกไฟล์วิดีโอ MP4/)).toBeTruthy();
  });

  it('renders the live host page in Thai', async () => {
    const live = {
      id: ID(5),
      host: { id: 'me', displayName: 'Me' },
      title: 'Show',
      access: 'followers',
      state: 'created',
      status: 'published',
      createdAt: '2026-03-01T00:00:00Z',
      viewer: { isHost: true, followsHost: false },
    };
    request.mockResolvedValue({ items: [live] });
    render(
      <MemoryRouter>
        <LiveHostPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('กำลังรอให้แอปสตรีมของคุณเชื่อมต่อ…')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'เริ่มไลฟ์' })).toBeTruthy();
    expect(screen.getByText('รอเริ่ม')).toBeTruthy();
    expect(screen.getByText(/เฉพาะผู้ติดตาม/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'จบไลฟ์' })).toBeTruthy();

    act(() => setLocale('en'));
    expect(screen.getByRole('heading', { name: 'Go live' })).toBeTruthy();
    expect(screen.getByText('Created')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'End stream' })).toBeTruthy();
  });
});
