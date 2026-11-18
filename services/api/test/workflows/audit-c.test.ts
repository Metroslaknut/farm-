/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiEnv } from '@farmplus/config/server';
import {
  AuditLog,
  Comment,
  ContentReport,
  Follow,
  LiveSession,
  Media,
  Post,
  Reaction,
  User,
} from '../../src/models';
import {
  createFarmer,
  createStaff,
  createUser,
  setupFarm,
  startHarness,
  type Session,
  type Staff,
  type TestHarness,
} from '../helpers';
import {
  API,
  TestProvider,
  assetEvent,
  pathOf,
  postWebhook,
  readyVideo,
  requestTicket,
  sendFile,
} from '../video-helpers';

/**
 * Audit C: community posts / reactions / follows / feed, video upload + visibility, live host authorization and
 * reporting/moderation. API (supertest) → service → database (Mongoose), synthetic data and mock providers only.
 */
class RecordingProvider extends TestProvider {
  createdInputs: string[] = [];
  constructor(env: ApiEnv) {
    super(env);
  }
  override async createLiveInput(...a: Parameters<TestProvider['createLiveInput']>) {
    const r = await super.createLiveInput(...a);
    this.createdInputs.push(r.providerInputId);
    return r;
  }
}

let h: TestHarness;
let p: RecordingProvider;
let mod: Staff;
let mod2: Staff;

beforeAll(async () => {
  h = await startHarness(
    { MEDIA_ALLOWED_HOSTS: 'cdn.example.test' },
    { video: (env) => (p = new RecordingProvider(env)) },
  );
  mod = await createStaff(h.app, ['moderator']);
  mod2 = await createStaff(h.app, ['moderator']);
});
afterAll(() => h.stop());

const get = (s: Session, path: string) => request(h.app).get(`${API}${path}`).set(s.auth);
const send = (m: 'post' | 'patch' | 'delete', s: Session, path: string, body?: object) =>
  request(h.app)[m](`${API}${path}`).set(s.auth).send(body);
const mkPost = async (s: Session, body: object = {}) => {
  const res = await send('post', s, '/posts', { body: 'hello farm', ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.post.id as string;
};
const follow = (s: Session, t: Session) => send('post', s, `/users/${t.id}/follow`);
const comment = async (s: Session, postId: string, body = 'nice', parentId?: string) => {
  const res = await send('post', s, `/posts/${postId}/comments`, {
    body,
    ...(parentId ? { parentId } : {}),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.comment.id as string;
};
const setStatus = (who: Session, type: string, id: string, status: string) =>
  send('post', who, `/moderation/${type}/${id}/status`, { status, reason: 'audit review' });
const profile = async (viewer: Session, user: Session) =>
  (await get(viewer, `/users/${user.id}/profile`)).body;
const audits = (action: string, targetId: string) =>
  AuditLog.countDocuments({ action, targetId: String(targetId) });
const publishedComments = (postId: string) =>
  Comment.countDocuments({ postId, status: 'published', targetType: { $ne: 'video' } });

async function walk(viewer: Session, query: string, limit: number) {
  const ids: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const res = await get(
      viewer,
      `/posts?${query}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(limit);
    ids.push(...res.body.items.map((i: any) => i.id));
    cursor = res.body.nextCursor;
    pages++;
    if (pages > 200) throw new Error('cursor loop');
  } while (cursor);
  return { ids, pages };
}

// ---------------------------------------------------------------------------
describe('C1 posts create/update/delete', () => {
  it('C1-01 only the author edits; others (incl. moderators) get 404 and nothing changes', async () => {
    const [alice, bob] = [await createUser(h.app), await createUser(h.app)];
    const id = await mkPost(alice, { body: 'original' });
    expect((await send('patch', bob, `/posts/${id}`, { body: 'hijack' })).status).toBe(404);
    expect((await send('patch', mod, `/posts/${id}`, { body: 'mod edit' })).status).toBe(404);
    expect((await send('patch', bob, `/posts/${id}`, { visibility: 'private' })).status).toBe(404);
    let doc = (await Post.findById(id))!;
    expect(doc.body).toBe('original');
    expect(doc.visibility).toBe('public');
    expect(doc.edits).toHaveLength(0);
    expect(doc.editedAt ?? null).toBeNull();

    const ok = await send('patch', alice, `/posts/${id}`, { body: 'edited' });
    expect(ok.status).toBe(200);
    doc = (await Post.findById(id))!;
    expect(doc.body).toBe('edited');
    expect(doc.edits.map((e) => e.body)).toEqual(['original']);
    expect(doc.editedAt).toBeInstanceOf(Date);
    expect(await audits('post.updated', id)).toBe(1);
  });

  it('C1-02 soft-deleted post disappears from detail, feeds, comments and profile counts', async () => {
    const [alice, bob] = [await createUser(h.app), await createUser(h.app)];
    const keep = await mkPost(alice, { body: 'keep me' });
    const id = await mkPost(alice, { body: 'delete me' });
    await comment(bob, id, 'first!');
    await send('post', bob, `/posts/${id}/reactions`);
    expect((await profile(bob, alice)).postCount).toBe(2);

    expect((await send('delete', bob, `/posts/${id}`)).status).toBe(404);
    expect((await send('delete', mod, `/posts/${id}`)).status).toBe(404);
    expect((await Post.findById(id))!.status).toBe('published');

    expect((await send('delete', alice, `/posts/${id}`)).status).toBe(204);
    const doc = (await Post.findById(id))!;
    expect(doc.status).toBe('deleted');
    expect(doc.deletedAt).toBeInstanceOf(Date);
    expect(doc.moderation.at(-1)).toMatchObject({ action: 'author_deleted', to: 'deleted' });

    for (const s of [alice, bob]) {
      expect((await get(s, `/posts/${id}`)).status).toBe(404);
      expect((await get(s, `/posts/${id}/comments`)).status).toBe(404);
      const authorFeed = (await get(s, `/posts?authorId=${alice.id}&limit=50`)).body.items.map(
        (i: any) => i.id,
      );
      expect(authorFeed).toEqual([keep]);
      const all = (await walk(s, 'scope=all', 50)).ids;
      expect(all).not.toContain(id);
    }
    expect((await send('post', bob, `/posts/${id}/comments`, { body: 'late' })).status).toBe(404);
    expect((await send('post', bob, `/posts/${id}/reports`, { reason: 'spam' })).status).toBe(404);
    expect((await send('patch', alice, `/posts/${id}`, { body: 'zombie' })).status).toBe(404);
    expect((await send('delete', alice, `/posts/${id}`)).status).toBe(404);
    expect((await profile(bob, alice)).postCount).toBe(1);
    expect(await audits('post.deleted', id)).toBe(1);
  });

  it('C1-03 a moderated post is locked for edits (body and visibility); the author can still delete it', async () => {
    const alice = await createUser(h.app);
    const id = await mkPost(alice, { body: 'borderline' });
    expect((await setStatus(mod, 'post', id, 'hidden')).status).toBe(200);
    const e1 = await send('patch', alice, `/posts/${id}`, { body: 'sneaky' });
    expect(e1.status).toBe(409);
    expect(e1.body.error.code).toBe('CONTENT_LOCKED');
    const e2 = await send('patch', alice, `/posts/${id}`, { visibility: 'private' });
    expect(e2.status).toBe(409);
    let doc = (await Post.findById(id))!;
    expect(doc.body).toBe('borderline');
    expect(doc.visibility).toBe('public');
    expect(doc.edits).toHaveLength(0);

    expect((await send('delete', alice, `/posts/${id}`)).status).toBe(204);
    const back = await setStatus(mod, 'post', id, 'published');
    expect(back.status).toBe(409);
    expect(back.body.error.code).toBe('ALREADY_DELETED');
    doc = (await Post.findById(id))!;
    expect(doc.status).toBe('deleted');
  });

  it('C1-04 a commenter cannot edit their comment after the post was deleted by its author', async () => {
    const [alice, bob] = [await createUser(h.app), await createUser(h.app)];
    const id = await mkPost(alice);
    const c = await comment(bob, id, 'polite comment');
    expect((await send('delete', alice, `/posts/${id}`)).status).toBe(204);
    const res = await send('patch', bob, `/comments/${c}`, { body: 'rewritten after deletion' });
    expect([404, 409], `status ${res.status}`).toContain(res.status);
    expect((await Comment.findById(c))!.body).toBe('polite comment');
  });
});

// ---------------------------------------------------------------------------
describe('C2 reactions, comments and follows', () => {
  it('C2-01 10 concurrent likes by one user → one Reaction row, reactionCount 1', async () => {
    const [alice, bob] = [await createUser(h.app), await createUser(h.app)];
    const id = await mkPost(alice);
    const rs = await Promise.all(
      Array.from({ length: 10 }, () => send('post', bob, `/posts/${id}/reactions`)),
    );
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(await Reaction.countDocuments({ targetType: 'post', targetId: id })).toBe(1);
    const doc = (await Post.findById(id))!;
    expect(doc.reactionCount).toBe(1);
    expect(doc.engagement).toBe(1);
  });

  it('C2-02 mixed concurrent like/unlike by many users keeps reactionCount == Reaction rows', async () => {
    const alice = await createUser(h.app);
    const users = await Promise.all(Array.from({ length: 8 }, () => createUser(h.app)));
    const id = await mkPost(alice);
    await Promise.all(users.map((u) => send('post', u, `/posts/${id}/reactions`)));
    expect((await Post.findById(id))!.reactionCount).toBe(8);
    // interleaved: half unlike (twice each), half like again, all at once
    await Promise.all(
      users.flatMap((u, i) =>
        i % 2 === 0
          ? [
              send('delete', u, `/posts/${id}/reactions`),
              send('delete', u, `/posts/${id}/reactions`),
            ]
          : [
              send('post', u, `/posts/${id}/reactions`),
              send('delete', u, `/posts/${id}/reactions`),
            ],
      ),
    );
    const rows = await Reaction.countDocuments({ targetType: 'post', targetId: id });
    const doc = (await Post.findById(id))!;
    expect(doc.reactionCount).toBe(rows);
    expect(doc.engagement).toBe(rows + 2 * doc.commentCount);
    expect(doc.reactionCount).toBeGreaterThanOrEqual(0);
  });

  it('C2-03 commentCount always equals the published (visible) comments after delete/hide/restore', async () => {
    const [alice, bob, carol] = [
      await createUser(h.app),
      await createUser(h.app),
      await createUser(h.app),
    ];
    const id = await mkPost(alice);
    const c1 = await comment(bob, id, 'c1');
    const c2 = await comment(carol, id, 'c2');
    await comment(bob, id, 'c3');
    const r1 = await comment(carol, id, 'r1', c1);
    await comment(alice, id, 'r2', r1); // reply-to-reply flattened to c1
    const check = async (expected: number) => {
      const doc = (await Post.findById(id))!;
      expect(doc.commentCount).toBe(expected);
      expect(await publishedComments(id)).toBe(expected);
      expect(doc.engagement).toBe(doc.reactionCount + 2 * expected);
    };
    await check(5);
    expect((await Comment.findById(c1))!.replyCount).toBe(2);

    expect((await send('delete', carol, `/comments/${c2}`)).status).toBe(204);
    await check(4);
    expect((await setStatus(mod, 'comment', r1, 'hidden')).status).toBe(200);
    await check(3);
    expect((await Comment.findById(c1))!.replyCount).toBe(1);
    // hiding again is not a second decrement
    expect((await setStatus(mod, 'comment', r1, 'hidden')).body.changed).toBe(false);
    await check(3);
    // the author deletes the hidden comment: no double decrement; then restore is refused
    expect((await send('delete', carol, `/comments/${r1}`)).status).toBe(204);
    await check(3);
    expect((await setStatus(mod, 'comment', r1, 'published')).status).toBe(409);
    await check(3);
    // visible list for another member matches
    const top = (await get(carol, `/posts/${id}/comments?limit=50`)).body.items;
    const replies = (await get(carol, `/posts/${id}/comments?parentId=${c1}&limit=50`)).body.items;
    const visible = [...top, ...replies].filter((x: any) => x.status === 'published');
    expect(visible).toHaveLength(3);
  });

  it('C2-04 follow/unfollow is idempotent, counts equal Follow rows, self/suspended refused', async () => {
    const [a, b, s] = [await createUser(h.app), await createUser(h.app), await createUser(h.app)];
    const rs = await Promise.all(Array.from({ length: 10 }, () => follow(a, b)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(await Follow.countDocuments({ followerId: a.id, followeeId: b.id })).toBe(1);
    expect(await audits('user.followed', b.id)).toBe(1);
    const pb = await profile(a, b);
    expect(pb.followerCount).toBe(await Follow.countDocuments({ followeeId: b.id }));
    expect(pb.isFollowing).toBe(true);
    expect((await profile(b, a)).followingCount).toBe(
      await Follow.countDocuments({ followerId: a.id }),
    );

    const self = await follow(a, a);
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('CANNOT_FOLLOW_SELF');
    expect(await Follow.countDocuments({ followerId: a.id, followeeId: a.id })).toBe(0);

    const un = await Promise.all(
      Array.from({ length: 5 }, () => send('delete', a, `/users/${b.id}/follow`)),
    );
    expect(un.every((r) => r.status === 200 && r.body.following === false)).toBe(true);
    expect(await Follow.countDocuments({ followerId: a.id, followeeId: b.id })).toBe(0);
    expect(await audits('user.unfollowed', b.id)).toBe(1);
    expect((await profile(a, b)).followerCount).toBe(0);

    // following a suspended user is refused; an existing follow can still be undone
    expect((await follow(a, s)).status).toBe(200);
    await User.updateOne({ _id: s.id }, { $set: { status: 'suspended' } });
    expect((await follow(b, s)).status).toBe(404);
    expect(await Follow.countDocuments({ followerId: b.id, followeeId: s.id })).toBe(0);
    const u2 = await send('delete', a, `/users/${s.id}/follow`);
    expect(u2.status).toBe(200);
    expect(await Follow.countDocuments({ followeeId: s.id })).toBe(0);
  });

  it('C2-05 comments under a hidden post cannot be liked (even by the post author)', async () => {
    const [alice, bob] = [await createUser(h.app), await createUser(h.app)];
    const id = await mkPost(alice);
    const c = await comment(bob, id, 'under review');
    expect((await setStatus(mod, 'post', id, 'hidden')).status).toBe(200);
    // bob can no longer see the post → 404
    expect((await send('post', bob, `/comments/${c}/reactions`)).status).toBe(404);
    // the post author still sees the hidden post, but its thread is locked
    const res = await send('post', alice, `/comments/${c}/reactions`);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect((await Comment.findById(c))!.reactionCount).toBe(0);
    expect(await Reaction.countDocuments({ targetType: 'comment', targetId: c })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('C3 feed pagination and sorting', () => {
  let author: Session;
  let follower: Session;
  let stranger: Session;
  const pub: string[] = [];
  let followersOnly: string[] = [];
  let priv: string[] = [];
  let hidden = '';
  let deleted = '';

  beforeAll(async () => {
    [author, follower, stranger] = [
      await createUser(h.app),
      await createUser(h.app),
      await createUser(h.app),
    ];
    await follow(follower, author);
    for (let i = 0; i < 25; i++) pub.push(await mkPost(author, { body: `public ${i}` }));
    followersOnly = [
      await mkPost(author, { body: 'f1', visibility: 'followers' }),
      await mkPost(author, { body: 'f2', visibility: 'followers' }),
    ];
    priv = [
      await mkPost(author, { body: 'p1', visibility: 'private' }),
      await mkPost(author, { body: 'p2', visibility: 'private' }),
    ];
    hidden = await mkPost(author, { body: 'hidden' });
    deleted = await mkPost(author, { body: 'deleted' });
    await setStatus(mod, 'post', hidden, 'hidden');
    await send('delete', author, `/posts/${deleted}`);
    // 12 posts (spanning page boundaries and visibilities) share the exact same timestamp
    const same = new Date(Date.now() - 3_600_000);
    await Post.collection.updateMany(
      {
        _id: {
          $in: [...pub.slice(5, 15), followersOnly[0], priv[0]].map((x) => new Types.ObjectId(x)),
        },
      },
      { $set: { createdAt: same } },
    );
  });

  const expectedOrder = async (ids: string[]) => {
    const docs = await Post.find({ _id: { $in: ids } }).sort({ createdAt: -1, _id: -1 });
    return docs.map((d) => String(d._id));
  };

  it('C3-01 stranger walks the author feed: all public, no dups/gaps, stable order with tied timestamps', async () => {
    const { ids, pages } = await walk(stranger, `authorId=${author.id}`, 7);
    expect(pages).toBe(4);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set(pub));
    expect(ids).toEqual(await expectedOrder(pub));
  });

  it('C3-02 follower sees public+followers; author sees everything but deleted (incl. hidden/private)', async () => {
    const f = (await walk(follower, `authorId=${author.id}`, 6)).ids;
    expect(new Set(f).size).toBe(f.length);
    expect(new Set(f)).toEqual(new Set([...pub, ...followersOnly]));
    expect(f).toEqual(await expectedOrder([...pub, ...followersOnly]));
    const own = (await walk(author, `authorId=${author.id}`, 5)).ids;
    expect(new Set(own)).toEqual(new Set([...pub, ...followersOnly, ...priv, hidden]));
    expect(own).not.toContain(deleted);
  });

  it('C3-03 the global feed excludes hidden/deleted/private/followers-only for a stranger', async () => {
    const { ids } = await walk(stranger, 'scope=all', 9);
    expect(new Set(ids).size).toBe(ids.length);
    for (const x of pub) expect(ids).toContain(x);
    for (const x of [...followersOnly, ...priv, hidden, deleted]) expect(ids).not.toContain(x);
    const fol = (await walk(follower, 'scope=following', 8)).ids;
    expect(new Set(fol)).toEqual(new Set([...pub, ...followersOnly]));
  });

  it('C3-04 trending with identical engagement pages by _id without dups or gaps', async () => {
    const { ids } = await walk(stranger, `authorId=${author.id}&sort=trending`, 4);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set(pub));
  });

  it('C3-05 limit bounds, forged cursors and unknown params are validated', async () => {
    for (const bad of ['0', '-1', '51', 'abc', '1.5'])
      expect((await get(stranger, `/posts?limit=${bad}`)).status, `limit=${bad}`).toBe(400);
    const max = await get(stranger, '/posts?limit=50');
    expect(max.status).toBe(200);
    expect(max.body.items.length).toBeLessThanOrEqual(50);
    expect((await get(stranger, `/posts?authorId=${author.id}`)).body.items).toHaveLength(20);
    const forged = Buffer.from(JSON.stringify({ k: 'x', id: 'zz' })).toString('base64url');
    expect((await get(stranger, `/posts?cursor=${forged}`)).status).toBe(400);
    expect((await get(stranger, '/posts?cursor=%%%')).status).toBe(400);
    expect((await get(stranger, '/posts?blocked=1')).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('C4 media upload validation', () => {
  it('C4-01 post media: http, foreign hosts, look-alike hosts and MIME mismatches are refused', async () => {
    const u = await createUser(h.app);
    const bad: object[] = [
      { kind: 'image', url: 'http://cdn.example.test/a.jpg' },
      { kind: 'image', url: 'https://evil.example.com/a.jpg' },
      { kind: 'image', url: 'https://evilcdn.example.test/a.jpg' },
      { kind: 'image', url: 'https://cdn.example.test.evil.com/a.jpg' },
      { kind: 'image', url: 'https://cdn.example.test@evil.com/a.jpg' },
      { kind: 'image', url: 'javascript:alert(1)' },
      { kind: 'image', url: 'https://cdn.example.test/a.mp4', mimeType: 'video/mp4' },
      { kind: 'video', url: 'https://cdn.example.test/a.jpg', mimeType: 'image/jpeg' },
    ];
    for (const m of bad) {
      const res = await send('post', u, '/posts', { body: 'x', media: [m] });
      expect(res.status, JSON.stringify(m)).toBe(400);
    }
    const dup = { kind: 'image', url: 'https://cdn.example.test/same.jpg' };
    expect((await send('post', u, '/posts', { body: 'x', media: [dup, dup] })).status).toBe(400);
    expect(await Post.countDocuments({ authorId: u.id })).toBe(0);
    const ok = await send('post', u, '/posts', {
      body: 'x',
      media: [
        { kind: 'image', url: 'https://cdn.example.test/ok.jpg', mimeType: 'image/jpeg' },
        { kind: 'video', url: 'https://img.cdn.example.test/ok.mp4', mimeType: 'video/mp4' },
      ],
    });
    expect(ok.status).toBe(201);
    // editing to a bad link is refused and the stored media stay as they were
    const edit = await send('patch', u, `/posts/${ok.body.post.id}`, {
      media: [{ kind: 'image', url: 'http://cdn.example.test/x.jpg' }],
    });
    expect(edit.status).toBe(400);
    expect((await Post.findById(ok.body.post.id))!.media.map((m) => m.url)).toEqual([
      'https://cdn.example.test/ok.jpg',
      'https://img.cdn.example.test/ok.mp4',
    ]);
  });

  it('C4-02 video tickets: wrong MIME, extension mismatch, oversize, empty and path names are refused, nothing stored', async () => {
    const u = await createUser(h.app);
    const cases: [object, number][] = [
      [{ mimeType: 'image/png', filename: 'a.png' }, 400],
      [{ mimeType: 'video/x-msvideo', filename: 'a.avi' }, 400],
      [{ mimeType: 'video/mp4', filename: 'a.mov' }, 400],
      [{ sizeBytes: 5 * 1024 * 1024 + 1 }, 413],
      [{ sizeBytes: 0 }, 400],
      [{ filename: '../../etc/a.mp4' }, 400],
      [{ status: 'published' }, 400],
    ];
    for (const [over, status] of cases) {
      const res = await send('post', u, '/videos/uploads', {
        title: 't',
        filename: 'a.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 1000,
        ...over,
      });
      expect(res.status, JSON.stringify(over)).toBe(status);
    }
    expect(await Media.countDocuments({ ownerId: u.id })).toBe(0);
  });

  it('C4-03 a rejected upload (wrong type) can be retried on the same one-time URL; the URL is single-use', async () => {
    const u = await createUser(h.app);
    const t = await requestTicket(h.app, u);
    expect((await sendFile(h.app, t.upload.url, 'image/png')).status).toBe(415);
    expect((await Media.findById(t.video.id))!.processing.state).toBe('pending_upload');
    expect((await sendFile(h.app, t.upload.url)).status).toBe(201);
    expect((await Media.findById(t.video.id))!.processing.state).toBe('ready');
    expect((await sendFile(h.app, t.upload.url)).status).toBe(404);
    expect(await Media.countDocuments({ ownerId: u.id })).toBe(1);
  });

  it('C4-04 too-long video fails (asset deleted, not public); retry creates a new ready video, no orphan published', async () => {
    const u = await createUser(h.app);
    const viewer = await createUser(h.app);
    const t = await requestTicket(h.app, u);
    const up = await request(h.app)
      .post(pathOf(t.upload.url))
      .set('content-type', 'video/mp4')
      .set('x-duration', '120')
      .send(Buffer.from('long-video'));
    expect(up.status).toBe(201);
    const failed = (await Media.findById(t.video.id))!;
    expect(failed.processing.state).toBe('failed');
    expect(failed.processing.failureCode).toBe('too_long');
    expect(p.deleted).toContain(failed.providerAssetId);
    expect((await get(viewer, `/videos/${t.video.id}`)).status).toBe(404);
    expect((await get(u, `/videos/${t.video.id}/playback`)).status).toBe(409);
    // a late "ready" webhook cannot revive it
    await postWebhook(h.app, assetEvent(failed.providerAssetId!, { durationSeconds: 10 }));
    expect((await Media.findById(t.video.id))!.processing.state).toBe('failed');

    const again = await readyVideo(h.app, u);
    expect(again).not.toBe(t.video.id);
    const feed = (await get(viewer, `/videos?creatorId=${u.id}`)).body.items.map((v: any) => v.id);
    expect(feed).toEqual([again]);
    expect((await profile(viewer, u)).videoCount).toBe(1);
    const mine = (await get(u, '/videos?mine=true')).body.items;
    expect(mine.map((v: any) => v.processing.state).sort()).toEqual(['failed', 'ready']);
    expect(
      await Media.countDocuments({
        ownerId: u.id,
        status: 'published',
        'processing.state': 'ready',
      }),
    ).toBe(1);
  });

  it('C4-05 provider outage on ticket → failed record (not open, not public); retry succeeds', async () => {
    const u = await createUser(h.app);
    p.failUpload = true;
    const r = await send('post', u, '/videos/uploads', {
      title: 't',
      filename: 'a.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 1000,
    });
    p.failUpload = false;
    expect(r.status).toBe(502);
    const rows = await Media.find({ ownerId: u.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.processing.state).toBe('failed');
    expect(rows[0]!.processing.failureCode).toBe('provider_error');
    const id = await readyVideo(h.app, u);
    expect((await Media.findById(id))!.processing.state).toBe('ready');
    expect(
      await Media.countDocuments({ ownerId: u.id, 'processing.state': 'pending_upload' }),
    ).toBe(0);
  });

  it('C4-06 webhooks with a bad/missing/tampered signature are 401, audited, and change nothing; states stay monotonic', async () => {
    const u = await createUser(h.app);
    const t = await requestTicket(h.app, u);
    const asset = (await Media.findById(t.video.id))!.providerAssetId!;
    const before = await AuditLog.countDocuments({ action: 'webhook.rejected' });
    const ev = assetEvent(asset, { durationSeconds: 5, sizeBytes: 100 });
    expect((await postWebhook(h.app, ev, { secret: 'wrong-secret-wrong-secret-123' })).status).toBe(
      401,
    );
    expect((await postWebhook(h.app, ev, { header: null })).status).toBe(401);
    expect((await postWebhook(h.app, ev, { tamper: true })).status).toBe(401);
    expect(
      (await postWebhook(h.app, ev, { time: Math.floor(Date.now() / 1000) - 3600 })).status,
    ).toBe(401);
    expect(await AuditLog.countDocuments({ action: 'webhook.rejected' })).toBe(before + 4);
    expect((await Media.findById(t.video.id))!.processing.state).toBe('pending_upload');

    expect((await postWebhook(h.app, ev)).status).toBe(200);
    expect((await Media.findById(t.video.id))!.processing.state).toBe('ready');
    await postWebhook(h.app, assetEvent(asset, { state: 'processing' }));
    await postWebhook(h.app, assetEvent(asset, { state: 'failed' }));
    const doc = (await Media.findById(t.video.id))!;
    expect(doc.processing.state).toBe('ready');
    expect(doc.processing.failureCode ?? null).toBeNull();
  });

  it('C4-07 a provider-reported size above the limit fails the video even though the declared size was small', async () => {
    const u = await createUser(h.app);
    const t = await requestTicket(h.app, u, { sizeBytes: 1000 });
    const asset = (await Media.findById(t.video.id))!.providerAssetId!;
    await postWebhook(h.app, assetEvent(asset, { sizeBytes: 50 * 1024 * 1024 }));
    const doc = (await Media.findById(t.video.id))!;
    expect(doc.processing.state).toBe('failed');
    expect(p.deleted).toContain(asset);
  });
});

// ---------------------------------------------------------------------------
describe('C5 video visibility and access', () => {
  let creator: Session;
  let fan: Session;
  let stranger: Session;
  const v: Record<'public' | 'followers' | 'private', string> = {} as any;

  beforeAll(async () => {
    [creator, fan, stranger] = [
      await createUser(h.app),
      await createUser(h.app),
      await createUser(h.app),
    ];
    await follow(fan, creator);
    for (const vis of ['public', 'followers', 'private'] as const)
      v[vis] = await readyVideo(h.app, creator, { visibility: vis });
  });

  it('C5-01 detail + signed playback matrix: owner / follower / stranger / anonymous', async () => {
    const matrix: [Session, Record<string, number>][] = [
      [creator, { public: 200, followers: 200, private: 200 }],
      [fan, { public: 200, followers: 200, private: 404 }],
      [stranger, { public: 200, followers: 404, private: 404 }],
    ];
    for (const [who, exp] of matrix)
      for (const vis of ['public', 'followers', 'private'] as const) {
        const d = await get(who, `/videos/${v[vis]}`);
        const pb = await get(who, `/videos/${v[vis]}/playback`);
        expect(d.status, `${vis} detail`).toBe(exp[vis]);
        expect(pb.status, `${vis} playback`).toBe(exp[vis]);
        if (exp[vis] !== 200) expect(pb.body.url).toBeUndefined();
      }
    for (const vis of ['public', 'followers', 'private'] as const) {
      expect((await request(h.app).get(`${API}/videos/${v[vis]}`)).status).toBe(401);
      expect((await request(h.app).get(`${API}/videos/${v[vis]}/playback`)).status).toBe(401);
    }
    const ids = (who: Session) =>
      get(who, `/videos?creatorId=${creator.id}`).then((r) => r.body.items.map((x: any) => x.id));
    expect(new Set(await ids(creator))).toEqual(new Set(Object.values(v)));
    expect(new Set(await ids(fan))).toEqual(new Set([v.public, v.followers]));
    expect(await ids(stranger)).toEqual([v.public]);
  });

  it('C5-02 visibility change and unfollow revoke access immediately', async () => {
    const id = await readyVideo(h.app, creator, { visibility: 'public' });
    expect((await get(stranger, `/videos/${id}/playback`)).status).toBe(200);
    expect(
      (await send('patch', creator, `/videos/${id}`, { visibility: 'followers' })).status,
    ).toBe(200);
    expect((await get(stranger, `/videos/${id}/playback`)).status).toBe(404);
    const viewer = await createUser(h.app);
    await follow(viewer, creator);
    expect((await get(viewer, `/videos/${id}/playback`)).status).toBe(200);
    await send('delete', viewer, `/users/${creator.id}/follow`);
    expect((await get(viewer, `/videos/${id}/playback`)).status).toBe(404);
    expect((await send('patch', stranger, `/videos/${id}`, { visibility: 'public' })).status).toBe(
      404,
    );
    expect((await Media.findById(id))!.visibility).toBe('followers');
  });

  it('C5-03 a deleted video is gone for everyone, and an already-issued playback URL stops working', async () => {
    const id = await readyVideo(h.app, creator);
    const issued = (await get(stranger, `/videos/${id}/playback`)).body.url;
    expect((await request(h.app).get(pathOf(issued))).status).toBe(200);
    expect((await send('delete', stranger, `/videos/${id}`)).status).toBe(404);
    expect((await send('delete', creator, `/videos/${id}`)).status).toBe(204);
    const doc = (await Media.findById(id))!;
    expect(doc.status).toBe('deleted');
    expect(doc.providerDeletedAt).toBeInstanceOf(Date);
    for (const who of [creator, fan, stranger]) {
      expect((await get(who, `/videos/${id}`)).status).toBe(404);
      expect((await get(who, `/videos/${id}/playback`)).status).toBe(404);
    }
    expect((await request(h.app).get(pathOf(issued))).status).toBe(404);
  });

  it('C5-04 a hidden video refuses playback, likes and comments for others', async () => {
    const id = await readyVideo(h.app, creator);
    expect((await setStatus(mod, 'video', id, 'hidden')).status).toBe(200);
    expect((await Media.findById(id))!.status).toBe('hidden');
    for (const who of [fan, stranger]) {
      expect((await get(who, `/videos/${id}`)).status).toBe(404);
      expect((await get(who, `/videos/${id}/playback`)).status).toBe(404);
      expect((await send('post', who, `/videos/${id}/reactions`)).status).toBe(404);
      expect((await send('post', who, `/videos/${id}/comments`, { body: 'x' })).status).toBe(404);
    }
    expect(await Reaction.countDocuments({ targetType: 'video', targetId: id })).toBe(0);
    expect(await Comment.countDocuments({ postId: id })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('C6 live-session host authorization', () => {
  const goLive = async (s: Session, body: object = {}) => {
    const res = await send('post', s, '/live', { title: 'Morning milking', ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.live.id as string;
  };
  const inputOf = async (id: string) => (await LiveSession.findById(id))!.providerInputId;
  const connected = (input: string) =>
    postWebhook(h.app, { type: 'live.connected', providerInputId: input });

  it('C6-01 plain members cannot host; strangers, viewers and the host farm manager cannot end or read the key', async () => {
    const plain = await createUser(h.app);
    const r = await send('post', plain, '/live', { title: 'x' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('LIVE_HOST_REQUIRED');
    expect(await LiveSession.countDocuments({ hostId: plain.id })).toBe(0);

    const farm = await setupFarm(h.app);
    const id = await goLive(farm.owner);
    const input = await inputOf(id);
    await connected(input);
    const viewer = await createUser(h.app);
    expect((await get(viewer, `/live/${id}/playback`)).status).toBe(200);
    for (const who of [viewer, plain, farm.manager, farm.worker, mod]) {
      expect((await send('post', who, `/live/${id}/end`)).status).toBe(404);
      const ing = await send('post', who, `/live/${id}/ingest`);
      expect(ing.status).toBe(404);
      expect(JSON.stringify(ing.body)).not.toMatch(/streamKey/);
    }
    expect((await send('patch', farm.owner, `/live/${id}`, { title: 'new' })).status).toBe(404);
    const doc = (await LiveSession.findById(id))!;
    expect(doc.state).toBe('live');
    expect(doc.title).toBe('Morning milking');
    expect(await p.getLiveInput(input)).not.toBeNull();
    expect(await AuditLog.countDocuments({ action: 'live.ingest_viewed', targetId: id })).toBe(0);
  });

  it('C6-02 an ended session cannot be restarted by a late webhook, nor its key re-read; end is idempotent', async () => {
    const hostS = await createFarmer(h.app);
    const id = await goLive(hostS);
    const input = await inputOf(id);
    await connected(input);
    expect((await send('post', hostS, `/live/${id}/end`)).status).toBe(200);
    expect((await connected(input)).status).toBe(200);
    const doc = (await LiveSession.findById(id))!;
    expect(doc.state).toBe('ended');
    expect(doc.endReason).toBe('host');
    expect((await send('post', hostS, `/live/${id}/ingest`)).status).toBe(409);
    expect((await get(hostS, `/live/${id}/playback`)).status).toBe(409);
    expect(await p.getLiveInput(input)).toBeNull();
    expect((await send('post', hostS, `/live/${id}/end`)).status).toBe(200);
    expect(await audits('live.ended', id)).toBe(1);
  });

  it('C6-03 concurrent creates by one host: one session, no orphan provider inputs', async () => {
    const hostS = await createFarmer(h.app);
    const before = p.createdInputs.length;
    const rs = await Promise.all(
      Array.from({ length: 6 }, () => send('post', hostS, '/live', { title: 'race' })),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of rs.filter((x) => x.status !== 201)) {
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('LIVE_ALREADY_ACTIVE');
    }
    expect(await LiveSession.countDocuments({ hostId: hostS.id })).toBe(1);
    const winner = (await LiveSession.findOne({ hostId: hostS.id }))!.providerInputId;
    const created = p.createdInputs.slice(before);
    for (const inp of created) {
      if (inp === winner) expect(await p.getLiveInput(inp)).not.toBeNull();
      else expect(await p.getLiveInput(inp)).toBeNull();
    }
  });

  it('C6-04 concurrent end requests and an end/connect race leave the session ended exactly once', async () => {
    const hostS = await createFarmer(h.app);
    const id = await goLive(hostS);
    const input = await inputOf(id);
    const rs = await Promise.all([
      ...Array.from({ length: 5 }, () => send('post', hostS, `/live/${id}/end`)),
      connected(input),
      connected(input),
    ]);
    expect(rs.every((r) => r.status === 200)).toBe(true);
    const doc = (await LiveSession.findById(id))!;
    expect(doc.state).toBe('ended');
    expect(await audits('live.ended', id)).toBe(1);
    expect(p.liveDeleted.filter((x) => x === input)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('C7 reporting and moderation workflow', () => {
  it('C7-01 report → hide → restore: reports settled, audit rows written, counters and profile consistent', async () => {
    const [author, r1, r2] = [
      await createUser(h.app),
      await createUser(h.app),
      await createUser(h.app),
    ];
    const id = await mkPost(author, { body: 'SECRET-BODY offensive' });
    await comment(r1, id, 'c');
    await comment(r2, id, 'c');
    await send('post', r1, `/posts/${id}/reactions`);
    await send('post', r2, `/posts/${id}/reactions`);
    expect((await profile(r1, author)).postCount).toBe(1);

    expect((await send('post', r1, `/posts/${id}/reports`, { reason: 'abuse' })).status).toBe(201);
    const dup = await send('post', r1, `/posts/${id}/reports`, { reason: 'spam' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_REPORTED');
    expect((await send('post', r2, `/posts/${id}/reports`, { reason: 'spam' })).status).toBe(201);
    expect(await ContentReport.countDocuments({ targetId: id })).toBe(2);
    expect(await audits('content.reported', id)).toBe(2);

    const rep = (await ContentReport.findOne({ targetId: id, reporterId: r1.id }))!;
    const res = await send('post', mod, `/moderation/reports/${rep._id}/resolve`, {
      action: 'hide',
      note: 'rule 3',
    });
    expect(res.status).toBe(200);
    let doc = (await Post.findById(id))!;
    expect(doc.status).toBe('hidden');
    expect(await ContentReport.countDocuments({ targetId: id, status: 'actioned' })).toBe(2);
    expect(await ContentReport.countDocuments({ targetId: id, status: 'open' })).toBe(0);
    expect(doc.reactionCount).toBe(
      await Reaction.countDocuments({ targetType: 'post', targetId: id }),
    );
    expect(doc.commentCount).toBe(await publishedComments(id));
    expect(doc.commentCount).toBe(2);
    expect((await profile(r1, author)).postCount).toBe(0);
    expect(await audits('moderation.hidden', id)).toBe(1);
    expect(await audits('report.resolved', id)).toBe(1);

    const back = await setStatus(mod, 'post', id, 'published');
    expect(back.status).toBe(200);
    doc = (await Post.findById(id))!;
    expect(doc.status).toBe('published');
    expect(doc.reactionCount).toBe(2);
    expect(doc.commentCount).toBe(2);
    expect((await profile(r1, author)).postCount).toBe(1);
    expect(doc.moderation.map((m) => m.action)).toEqual(['hidden', 'restored']);
    expect(await audits('moderation.restored', id)).toBe(1);
    // audit metadata never contains the post text
    const rows = await AuditLog.find({ targetId: id });
    expect(JSON.stringify(rows)).not.toContain('SECRET-BODY');
    // only one OPEN report per reporter/target: after resolution the same member may report again
    expect((await send('post', r1, `/posts/${id}/reports`, { reason: 'abuse' })).status).toBe(201);
  });

  it('C7-02 a moderator cannot resolve their own report; another moderator can', async () => {
    const author = await createUser(h.app);
    const id = await mkPost(author);
    expect((await send('post', mod2, `/posts/${id}/reports`, { reason: 'spam' })).status).toBe(201);
    const rep = (await ContentReport.findOne({ targetId: id }))!;
    for (const action of ['dismiss', 'hide', 'remove']) {
      const r = await send('post', mod2, `/moderation/reports/${rep._id}/resolve`, { action });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('SELF_MODERATION');
    }
    expect((await ContentReport.findById(rep._id))!.status).toBe('open');
    expect((await Post.findById(id))!.status).toBe('published');
    expect(
      (await send('post', mod, `/moderation/reports/${rep._id}/resolve`, { action: 'dismiss' }))
        .status,
    ).toBe(200);
    const after = (await ContentReport.findById(rep._id))!;
    expect(after.status).toBe('dismissed');
    expect(String(after.resolvedBy)).toBe(mod.id);
    expect((await Post.findById(id))!.status).toBe('published');
  });

  it('C7-03 a moderator cannot moderate their own content; members cannot use moderation at all', async () => {
    const reporter = await createUser(h.app);
    const id = await mkPost(mod);
    expect((await send('post', reporter, `/posts/${id}/reports`, { reason: 'spam' })).status).toBe(
      201,
    );
    const rep = (await ContentReport.findOne({ targetId: id }))!;
    for (const action of ['dismiss', 'hide'])
      expect(
        (await send('post', mod, `/moderation/reports/${rep._id}/resolve`, { action })).status,
      ).toBe(403);
    expect((await setStatus(mod, 'post', id, 'hidden')).status).toBe(403);
    expect(
      (await send('post', reporter, `/moderation/reports/${rep._id}/resolve`, { action: 'hide' }))
        .status,
    ).toBe(403);
    expect((await setStatus(reporter, 'post', id, 'hidden')).status).toBe(403);
    expect((await ContentReport.findById(rep._id))!.status).toBe('open');
    expect((await Post.findById(id))!.status).toBe('published');
    expect(await AuditLog.countDocuments({ targetId: id, action: /^moderation\./ })).toBe(0);
  });

  it('C7-04 comment hide/restore keeps the post comment counter and engagement in step', async () => {
    const [author, c, rep] = [
      await createUser(h.app),
      await createUser(h.app),
      await createUser(h.app),
    ];
    const id = await mkPost(author);
    const cid = await comment(c, id, 'rude comment');
    await comment(rep, id, 'fine');
    expect((await send('post', rep, `/comments/${cid}/reports`, { reason: 'abuse' })).status).toBe(
      201,
    );
    const r = (await ContentReport.findOne({ targetId: cid }))!;
    expect(
      (await send('post', mod, `/moderation/reports/${r._id}/resolve`, { action: 'remove' }))
        .status,
    ).toBe(200);
    let doc = (await Post.findById(id))!;
    expect((await Comment.findById(cid))!.status).toBe('removed');
    expect(doc.commentCount).toBe(1);
    expect(doc.engagement).toBe(2);
    expect((await setStatus(mod, 'comment', cid, 'published')).status).toBe(200);
    doc = (await Post.findById(id))!;
    expect(doc.commentCount).toBe(2);
    expect(doc.engagement).toBe(4);
    expect(doc.commentCount).toBe(await publishedComments(id));
  });

  it('C7-05 two moderators resolving the same report at once: one wins, content moderated exactly once', async () => {
    const [author, reporter] = [await createUser(h.app), await createUser(h.app)];
    const id = await mkPost(author);
    await send('post', reporter, `/posts/${id}/reports`, { reason: 'spam' });
    const rep = (await ContentReport.findOne({ targetId: id }))!;
    const rs = await Promise.all([
      send('post', mod, `/moderation/reports/${rep._id}/resolve`, { action: 'hide' }),
      send('post', mod2, `/moderation/reports/${rep._id}/resolve`, { action: 'hide' }),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    const doc = (await Post.findById(id))!;
    expect(doc.status).toBe('hidden');
    expect(doc.moderation.filter((m) => m.action === 'hidden')).toHaveLength(1);
    expect(await audits('moderation.hidden', id)).toBe(1);
    expect(await audits('report.resolved', id)).toBe(1);
  });

  it('C7-06 dismissing one report leaves other open reports on the same content open', async () => {
    const [author, a, b] = [
      await createUser(h.app),
      await createUser(h.app),
      await createUser(h.app),
    ];
    const id = await mkPost(author);
    await send('post', a, `/posts/${id}/reports`, { reason: 'spam' });
    await send('post', b, `/posts/${id}/reports`, { reason: 'abuse' });
    const ra = (await ContentReport.findOne({ targetId: id, reporterId: a.id }))!;
    expect(
      (await send('post', mod, `/moderation/reports/${ra._id}/resolve`, { action: 'dismiss' }))
        .status,
    ).toBe(200);
    expect((await ContentReport.findById(ra._id))!.status).toBe('dismissed');
    expect(await ContentReport.countDocuments({ targetId: id, status: 'open' })).toBe(1);
    expect((await Post.findById(id))!.status).toBe('published');
  });
});
