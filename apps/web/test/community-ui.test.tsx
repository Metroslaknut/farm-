import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostDTO } from '@farmplus/shared-types';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));

import { MediaGrid } from '../src/pages/community/MediaViewer';
import { PostCard } from '../src/pages/community/PostCard';
import { PostComposer } from '../src/pages/community/PostComposer';
import FeedPage from '../src/pages/community/FeedPage';
import ModerationPage from '../src/pages/admin/moderation';
import { setLocale } from '../src/i18n';

const ID = (n: number) => String(n).padStart(24, '0');
const post = (over: Partial<PostDTO> = {}): PostDTO => ({
  id: ID(1),
  author: { id: ID(9), displayName: 'Somchai' },
  body: 'Calf born today',
  media: [],
  visibility: 'public',
  status: 'published',
  reactionCount: 2,
  commentCount: 1,
  createdAt: '2026-03-01T00:00:00Z',
  viewer: { reacted: false, isAuthor: false, followsAuthor: false },
  ...over,
});

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  request.mockReset();
});

describe('PostCard', () => {
  it('likes optimistically and settles on the server count', async () => {
    const onChange = vi.fn();
    request.mockResolvedValue({ reacted: true, reactionCount: 3 });
    const user = userEvent.setup();
    wrap(<PostCard post={post()} onChange={onChange} onRemoved={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Like · 2/ }));
    expect(onChange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        reactionCount: 3,
        viewer: expect.objectContaining({ reacted: true }),
      }),
    );
    expect(request).toHaveBeenCalledWith('POST', `/posts/${ID(1)}/reactions`, {
      body: { type: 'like' },
    });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reactionCount: 3,
        viewer: expect.objectContaining({ reacted: true }),
      }),
    );
  });

  it('rolls the like back and shows the error when the API refuses', async () => {
    const onChange = vi.fn();
    request.mockRejectedValue(new Error('Post not found'));
    const user = userEvent.setup();
    const original = post();
    wrap(<PostCard post={original} onChange={onChange} onRemoved={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Like · 2/ }));
    await screen.findByText('Post not found');
    expect(onChange).toHaveBeenLastCalledWith(original);
  });

  it('unliking uses DELETE', async () => {
    request.mockResolvedValue({ reacted: false, reactionCount: 1 });
    const user = userEvent.setup();
    wrap(
      <PostCard
        post={post({ viewer: { reacted: true, isAuthor: false, followsAuthor: false } })}
        onChange={vi.fn()}
        onRemoved={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Liked · 2/ }));
    expect(request).toHaveBeenCalledWith('DELETE', `/posts/${ID(1)}/reactions`, {});
  });

  it('offers Edit/Delete to the author and only Report to everyone else', async () => {
    const user = userEvent.setup();
    const { unmount } = wrap(
      <PostCard
        post={post({ viewer: { reacted: false, isAuthor: true, followsAuthor: false } })}
        onChange={vi.fn()}
        onRemoved={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Post actions' }));
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Report' })).toBeNull();
    unmount();

    wrap(<PostCard post={post()} onChange={vi.fn()} onRemoved={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Post actions' }));
    expect(screen.getByRole('menuitem', { name: 'Report' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
  });

  it('shows the moderation notice to the author and blocks editing and liking', async () => {
    const user = userEvent.setup();
    wrap(
      <PostCard
        post={post({
          status: 'hidden',
          moderationNotice: 'A moderator hid this.',
          viewer: { reacted: false, isAuthor: true, followsAuthor: false },
        })}
        onChange={vi.fn()}
        onRemoved={vi.fn()}
      />,
    );
    expect(screen.getByText('A moderator hid this.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Like/ }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Post actions' }));
    expect(screen.getByRole('menuitem', { name: 'Edit' }).hasAttribute('disabled')).toBe(true);
  });

  it('renders post text as text, never as HTML', () => {
    wrap(
      <PostCard
        post={post({ body: '<img src=x onerror=alert(1)><b>bold</b>' })}
        onChange={vi.fn()}
        onRemoved={vi.fn()}
      />,
    );
    expect(document.querySelector('article img')).toBeNull();
    expect(document.querySelector('article b')).toBeNull();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeTruthy();
  });

  it('reports with a reason', async () => {
    request.mockResolvedValue({ reported: true });
    const user = userEvent.setup();
    wrap(<PostCard post={post()} onChange={vi.fn()} onRemoved={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Post actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Report' }));
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    expect(request).not.toHaveBeenCalled(); // no reason chosen → nothing is sent
    await user.selectOptions(screen.getByLabelText('Reason'), 'spam');
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('POST', `/posts/${ID(1)}/reports`, {
        body: { reason: 'spam' },
      }),
    );
    expect(await screen.findByText(/moderators will take a look/)).toBeTruthy();
  });
});

describe('media viewer', () => {
  it('opens the viewer on the selected file and navigates between files', async () => {
    const user = userEvent.setup();
    const media = [
      { id: 'a', kind: 'image' as const, url: 'https://cdn.example.test/1.jpg', caption: 'First' },
      { id: 'b', kind: 'video' as const, url: 'https://cdn.example.test/2.mp4' },
    ];
    wrap(<MediaGrid media={media} />);
    expect(document.querySelector('dialog[open]')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Open image: First/ }));
    const dialog = document.querySelector('dialog')!;
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe(media[0]!.url);
    expect(dialog.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(dialog.querySelector('video')?.getAttribute('src')).toBe(media[1]!.url);
    expect(
      (within(dialog).getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('composer', () => {
  it('rejects an empty post and non-https media without calling the API', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    wrap(<PostComposer submitLabel="Post" onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByText(/Write something or attach/)).toBeTruthy();
    await user.type(screen.getByLabelText('Share with the community'), 'hi');
    await user.click(screen.getByRole('button', { name: 'Add photo or video' }));
    await user.type(
      screen.getByLabelText('File link (https)'),
      'http://insecure.example.test/a.jpg',
    );
    await user.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(document.querySelector('[aria-invalid="true"]')).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('limits media to four and submits a clean payload', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    wrap(<PostComposer submitLabel="Post" onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText('Share with the community'), '  Hello  ');
    for (let i = 0; i < 4; i++)
      await user.click(screen.getByRole('button', { name: 'Add photo or video' }));
    expect(
      (screen.getByRole('button', { name: 'Add photo or video' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    const links = screen.getAllByLabelText('File link (https)');
    await user.type(links[0]!, 'https://cdn.example.test/1.jpg');
    for (const l of links.slice(1))
      await user.type(l, `https://cdn.example.test/${Math.random().toString(36).slice(2)}.jpg`);
    await user.selectOptions(screen.getByLabelText('Who can see this'), 'followers');
    await user.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const value = onSubmit.mock.calls[0]![0];
    expect(value.body).toBe('Hello');
    expect(value.visibility).toBe('followers');
    expect(value.media).toHaveLength(4);
  });

  it('shows server-side field errors', async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      Object.assign(new Error('Request validation failed'), {
        details: [{ path: 'media.0.url', message: 'This host is not an allowed media source' }],
      }),
    );
    const user = userEvent.setup();
    wrap(<PostComposer submitLabel="Post" onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: 'Add photo or video' }));
    await user.type(screen.getByLabelText('File link (https)'), 'https://evil.example.org/a.jpg');
    await user.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByText('This host is not an allowed media source')).toBeTruthy();
  });
});

describe('feed page', () => {
  const page = (ids: number[], nextCursor?: string) => ({
    items: ids.map((n) => post({ id: ID(n), body: `post ${n}` })),
    ...(nextCursor ? { nextCursor } : {}),
  });

  it('loads more with the cursor, appends without duplicates and hides the button on the last page', async () => {
    request.mockImplementation(
      async (_m: string, _p: string, opts?: { query?: Record<string, unknown> }) =>
        opts?.query?.['cursor'] === 'c1' ? page([2, 3]) : page([1, 2], 'c1'),
    );
    const user = userEvent.setup();
    wrap(<FeedPage />);
    await screen.findByText('post 1');
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('post 3');
    expect(screen.getAllByText('post 2')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('switching to “People I follow” requests that scope and discards the old list', async () => {
    request.mockImplementation(
      async (_m: string, _p: string, opts?: { query?: Record<string, unknown> }) =>
        opts?.query?.['scope'] === 'following' ? page([7]) : page([1]),
    );
    const user = userEvent.setup();
    wrap(<FeedPage />);
    await screen.findByText('post 1');
    await user.selectOptions(screen.getByLabelText('Show'), 'following');
    await screen.findByText('post 7');
    expect(screen.queryByText('post 1')).toBeNull();
  });

  it('shows an empty state and a retryable error', async () => {
    request.mockResolvedValueOnce({ items: [] });
    wrap(<FeedPage />);
    expect(await screen.findByText(/be the first to share/)).toBeTruthy();
  });
});

describe('moderation queue', () => {
  const report = {
    id: ID(5),
    targetType: 'post',
    targetId: ID(1),
    postId: ID(1),
    reason: 'abuse',
    details: 'rude',
    status: 'open',
    createdAt: '2026-03-01T00:00:00Z',
    reporter: { id: ID(2), displayName: 'Reporter' },
    snapshot: { body: 'offending text', author: { id: ID(3), displayName: 'Author' }, media: [] },
    targetStatus: 'published',
    reportsOnTarget: 2,
  };

  it('requires a reason before hiding and posts the action', async () => {
    request.mockImplementation(async (m: string) => {
      if (m === 'GET') return { items: [report] };
      return { report: { ...report, status: 'actioned' } };
    });
    const user = userEvent.setup();
    render(<ModerationPage />);
    await screen.findByText('offending text');
    expect(screen.getByText(/2 open reports on this/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Hide' }));
    const confirm = screen.getAllByRole('button', { name: 'Hide' }).at(-1) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByLabelText(/Reason/), 'breaks rule 3');
    await user.click(screen.getAllByRole('button', { name: 'Hide' }).at(-1)!);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('POST', `/moderation/reports/${ID(5)}/resolve`, {
        body: { action: 'hide', note: 'breaks rule 3' },
      }),
    );
  });

  it('resolved reports show no action buttons', async () => {
    request.mockResolvedValue({
      items: [
        {
          ...report,
          status: 'dismissed',
          resolution: { action: 'dismiss', note: 'fine', by: 'Mod', at: '2026-03-02T00:00:00Z' },
        },
      ],
    });
    render(<ModerationPage />);
    await screen.findByText('offending text');
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull();
    expect(screen.getByText(/Dismiss by Mod/)).toBeTruthy();
  });
});

describe('community in Thai', () => {
  beforeEach(() => setLocale('th'));

  it('renders the feed in Thai and switches to English without a reload', async () => {
    request.mockResolvedValue({
      items: [post({ visibility: 'followers', commentCount: 3 })],
    });
    wrap(<FeedPage />);
    expect(await screen.findByText('Calf born today')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'ชุมชน' })).toBeTruthy();
    expect(screen.getByLabelText('แบ่งปันกับชุมชน')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'โพสต์' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'คนที่ฉันติดตาม' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'มาแรงสัปดาห์นี้' })).toBeTruthy();
    expect(screen.getByText('ผู้ติดตาม', { selector: '.ds-badge, span' })).toBeTruthy();
    expect(screen.getByText('3 ความคิดเห็น')).toBeTruthy();
    expect(screen.getByRole('button', { name: /ถูกใจ · 2/ })).toBeTruthy();

    act(() => setLocale('en'));
    expect(screen.getByRole('heading', { name: 'Community' })).toBeTruthy();
    expect(screen.getByLabelText('Share with the community')).toBeTruthy();
    expect(screen.getByText('3 comments')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Like · 2/ })).toBeTruthy();
  });

  it('shows report reasons and the thank-you notice in Thai', async () => {
    request.mockResolvedValue({ reported: true });
    const user = userEvent.setup();
    wrap(<PostCard post={post()} onChange={vi.fn()} onRemoved={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'ตัวเลือกโพสต์' }));
    await user.click(screen.getByRole('menuitem', { name: 'รายงาน' }));
    expect(screen.getByText('รายงานโพสต์นี้')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'ทารุณกรรมสัตว์' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'ส่งรายงาน' }));
    expect(await screen.findByText('กรุณาเลือกเหตุผล')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('เหตุผล'), 'spam');
    await user.click(screen.getByRole('button', { name: 'ส่งรายงาน' }));
    expect(await screen.findByText(/ทีมผู้ดูแลจะตรวจสอบ/)).toBeTruthy();
  });
});
