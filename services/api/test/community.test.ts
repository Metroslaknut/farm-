/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog, Comment, ContentReport, Follow, Post, Reaction, User } from '../src/models';
import {
  createStaff,
  createUser,
  startHarness,
  type Session,
  type Staff,
  type TestHarness,
} from './helpers';

let h: TestHarness;
let alice: Session;
let bob: Session;
let carol: Session;
let mod: Staff;

const API = '/api/v1';
const MEDIA = 'https://cdn.example.test/p/1.jpg';

beforeAll(async () => {
  h = await startHarness({ MEDIA_ALLOWED_HOSTS: 'cdn.example.test' });
  [alice, bob, carol] = [await createUser(h.app), await createUser(h.app), await createUser(h.app)];
  mod = await createStaff(h.app, ['moderator']);
});
afterAll(async () => {
  await h.stop();
});

const post = async (s: Session, body: object = {}, expectStatus = 201) => {
  const res = await request(h.app)
    .post(`${API}/posts`)
    .set(s.auth)
    .send({ body: 'hello farm', ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(expectStatus);
  return res.body.post as { id: string; [k: string]: any };
};
const get = (s: Session, path: string) => request(h.app).get(`${API}${path}`).set(s.auth);
const send = (
  method: 'post' | 'patch' | 'delete' | 'put',
  s: Session,
  path: string,
  body?: object,
) => request(h.app)[method](`${API}${path}`).set(s.auth).send(body);
const follow = (s: Session, target: Session) => send('post', s, `/users/${target.id}/follow`);

describe('posts: create / validation', () => {
  it('requires authentication on every community route', async () => {
    for (const [m, p] of [
      ['get', '/posts'],
      ['post', '/posts'],
      ['get', `/posts/${'a'.repeat(24)}`],
      ['post', `/posts/${'a'.repeat(24)}/reactions`],
      ['get', `/posts/${'a'.repeat(24)}/comments`],
      ['post', `/users/${alice.id}/follow`],
      ['get', '/moderation/reports'],
    ] as const) {
      const res = await request(h.app)[m](`${API}${p}`);
      expect(res.status, `${m} ${p}`).toBe(401);
    }
  });

  it('creates a text post with the author, default public visibility and zero counters', async () => {
    const p = await post(alice, { body: '  Our buffalo calved today  ' });
    expect(p).toMatchObject({
      body: 'Our buffalo calved today',
      visibility: 'public',
      status: 'published',
      reactionCount: 0,
      commentCount: 0,
      author: { id: alice.id },
      viewer: { isAuthor: true, reacted: false },
    });
    expect(JSON.stringify(p)).not.toContain(alice.email); // no e-mail leaks through the author
  });

  it('creates a post with externally hosted image and video', async () => {
    const p = await post(alice, {
      body: '',
      media: [
        { kind: 'image', url: MEDIA, mimeType: 'image/jpeg', caption: 'Calf' },
        { kind: 'video', url: 'https://cdn.example.test/v/1.mp4', mimeType: 'video/mp4' },
      ],
    });
    expect(p.media).toHaveLength(2);
    expect(p.media[0]).toMatchObject({ kind: 'image', url: MEDIA, caption: 'Calf' });
  });

  it.each([
    ['empty post', { body: '   ' }],
    ['too long', { body: 'x'.repeat(2001) }],
    [
      'five media',
      {
        media: Array.from({ length: 5 }, (_, i) => ({
          kind: 'image',
          url: `https://cdn.example.test/${i}.jpg`,
        })),
      },
    ],
    ['http media', { media: [{ kind: 'image', url: 'http://cdn.example.test/a.jpg' }] }],
    ['javascript url', { media: [{ kind: 'image', url: 'javascript:alert(1)' }] }],
    ['host not allowed', { media: [{ kind: 'image', url: 'https://evil.example.org/a.jpg' }] }],
    ['video mime on image', { media: [{ kind: 'image', url: MEDIA, mimeType: 'video/mp4' }] }],
    [
      'duplicate media',
      {
        media: [
          { kind: 'image', url: MEDIA },
          { kind: 'image', url: MEDIA },
        ],
      },
    ],
    ['control characters', { body: 'hi‮evil' }],
    ['bad visibility', { visibility: 'friends' }],
    ['mass assignment of author', { authorId: 'a'.repeat(24) }],
    ['mass assignment of status', { status: 'removed' }],
    ['mass assignment of counters', { reactionCount: 999 }],
  ])('rejects %s with 400', async (_name, extra) => {
    await post(alice, extra, 400);
  });

  it('never stores a client-supplied author or counters', async () => {
    const p = await post(alice, {});
    const doc = await Post.findById(p.id);
    expect(String(doc?.authorId)).toBe(alice.id);
    expect(doc?.reactionCount).toBe(0);
  });
});

describe('posts: edit / delete authorization', () => {
  it('only the author can edit; others get 404 (no probing); history of old text is kept', async () => {
    const p = await post(alice, { body: 'v1' });
    expect((await send('patch', bob, `/posts/${p.id}`, { body: 'hacked' })).status).toBe(404);
    expect((await send('patch', mod, `/posts/${p.id}`, { body: 'hacked' })).status).toBe(404);
    const ok = await send('patch', alice, `/posts/${p.id}`, { body: 'v2' });
    expect(ok.status).toBe(200);
    expect(ok.body.post).toMatchObject({ body: 'v2' });
    expect(ok.body.post.editedAt).toBeTruthy();
    const doc = await Post.findById(p.id);
    expect(doc?.edits.map((e) => e.body)).toEqual(['v1']);
  });

  it('rejects an edit that leaves the post empty, unknown fields, and status changes', async () => {
    const p = await post(alice, { body: 'text' });
    expect((await send('patch', alice, `/posts/${p.id}`, { body: '' })).status).toBe(400);
    expect((await send('patch', alice, `/posts/${p.id}`, {})).status).toBe(400);
    expect((await send('patch', alice, `/posts/${p.id}`, { status: 'published' })).status).toBe(
      400,
    );
    expect((await send('patch', alice, `/posts/${p.id}`, { authorId: bob.id })).status).toBe(400);
  });

  it('only the author can delete; delete is soft and the post vanishes for everyone', async () => {
    const p = await post(alice, { body: 'to delete' });
    expect((await send('delete', bob, `/posts/${p.id}`)).status).toBe(404);
    expect((await send('delete', alice, `/posts/${p.id}`)).status).toBe(204);
    for (const s of [alice, bob]) expect((await get(s, `/posts/${p.id}`)).status).toBe(404);
    expect((await get(bob, `/posts/${p.id}/comments`)).status).toBe(404);
    expect((await send('post', bob, `/posts/${p.id}/reactions`)).status).toBe(404);
    expect((await send('patch', alice, `/posts/${p.id}`, { body: 'zombie' })).status).toBe(404);
    expect(await Post.findById(p.id)).toMatchObject({ status: 'deleted' }); // retained for moderators
  });

  it('a malformed id is 404, not a server error', async () => {
    expect((await get(alice, '/posts/not-an-id')).status).toBe(404);
  });
});

describe('visibility', () => {
  it('public / followers / private are enforced on every route', async () => {
    const author = await createUser(h.app);
    const follower = await createUser(h.app);
    const stranger = await createUser(h.app);
    await follow(follower, author);
    const pub = await post(author, { body: 'pub', visibility: 'public' });
    const fol = await post(author, { body: 'fol', visibility: 'followers' });
    const priv = await post(author, { body: 'priv', visibility: 'private' });

    const canSee = async (s: Session, id: string) => (await get(s, `/posts/${id}`)).status === 200;
    expect([
      await canSee(author, pub.id),
      await canSee(author, fol.id),
      await canSee(author, priv.id),
    ]).toEqual([true, true, true]);
    expect([
      await canSee(follower, pub.id),
      await canSee(follower, fol.id),
      await canSee(follower, priv.id),
    ]).toEqual([true, true, false]);
    expect([
      await canSee(stranger, pub.id),
      await canSee(stranger, fol.id),
      await canSee(stranger, priv.id),
    ]).toEqual([true, false, false]);

    // side doors: comments, reactions, reports, feed
    for (const id of [fol.id, priv.id]) {
      expect((await get(stranger, `/posts/${id}/comments`)).status).toBe(404);
      expect((await send('post', stranger, `/posts/${id}/comments`, { body: 'hi' })).status).toBe(
        404,
      );
      expect((await send('post', stranger, `/posts/${id}/reactions`)).status).toBe(404);
      expect(
        (await send('post', stranger, `/posts/${id}/reports`, { reason: 'spam' })).status,
      ).toBe(404);
    }
    const ids = (r: request.Response) => r.body.items.map((i: { id: string }) => i.id);
    const strangerFeed = ids(await get(stranger, `/posts?authorId=${author.id}`));
    expect(strangerFeed).toEqual([pub.id]);
    const followerFeed = ids(await get(follower, `/posts?authorId=${author.id}`));
    expect(followerFeed.sort()).toEqual([pub.id, fol.id].sort());
    const ownFeed = ids(await get(author, `/posts?authorId=${author.id}`));
    expect(ownFeed.sort()).toEqual([pub.id, fol.id, priv.id].sort());
    const global = ids(await get(stranger, '/posts?limit=50'));
    expect(global).toContain(pub.id);
    expect(global).not.toContain(fol.id);
    expect(global).not.toContain(priv.id);

    // unfollowing removes access immediately
    await send('delete', follower, `/users/${author.id}/follow`);
    expect(await canSee(follower, fol.id)).toBe(false);
  });

  it('changing visibility takes effect immediately', async () => {
    const p = await post(alice, { body: 'was public' });
    expect((await get(bob, `/posts/${p.id}`)).status).toBe(200);
    await send('patch', alice, `/posts/${p.id}`, { visibility: 'private' });
    expect((await get(bob, `/posts/${p.id}`)).status).toBe(404);
  });
});

describe('feed: cursor pagination, scope and ranking', () => {
  it('pages through all posts newest-first without duplicates or gaps', async () => {
    const author = await createUser(h.app);
    const created: string[] = [];
    for (let i = 0; i < 7; i++) created.push((await post(author, { body: `p${i}` })).id);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await get(
        bob,
        `/posts?authorId=${author.id}&limit=3${cursor ? `&cursor=${cursor}` : ''}`,
      );
      expect(res.status).toBe(200);
      seen.push(...res.body.items.map((i: { id: string }) => i.id));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual([...created].reverse());
    expect(new Set(seen).size).toBe(7);
  });

  it('a post created while paging does not shift or duplicate later pages', async () => {
    const author = await createUser(h.app);
    for (let i = 0; i < 4; i++) await post(author, { body: `x${i}` });
    const first = await get(bob, `/posts?authorId=${author.id}&limit=2`);
    await post(author, { body: 'late' });
    const second = await get(
      bob,
      `/posts?authorId=${author.id}&limit=2&cursor=${first.body.nextCursor}`,
    );
    const all = [...first.body.items, ...second.body.items].map((i: { body: string }) => i.body);
    expect(all).toEqual(['x3', 'x2', 'x1', 'x0']);
  });

  it('omits nextCursor on the last page and rejects forged cursors', async () => {
    const res = await get(bob, '/posts?limit=50');
    expect(res.body.nextCursor === undefined || typeof res.body.nextCursor === 'string').toBe(true);
    const author = await createUser(h.app);
    await post(author, {});
    const only = await get(bob, `/posts?authorId=${author.id}&limit=5`);
    expect(only.body.nextCursor).toBeUndefined();
    for (const bad of [
      'garbage',
      Buffer.from('{"k":"x","id":"1"}').toString('base64url'),
      Buffer.from('{"$ne":1}').toString('base64url'),
    ]) {
      expect((await get(bob, `/posts?cursor=${bad}`)).status, bad).toBe(400);
    }
    expect((await get(bob, '/posts?limit=0')).status).toBe(400);
    expect((await get(bob, '/posts?limit=1000')).status).toBe(400);
    expect((await get(bob, '/posts?sort=random')).status).toBe(400);
  });

  it('scope=following shows followed authors (and yourself) only', async () => {
    const viewer = await createUser(h.app);
    const followed = await createUser(h.app);
    const other = await createUser(h.app);
    await follow(viewer, followed);
    const a = await post(followed, { body: 'from followed' });
    await post(other, { body: 'from other' });
    const mine = await post(viewer, { body: 'mine' });
    const res = await get(viewer, '/posts?scope=following&limit=50');
    expect(res.body.items.map((i: { id: string }) => i.id).sort()).toEqual([a.id, mine.id].sort());
  });

  it('trending orders by engagement and pages consistently', async () => {
    const author = await createUser(h.app);
    const quiet = await post(author, { body: 'quiet' });
    const liked = await post(author, { body: 'liked' });
    const talked = await post(author, { body: 'talked' });
    await send('post', bob, `/posts/${liked.id}/reactions`);
    await send('post', carol, `/posts/${liked.id}/reactions`);
    await send('post', bob, `/posts/${talked.id}/comments`, { body: 'a' });
    await send('post', carol, `/posts/${talked.id}/comments`, { body: 'b' });
    await send('post', carol, `/posts/${talked.id}/comments`, { body: 'c' });
    const first = await get(alice, `/posts?sort=trending&authorId=${author.id}&limit=2`);
    expect(first.body.items.map((i: { id: string }) => i.id)).toEqual([talked.id, liked.id]);
    const next = await get(
      alice,
      `/posts?sort=trending&authorId=${author.id}&limit=2&cursor=${first.body.nextCursor}`,
    );
    expect(next.body.items.map((i: { id: string }) => i.id)).toEqual([quiet.id]);
  });

  it('trending ignores posts older than 7 days', async () => {
    const author = await createUser(h.app);
    const old = await post(author, { body: 'old' });
    await Post.collection.updateOne(
      { _id: new Types.ObjectId(old.id) },
      { $set: { createdAt: new Date(Date.now() - 8 * 86_400_000) } },
    );
    const res = await get(bob, `/posts?sort=trending&authorId=${author.id}`);
    expect(res.body.items).toHaveLength(0);
  });
});

describe('reactions', () => {
  it('like is idempotent: one record per user and target, counter stays exact', async () => {
    const p = await post(alice, { body: 'like me' });
    const r1 = await send('post', bob, `/posts/${p.id}/reactions`, { type: 'like' });
    const r2 = await send('post', bob, `/posts/${p.id}/reactions`);
    expect(r1.body).toEqual({ reacted: true, reactionCount: 1 });
    expect(r2.body).toEqual({ reacted: true, reactionCount: 1 });
    expect(await Reaction.countDocuments({ targetId: p.id, userId: bob.id })).toBe(1);
    const viewed = await get(bob, `/posts/${p.id}`);
    expect(viewed.body.post).toMatchObject({ reactionCount: 1, viewer: { reacted: true } });
    expect((await get(carol, `/posts/${p.id}`)).body.post.viewer.reacted).toBe(false);
  });

  it('30 parallel likes by one user create exactly one record and count 1', async () => {
    const p = await post(alice, { body: 'race' });
    const results = await Promise.all(
      Array.from({ length: 30 }, () => send('post', carol, `/posts/${p.id}/reactions`)),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await Reaction.countDocuments({ targetId: p.id })).toBe(1);
    expect((await Post.findById(p.id))?.reactionCount).toBe(1);
  });

  it('unlike removes the record; repeating it never goes negative; parallel unlikes decrement once', async () => {
    const p = await post(alice, { body: 'unlike' });
    await send('post', bob, `/posts/${p.id}/reactions`);
    await send('post', carol, `/posts/${p.id}/reactions`);
    const un = await Promise.all(
      Array.from({ length: 10 }, () => send('delete', bob, `/posts/${p.id}/reactions`)),
    );
    expect(un.every((r) => r.status === 200)).toBe(true);
    expect((await Post.findById(p.id))?.reactionCount).toBe(1);
    expect((await send('delete', bob, `/posts/${p.id}/reactions`)).body).toEqual({
      reacted: false,
      reactionCount: 1,
    });
    expect((await send('delete', carol, `/posts/${p.id}/reactions`)).body.reactionCount).toBe(0);
    expect((await send('delete', carol, `/posts/${p.id}/reactions`)).body.reactionCount).toBe(0);
  });

  it('the database itself refuses a duplicate reaction row', async () => {
    const p = await post(alice, { body: 'unique index' });
    await Reaction.create({ targetType: 'post', targetId: p.id, userId: bob.id });
    await expect(
      Reaction.create({ targetType: 'post', targetId: p.id, userId: bob.id }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('rejects unknown reaction types and mass assignment', async () => {
    const p = await post(alice, { body: 'types' });
    expect((await send('post', bob, `/posts/${p.id}/reactions`, { type: 'angry' })).status).toBe(
      400,
    );
    expect((await send('post', bob, `/posts/${p.id}/reactions`, { userId: carol.id })).status).toBe(
      400,
    );
  });
});

describe('comments and replies', () => {
  it('creates comments, replies and keeps counters exact; reply-to-reply is flattened', async () => {
    const p = await post(alice, { body: 'discuss' });
    const c1 = (await send('post', bob, `/posts/${p.id}/comments`, { body: 'first' })).body.comment;
    expect(c1).toMatchObject({
      body: 'first',
      parentId: null,
      postId: p.id,
      replyCount: 0,
      author: { id: bob.id },
    });
    const r1 = (
      await send('post', carol, `/posts/${p.id}/comments`, { body: 'reply', parentId: c1.id })
    ).body.comment;
    expect(r1.parentId).toBe(c1.id);
    const r2 = (
      await send('post', alice, `/posts/${p.id}/comments`, {
        body: 'reply to reply',
        parentId: r1.id,
      })
    ).body.comment;
    expect(r2.parentId).toBe(c1.id);
    expect((await Post.findById(p.id))?.commentCount).toBe(3);
    expect((await Comment.findById(c1.id))?.replyCount).toBe(2);

    const top = await get(alice, `/posts/${p.id}/comments`);
    expect(top.body.items.map((c: { id: string }) => c.id)).toEqual([c1.id]);
    expect(top.body.items[0].replyCount).toBe(2);
    const replies = await get(alice, `/posts/${p.id}/comments?parentId=${c1.id}`);
    expect(replies.body.items.map((c: { id: string }) => c.id)).toEqual([r1.id, r2.id]);
    expect((await get(alice, `/posts/${p.id}`)).body.post.commentCount).toBe(3);
  });

  it('comments paginate oldest-first by cursor', async () => {
    const p = await post(alice, { body: 'many' });
    for (let i = 0; i < 5; i++)
      await send('post', bob, `/posts/${p.id}/comments`, { body: `c${i}` });
    const a = await get(carol, `/posts/${p.id}/comments?limit=2`);
    const b = await get(carol, `/posts/${p.id}/comments?limit=2&cursor=${a.body.nextCursor}`);
    const c = await get(carol, `/posts/${p.id}/comments?limit=2&cursor=${b.body.nextCursor}`);
    expect(
      [...a.body.items, ...b.body.items, ...c.body.items].map((x: { body: string }) => x.body),
    ).toEqual(['c0', 'c1', 'c2', 'c3', 'c4']);
    expect(c.body.nextCursor).toBeUndefined();
  });

  it('validates comments; a parent from another post or a missing parent is 404', async () => {
    const p1 = await post(alice, { body: 'one' });
    const p2 = await post(alice, { body: 'two' });
    const c = (await send('post', bob, `/posts/${p1.id}/comments`, { body: 'x' })).body.comment;
    expect((await send('post', bob, `/posts/${p1.id}/comments`, { body: '' })).status).toBe(400);
    expect(
      (await send('post', bob, `/posts/${p1.id}/comments`, { body: 'y'.repeat(1001) })).status,
    ).toBe(400);
    expect(
      (await send('post', bob, `/posts/${p1.id}/comments`, { body: 'y', postId: p2.id })).status,
    ).toBe(400);
    expect(
      (await send('post', bob, `/posts/${p2.id}/comments`, { body: 'y', parentId: c.id })).status,
    ).toBe(404);
    expect(
      (await send('post', bob, `/posts/${p1.id}/comments`, { body: 'y', parentId: 'a'.repeat(24) }))
        .status,
    ).toBe(404);
  });

  it('only the author edits or deletes a comment (even the post owner cannot edit)', async () => {
    const p = await post(alice, { body: 'host' });
    const c = (await send('post', bob, `/posts/${p.id}/comments`, { body: 'mine' })).body.comment;
    expect(
      (await send('patch', alice, `/comments/${c.id}`, { body: 'edited by host' })).status,
    ).toBe(404);
    expect(
      (await send('patch', carol, `/comments/${c.id}`, { body: 'edited by other' })).status,
    ).toBe(404);
    expect((await send('delete', carol, `/comments/${c.id}`)).status).toBe(404);
    const ok = await send('patch', bob, `/comments/${c.id}`, { body: 'fixed' });
    expect(ok.body.comment).toMatchObject({ body: 'fixed' });
    expect(ok.body.comment.editedAt).toBeTruthy();
    expect((await send('delete', bob, `/comments/${c.id}`)).status).toBe(204);
    expect((await Post.findById(p.id))?.commentCount).toBe(0);
    expect((await send('delete', bob, `/comments/${c.id}`)).status).toBe(404);
    expect((await Post.findById(p.id))?.commentCount).toBe(0); // no double decrement
  });

  it('a deleted comment with replies stays as a placeholder without its text', async () => {
    const p = await post(alice, { body: 'thread' });
    const c = (await send('post', bob, `/posts/${p.id}/comments`, { body: 'secret text' })).body
      .comment;
    await send('post', carol, `/posts/${p.id}/comments`, { body: 'reply', parentId: c.id });
    await send('delete', bob, `/comments/${c.id}`);
    const list = await get(alice, `/posts/${p.id}/comments`);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ status: 'deleted', body: '' });
    expect(JSON.stringify(list.body)).not.toContain('secret text');
  });

  it('comments can be liked once per user', async () => {
    const p = await post(alice, { body: 'c-like' });
    const c = (await send('post', bob, `/posts/${p.id}/comments`, { body: 'nice' })).body.comment;
    await Promise.all([1, 2, 3].map(() => send('post', carol, `/comments/${c.id}/reactions`)));
    expect(await Reaction.countDocuments({ targetType: 'comment', targetId: c.id })).toBe(1);
    expect((await get(carol, `/posts/${p.id}/comments`)).body.items[0]).toMatchObject({
      reactionCount: 1,
      viewer: { reacted: true },
    });
    expect((await send('delete', carol, `/comments/${c.id}/reactions`)).body).toEqual({
      reacted: false,
      reactionCount: 0,
    });
  });

  it("comments on someone else's private post are unreachable by id too", async () => {
    const p = await post(alice, { body: 'private thread', visibility: 'private' });
    const c = (await send('post', alice, `/posts/${p.id}/comments`, { body: 'note to self' })).body
      .comment;
    expect((await send('post', bob, `/comments/${c.id}/reactions`)).status).toBe(404);
    expect((await send('post', bob, `/comments/${c.id}/reports`, { reason: 'spam' })).status).toBe(
      404,
    );
  });
});

describe('follows and profiles', () => {
  it('follow is idempotent; counts are exact; unfollow works', async () => {
    const a = await createUser(h.app);
    const b = await createUser(h.app);
    const c = await createUser(h.app);
    const r = await Promise.all([1, 2, 3, 4, 5].map(() => follow(a, b)));
    expect(r.every((x) => x.status === 200)).toBe(true);
    expect(await Follow.countDocuments({ followerId: a.id, followeeId: b.id })).toBe(1);
    await follow(c, b);
    expect((await follow(c, b)).body).toEqual({ following: true, followerCount: 2 });
    const profile = await get(a, `/users/${b.id}/profile`);
    expect(profile.body).toMatchObject({
      id: b.id,
      followerCount: 2,
      followingCount: 0,
      isFollowing: true,
      isSelf: false,
    });
    expect((await send('delete', a, `/users/${b.id}/follow`)).body).toEqual({
      following: false,
      followerCount: 1,
    });
    expect((await send('delete', a, `/users/${b.id}/follow`)).body).toEqual({
      following: false,
      followerCount: 1,
    });
  });

  it('cannot follow yourself, unknown users or suspended users', async () => {
    const a = await createUser(h.app);
    const b = await createUser(h.app);
    expect((await follow(a, a)).status).toBe(400);
    expect((await send('post', a, `/users/${'b'.repeat(24)}/follow`)).status).toBe(404);
    expect((await send('post', a, '/users/not-an-id/follow')).status).toBe(404);
    await User.updateOne({ _id: b.id }, { $set: { status: 'suspended' } });
    expect((await follow(a, b)).status).toBe(404);
    expect((await get(a, `/users/${b.id}/profile`)).status).toBe(404);
  });

  it('a profile exposes only public data and counts only public posts', async () => {
    const a = await createUser(h.app);
    const viewer = await createUser(h.app);
    await post(a, { body: 'pub' });
    await post(a, { body: 'priv', visibility: 'private' });
    await post(a, { body: 'fol', visibility: 'followers' });
    const res = await get(viewer, `/users/${a.id}/profile`);
    expect(res.body.postCount).toBe(1);
    expect(Object.keys(res.body).sort()).toEqual([
      'avatarUrl',
      'displayName',
      'followerCount',
      'followingCount',
      'id',
      'isFollowing',
      'isSelf',
      'joinedAt',
      'postCount',
      'videoCount',
    ]);
  });

  it('the existing admin user routes still guard /users/:id', async () => {
    expect((await get(bob, `/users/${alice.id}`)).status).toBe(403);
  });
});

describe('reporting and moderation', () => {
  it('a member can report visible content once; own content and duplicates are refused', async () => {
    const p = await post(alice, { body: 'spammy' });
    expect(
      (await send('post', bob, `/posts/${p.id}/reports`, { reason: 'spam', details: 'ads' }))
        .status,
    ).toBe(201);
    expect((await send('post', bob, `/posts/${p.id}/reports`, { reason: 'abuse' })).status).toBe(
      409,
    );
    expect((await send('post', alice, `/posts/${p.id}/reports`, { reason: 'spam' })).status).toBe(
      409,
    );
    expect((await send('post', bob, `/posts/${p.id}/reports`, { reason: 'because' })).status).toBe(
      400,
    );
    expect((await send('post', bob, `/posts/${p.id}/reports`, {})).status).toBe(400);
    expect(await ContentReport.countDocuments({ targetId: p.id })).toBe(1);
    // parallel duplicate reports still collapse into one
    const q = await post(alice, { body: 'spammy 2' });
    await Promise.all(
      [1, 2, 3, 4].map(() => send('post', carol, `/posts/${q.id}/reports`, { reason: 'spam' })),
    );
    expect(await ContentReport.countDocuments({ targetId: q.id, reporterId: carol.id })).toBe(1);
  });

  it('only moderators (with an MFA session) can read the queue', async () => {
    const noMfa = await createStaff(h.app, ['moderator'], { enrollMfa: false });
    for (const s of [alice, bob]) expect((await get(s, '/moderation/reports')).status).toBe(403);
    const res = await get(noMfa, '/moderation/reports');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MFA_REQUIRED');
    expect((await get(mod, '/moderation/reports')).status).toBe(200);
    // other staff roles without the permission
    const support = await createStaff(h.app, ['support']);
    expect((await get(support, '/moderation/reports')).status).toBe(403);
    expect(
      (
        await send('post', alice, `/moderation/post/${'a'.repeat(24)}/status`, {
          status: 'hidden',
          reason: 'xxx',
        })
      ).status,
    ).toBe(403);
  });

  it('review queue shows reporter, reason, evidence snapshot and survives later edits/deletion', async () => {
    const author = await createUser(h.app);
    const p = await post(author, { body: 'original offensive text' });
    await send('post', bob, `/posts/${p.id}/reports`, { reason: 'abuse', details: 'rude' });
    await send('patch', author, `/posts/${p.id}`, { body: 'innocent text' });
    await send('delete', author, `/posts/${p.id}`);
    const list = await get(mod, '/moderation/reports?status=open&limit=50');
    const r = list.body.items.find((x: { targetId: string }) => x.targetId === p.id);
    expect(r).toMatchObject({
      reason: 'abuse',
      details: 'rude',
      status: 'open',
      reporter: { id: bob.id },
      snapshot: { body: 'original offensive text', author: { id: author.id } },
      targetStatus: 'deleted',
    });
    expect((await get(mod, `/moderation/reports/${r.id}`)).body.report.id).toBe(r.id);
    expect((await get(mod, `/moderation/reports/${'c'.repeat(24)}`)).status).toBe(404);
    expect((await get(mod, '/moderation/reports?status=bogus')).status).toBe(400);
  });

  it('hide: removes the post from others, tells the author, locks editing, keeps history, settles all reports', async () => {
    const author = await createUser(h.app);
    const p = await post(author, { body: 'bad post' });
    await send('post', bob, `/posts/${p.id}/reports`, { reason: 'abuse' });
    await send('post', carol, `/posts/${p.id}/reports`, { reason: 'spam' });
    const reports = (await get(mod, '/moderation/reports?limit=50')).body.items.filter(
      (x: { targetId: string }) => x.targetId === p.id,
    );
    expect(reports).toHaveLength(2);
    expect(reports[0].reportsOnTarget).toBe(2);

    const res = await send('post', mod, `/moderation/reports/${reports[0].id}/resolve`, {
      action: 'hide',
      note: 'violates rules',
    });
    expect(res.status).toBe(200);
    expect(res.body.report).toMatchObject({ status: 'actioned', targetStatus: 'hidden' });
    expect(await ContentReport.countDocuments({ targetId: p.id, status: 'open' })).toBe(0);

    expect((await get(bob, `/posts/${p.id}`)).status).toBe(404);
    expect((await get(bob, `/posts?authorId=${author.id}`)).body.items).toHaveLength(0);
    const own = await get(author, `/posts/${p.id}`);
    expect(own.body.post.status).toBe('hidden');
    expect(own.body.post.moderationNotice).toBeTruthy();
    expect(JSON.stringify(own.body)).not.toContain('violates rules'); // internal note is not shown to the author
    expect((await send('patch', author, `/posts/${p.id}`, { body: 'sneaky edit' })).status).toBe(
      409,
    );
    expect((await send('post', bob, `/posts/${p.id}/comments`, { body: 'x' })).status).toBe(404);

    const hist = await get(mod, `/moderation/post/${p.id}/history`);
    expect(hist.body.entries).toHaveLength(1);
    expect(hist.body.entries[0]).toMatchObject({
      action: 'hidden',
      reason: 'violates rules',
      by: mod.id,
    });

    // resolving again is a conflict
    expect(
      (
        await send('post', mod, `/moderation/reports/${reports[1].id}/resolve`, {
          action: 'dismiss',
        })
      ).status,
    ).toBe(409);

    // moderator restores after review
    const back = await send('post', mod, `/moderation/post/${p.id}/status`, {
      status: 'published',
      reason: 'appeal accepted',
    });
    expect(back.status).toBe(200);
    expect((await get(bob, `/posts/${p.id}`)).status).toBe(200);
    expect(
      (await get(mod, `/moderation/post/${p.id}/history`)).body.entries.map(
        (e: { action: string }) => e.action,
      ),
    ).toEqual(['hidden', 'restored']);
  });

  it('dismiss leaves the content visible; remove is permanent for viewers', async () => {
    const author = await createUser(h.app);
    const ok = await post(author, { body: 'fine' });
    const bad = await post(author, { body: 'awful' });
    await send('post', bob, `/posts/${ok.id}/reports`, { reason: 'other' });
    await send('post', bob, `/posts/${bad.id}/reports`, { reason: 'illegal' });
    const queue = (await get(mod, '/moderation/reports?limit=50')).body.items;
    const rOk = queue.find((x: { targetId: string }) => x.targetId === ok.id);
    const rBad = queue.find((x: { targetId: string }) => x.targetId === bad.id);
    const d = await send('post', mod, `/moderation/reports/${rOk.id}/resolve`, {
      action: 'dismiss',
      note: 'nothing wrong',
    });
    expect(d.body.report).toMatchObject({
      status: 'dismissed',
      targetStatus: 'published',
      resolution: { action: 'dismiss' },
    });
    expect((await get(carol, `/posts/${ok.id}`)).status).toBe(200);
    await send('post', mod, `/moderation/reports/${rBad.id}/resolve`, { action: 'remove' });
    expect((await get(carol, `/posts/${bad.id}`)).status).toBe(404);
    expect((await Post.findById(bad.id))?.status).toBe('removed');
    // resolved reports are listed under their status
    expect(
      (await get(mod, '/moderation/reports?status=dismissed&limit=50')).body.items.some(
        (x: { id: string }) => x.id === rOk.id,
      ),
    ).toBe(true);
  });

  it('comments can be reported, hidden (counts adjusted) and restored', async () => {
    const p = await post(alice, { body: 'host' });
    const c = (await send('post', bob, `/posts/${p.id}/comments`, { body: 'rude comment' })).body
      .comment;
    expect((await Post.findById(p.id))?.commentCount).toBe(1);
    await send('post', carol, `/comments/${c.id}/reports`, { reason: 'abuse' });
    const r = (await get(mod, '/moderation/reports?limit=50')).body.items.find(
      (x: { targetId: string }) => x.targetId === c.id,
    );
    expect(r).toMatchObject({ targetType: 'comment', postId: p.id });
    await send('post', mod, `/moderation/reports/${r.id}/resolve`, { action: 'hide' });
    expect((await Post.findById(p.id))?.commentCount).toBe(0);
    expect((await get(carol, `/posts/${p.id}/comments`)).body.items).toHaveLength(0);
    expect((await send('patch', bob, `/comments/${c.id}`, { body: 'edit' })).status).toBe(409);
    // hiding again must not decrement twice
    await send('post', mod, `/moderation/comment/${c.id}/status`, {
      status: 'removed',
      reason: 'worse',
    });
    expect((await Post.findById(p.id))?.commentCount).toBe(0);
    await send('post', mod, `/moderation/comment/${c.id}/status`, {
      status: 'published',
      reason: 'ok fine',
    });
    expect((await Post.findById(p.id))?.commentCount).toBe(1);
    expect((await get(carol, `/posts/${p.id}/comments`)).body.items).toHaveLength(1);
  });

  it('moderators cannot resurrect author-deleted content, nor moderate their own or foreign ids sloppily', async () => {
    const author = await createUser(h.app);
    const p = await post(author, { body: 'gone' });
    await send('delete', author, `/posts/${p.id}`);
    expect(
      (
        await send('post', mod, `/moderation/post/${p.id}/status`, {
          status: 'published',
          reason: 'restore',
        })
      ).status,
    ).toBe(409);
    expect((await Post.findById(p.id))?.status).toBe('deleted');
    expect(
      (
        await send('post', mod, `/moderation/post/${'d'.repeat(24)}/status`, {
          status: 'hidden',
          reason: 'xxx',
        })
      ).status,
    ).toBe(404);
    expect(
      (await send('post', mod, `/moderation/post/${p.id}/status`, { status: 'hidden' })).status,
    ).toBe(400);
    expect(
      (
        await send('post', mod, `/moderation/thing/${p.id}/status`, {
          status: 'hidden',
          reason: 'xx',
        })
      ).status,
    ).toBe(400);
    // a moderator's own post
    const own = await send('post', mod, '/posts', { body: 'mod post' });
    expect(
      (
        await send('post', mod, `/moderation/post/${own.body.post.id}/status`, {
          status: 'hidden',
          reason: 'self',
        })
      ).status,
    ).toBe(403);
  });

  it('an author who deleted a moderated post cannot restore it, and reports on deleted content can still be closed', async () => {
    const author = await createUser(h.app);
    const p = await post(author, { body: 'del after report' });
    await send('post', bob, `/posts/${p.id}/reports`, { reason: 'spam' });
    await send('delete', author, `/posts/${p.id}`);
    const r = (await get(mod, '/moderation/reports?limit=50')).body.items.find(
      (x: { targetId: string }) => x.targetId === p.id,
    );
    const res = await send('post', mod, `/moderation/reports/${r.id}/resolve`, {
      action: 'remove',
    });
    expect(res.status).toBe(200);
    expect(res.body.report.status).toBe('actioned');
    expect((await Post.findById(p.id))?.status).toBe('deleted');
  });

  it('content moderation and reports are written to the audit log without content bodies', async () => {
    const author = await createUser(h.app);
    const p = await post(author, { body: 'audit me secret-body-xyz' });
    await send('post', bob, `/posts/${p.id}/reports`, { reason: 'spam' });
    await send('post', mod, `/moderation/post/${p.id}/status`, {
      status: 'hidden',
      reason: 'audit reason',
    });
    const logs = await AuditLog.find({ targetId: p.id });
    const actions = logs.map((l) => l.action).sort();
    expect(actions).toEqual(['content.reported', 'moderation.hidden', 'post.created']);
    expect(JSON.stringify(logs)).not.toContain('secret-body-xyz');
    expect(String(logs.find((l) => l.action === 'moderation.hidden')?.actorId)).toBe(mod.id);
  });

  it('a hidden post cannot be liked and cannot receive new reports', async () => {
    const author = await createUser(h.app);
    const p = await post(author, { body: 'to hide' });
    await send('post', mod, `/moderation/post/${p.id}/status`, {
      status: 'hidden',
      reason: 'because',
    });
    expect((await send('post', bob, `/posts/${p.id}/reactions`)).status).toBe(404);
    expect((await send('post', bob, `/posts/${p.id}/reports`, { reason: 'spam' })).status).toBe(
      404,
    );
  });
});
