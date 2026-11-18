import { describe, expect, it } from 'vitest';
import {
  mergeCursorPage,
  optimisticReaction,
  settleReaction,
  toPostPayload,
  validatePostDraft,
  type PostDraft,
} from '../src/lib/community';

const draft = (over: Partial<PostDraft> = {}): PostDraft => ({
  body: 'Hello',
  visibility: 'public',
  media: [],
  ...over,
});

describe('post draft', () => {
  it('trims, drops empty media rows and empty captions', () => {
    expect(
      toPostPayload(
        draft({
          body: '  Hi  ',
          media: [
            { kind: 'image', url: ' https://cdn.example.test/a.jpg ', caption: ' ' },
            { kind: 'video', url: '', caption: 'ignored' },
          ],
        }),
      ),
    ).toEqual({
      body: 'Hi',
      visibility: 'public',
      media: [{ kind: 'image', url: 'https://cdn.example.test/a.jpg' }],
    });
  });

  it('uses the API rules: empty post, http link, more than 4 files', () => {
    expect(validatePostDraft(draft())).toEqual({});
    expect(validatePostDraft(draft({ body: '   ' }))['body']).toMatch(/Write something/);
    expect(
      validatePostDraft(
        draft({ media: [{ kind: 'image', url: 'http://cdn.example.test/a.jpg', caption: '' }] }),
      )['media.0.url'],
    ).toBeTruthy();
    const five = Array.from({ length: 5 }, (_, i) => ({
      kind: 'image' as const,
      url: `https://cdn.example.test/${i}.jpg`,
      caption: '',
    }));
    expect(Object.keys(validatePostDraft(draft({ media: five }))).length).toBeGreaterThan(0);
    expect(validatePostDraft(draft({ body: 'x'.repeat(2001) }))['body']).toBeTruthy();
  });

  it('a media-only post is valid', () => {
    expect(
      validatePostDraft(
        draft({
          body: '',
          media: [{ kind: 'video', url: 'https://cdn.example.test/v.mp4', caption: '' }],
        }),
      ),
    ).toEqual({});
  });
});

describe('cursor paging', () => {
  const row = (id: string) => ({ id });
  it('first page replaces; later pages append without duplicates', () => {
    expect(mergeCursorPage([row('x')], { items: [row('a'), row('b')] }, true)).toEqual([
      row('a'),
      row('b'),
    ]);
    expect(mergeCursorPage([row('a'), row('b')], { items: [row('b'), row('c')] }, false)).toEqual([
      row('a'),
      row('b'),
      row('c'),
    ]);
  });
});

describe('likes', () => {
  const item = { reactionCount: 2, viewer: { reacted: false } };
  it('toggles optimistically and never goes below zero', () => {
    expect(optimisticReaction(item)).toEqual({ reactionCount: 3, viewer: { reacted: true } });
    expect(optimisticReaction({ reactionCount: 0, viewer: { reacted: true } })).toEqual({
      reactionCount: 0,
      viewer: { reacted: false },
    });
  });
  it('settles on what the server says', () => {
    expect(settleReaction(optimisticReaction(item), { reacted: true, reactionCount: 5 })).toEqual({
      reactionCount: 5,
      viewer: { reacted: true },
    });
  });
});
