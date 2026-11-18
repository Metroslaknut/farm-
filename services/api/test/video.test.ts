/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog, Media, VideoMetric } from '../src/models';
import { runMediaCleanup } from '../src/modules/media/cleanup.service';
import {
  createStaff,
  createUser,
  startHarness,
  type Session,
  type Staff,
  type TestHarness,
} from './helpers';
import {
  API,
  TestProvider,
  pathOf,
  assetEvent,
  postWebhook,
  readyVideo,
  requestTicket,
  sendFile,
  videoBody,
} from './video-helpers';

let h: TestHarness;
let p: TestProvider;
let alice: Session;
let bob: Session;
let carol: Session;
let mod: Staff;

beforeAll(async () => {
  h = await startHarness({}, { video: (env) => (p = new TestProvider(env)) });
  [alice, bob, carol] = [await createUser(h.app), await createUser(h.app), await createUser(h.app)];
  mod = await createStaff(h.app, ['moderator']);
});
afterAll(async () => {
  await h.stop();
});

const get = (s: Session, path: string) => request(h.app).get(`${API}${path}`).set(s.auth);
const send = (m: 'post' | 'patch' | 'delete', s: Session, path: string, body?: object) =>
  request(h.app)[m](`${API}${path}`).set(s.auth).send(body);
const follow = (s: Session, t: Session) => send('post', s, `/users/${t.id}/follow`);

describe('upload tickets: authorization, size, type', () => {
  it('requires authentication', async () => {
    expect((await request(h.app).post(`${API}/videos/uploads`).send(videoBody())).status).toBe(401);
    expect((await request(h.app).get(`${API}/videos`)).status).toBe(401);
    expect((await request(h.app).get(`${API}/videos/limits`)).status).toBe(401);
  });

  it('issues a one-time upload URL and a pending video owned by the caller', async () => {
    const t = await requestTicket(h.app, alice);
    expect(t.video.processing.state).toBe('pending_upload');
    expect(t.upload).toMatchObject({ method: 'POST', encoding: 'raw', maxBytes: 5 * 1024 * 1024 });
    expect(t.upload.url).toContain('/media/dev/uploads/');
    const doc = await Media.findById(t.video.id);
    expect(String(doc?.ownerId)).toBe(alice.id);
    expect(doc?.providerAssetId).toBeTruthy();
  });

  it('exposes the server limits', async () => {
    const res = await get(alice, '/videos/limits');
    expect(res.body).toMatchObject({
      maxUploadBytes: 5 * 1024 * 1024,
      maxDurationSeconds: 60,
      provider: 'mock',
    });
    expect(res.body.mimeTypes).toContain('video/mp4');
  });

  it.each([
    ['empty title', { title: ' ' }],
    ['unsupported type', { mimeType: 'application/pdf', filename: 'a.pdf' }],
    ['executable disguised as video', { mimeType: 'video/mp4', filename: 'a.exe' }],
    ['extension does not match type', { mimeType: 'video/webm', filename: 'a.mp4' }],
    ['path in filename', { filename: '../a.mp4' }],
    ['zero bytes', { sizeBytes: 0 }],
    ['fractional size', { sizeBytes: 10.5 }],
    ['negative size', { sizeBytes: -5 }],
    ['title too long', { title: 'x'.repeat(121) }],
    ['control chars', { title: 'a‮b' }],
    ['bad visibility', { visibility: 'friends' }],
    ['mass assignment of owner', { ownerId: 'a'.repeat(24) }],
    ['mass assignment of status', { status: 'published', processing: { state: 'ready' } }],
  ])('rejects %s with 400', async (_n, over) => {
    await requestTicket(h.app, alice, over, 400);
  });

  it('rejects a file above the server limit with 413', async () => {
    const res = await request(h.app)
      .post(`${API}/videos/uploads`)
      .set(alice.auth)
      .send(videoBody({ sizeBytes: 5 * 1024 * 1024 + 1 }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('caps parallel pending uploads per user', async () => {
    const u = await createUser(h.app);
    for (let i = 0; i < 5; i++) await requestTicket(h.app, u);
    const res = await request(h.app).post(`${API}/videos/uploads`).set(u.auth).send(videoBody());
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('UPLOAD_LIMIT');
  });

  it('a provider outage fails cleanly (502) and leaves a failed record, not a dangling pending one', async () => {
    const u = await createUser(h.app);
    p.failUpload = true;
    const res = await request(h.app).post(`${API}/videos/uploads`).set(u.auth).send(videoBody());
    p.failUpload = false;
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toMatch(/down|cloudflare/i);
    const docs = await Media.find({ ownerId: u.id });
    expect(docs).toHaveLength(1);
    expect(docs[0]?.processing.state).toBe('failed');
    expect(docs[0]?.processing.failureCode).toBe('provider_error');
  });
});

describe('the dev upload endpoint (stand-in for the provider)', () => {
  it('only accepts known video types, non-empty bodies and valid one-time ids', async () => {
    const t = await requestTicket(h.app, alice);
    expect((await sendFile(h.app, t.upload.url, 'application/pdf')).status).toBe(415);
    expect((await sendFile(h.app, t.upload.url, 'video/mp4', Buffer.alloc(0))).status).toBe(400);
    expect((await sendFile(h.app, '/api/v1/media/dev/uploads/deadbeef')).status).toBe(404);
    expect(
      (await sendFile(h.app, t.upload.url, 'video/mp4', Buffer.alloc(6 * 1024 * 1024))).status,
    ).toBe(413);
    expect((await sendFile(h.app, t.upload.url)).status).toBe(201);
    // the URL is single-use
    expect((await sendFile(h.app, t.upload.url)).status).toBe(404);
  });

  it('marks the video ready after the upload; the creator sees it, others do not until then', async () => {
    const t = await requestTicket(h.app, alice);
    expect((await get(bob, `/videos/${t.video.id}`)).status).toBe(404);
    expect((await get(alice, `/videos/${t.video.id}`)).body.video.processing.state).toBe(
      'pending_upload',
    );
    await sendFile(h.app, t.upload.url);
    const after = await get(bob, `/videos/${t.video.id}`);
    expect(after.status).toBe(200);
    expect(after.body.video).toMatchObject({
      processing: { state: 'ready' },
      creator: { id: alice.id },
      status: 'published',
    });
    expect(after.body.video.readyAt).toBeTruthy();
  });
});

describe('provider webhooks', () => {
  const pending = async (u?: Session) => {
    const owner = u ?? (await createUser(h.app));
    const t = await requestTicket(h.app, owner);
    const doc = await Media.findById(t.video.id);
    return { id: t.video.id, asset: doc!.providerAssetId!, owner };
  };

  it('rejects unsigned, wrongly signed, tampered and replayed requests with 401 and changes nothing', async () => {
    const { id, asset } = await pending();
    const ev = assetEvent(asset);
    expect((await postWebhook(h.app, ev, { header: null })).status).toBe(401);
    expect((await postWebhook(h.app, ev, { secret: 'a-different-secret-entirely' })).status).toBe(
      401,
    );
    expect((await postWebhook(h.app, ev, { tamper: true })).status).toBe(401);
    expect((await postWebhook(h.app, ev, { header: 'garbage' })).status).toBe(401);
    expect((await postWebhook(h.app, ev, { header: 'time=abc,sig1=00' })).status).toBe(401);
    expect(
      (await postWebhook(h.app, ev, { time: Math.floor(Date.now() / 1000) - 3600 })).status,
    ).toBe(401); // replay window
    expect(
      (await postWebhook(h.app, ev, { time: Math.floor(Date.now() / 1000) + 3600 })).status,
    ).toBe(401);
    // an end-user token is not a webhook credential
    expect(
      (await request(h.app).post(`${API}/webhooks/video`).set(alice.auth).send(ev)).status,
    ).toBe(401);
    expect((await Media.findById(id))?.processing.state).toBe('pending_upload');
    expect(await AuditLog.countDocuments({ action: 'webhook.rejected' })).toBeGreaterThan(0);
  });

  it('a signed ready event completes the upload with the reported metadata; duplicates are harmless', async () => {
    const { id, asset } = await pending();
    const ev = assetEvent(asset, {
      durationSeconds: 12.5,
      width: 720,
      height: 1280,
      sizeBytes: 1000,
    });
    expect((await postWebhook(h.app, ev)).status).toBe(200);
    expect((await postWebhook(h.app, ev)).status).toBe(200);
    const doc = await Media.findById(id);
    expect(doc).toMatchObject({ durationSeconds: 12.5, width: 720, height: 1280 });
    expect(doc?.processing.state).toBe('ready');
    expect(await AuditLog.countDocuments({ action: 'video.ready', targetId: id })).toBe(1);
  });

  it('processing status is visible to the creator; states never move backwards', async () => {
    const { id, asset, owner } = await pending();
    await postWebhook(h.app, assetEvent(asset, { state: 'processing' }));
    expect((await get(owner, `/videos/${id}`)).body.video.processing.state).toBe('processing');
    await postWebhook(h.app, assetEvent(asset, { state: 'ready' }));
    await postWebhook(h.app, assetEvent(asset, { state: 'processing' })); // late, out of order
    await postWebhook(
      h.app,
      assetEvent(asset, { state: 'failed', failure: { code: 'processing_failed', message: 'x' } }),
    );
    expect((await get(owner, `/videos/${id}`)).body.video.processing.state).toBe('ready');
  });

  it('a failed video shows the reason to its creator only, and a late "ready" cannot revive it', async () => {
    const { id, asset, owner } = await pending();
    await postWebhook(
      h.app,
      assetEvent(asset, {
        state: 'failed',
        failure: { code: 'unsupported_format', message: 'Codec not supported' },
      }),
    );
    const own = (await get(owner, `/videos/${id}`)).body.video;
    expect(own.processing).toMatchObject({
      state: 'failed',
      failure: { code: 'unsupported_format', message: 'Codec not supported' },
    });
    expect((await get(bob, `/videos/${id}`)).status).toBe(404);
    await postWebhook(h.app, assetEvent(asset, { state: 'ready' }));
    expect((await Media.findById(id))?.processing.state).toBe('failed');
  });

  it('re-checks limits on the provider-reported values (too long / too big) and deletes the asset', async () => {
    const long = await pending();
    p.deleted.length = 0;
    await postWebhook(h.app, assetEvent(long.asset, { durationSeconds: 600 }));
    const d1 = await Media.findById(long.id);
    expect(d1?.processing).toMatchObject({ state: 'failed', failureCode: 'too_long' });
    expect(p.deleted).toContain(long.asset);
    const big = await pending();
    await postWebhook(h.app, assetEvent(big.asset, { sizeBytes: 50 * 1024 * 1024 }));
    expect((await Media.findById(big.id))?.processing.state).toBe('failed');
  });

  it('unknown assets, unknown events and malformed JSON are acknowledged without effect', async () => {
    expect((await postWebhook(h.app, assetEvent('nope'))).status).toBe(200);
    expect((await postWebhook(h.app, { type: 'something.else' })).status).toBe(200);
    const body = 'not json';
    const time = Math.floor(Date.now() / 1000);
    const { signWebhook } = await import('../src/modules/media/provider');
    const res = await request(h.app)
      .post(`${API}/webhooks/video`)
      .set('content-type', 'application/json')
      .set(
        'webhook-signature',
        `time=${time},sig1=${signWebhook('test-webhook-secret-1234567890', time, body)}`,
      )
      .send(body);
    expect(res.status).toBe(200);
  });

  it('the creator can pull the state from the provider when a webhook was missed', async () => {
    const { id, asset, owner } = await pending();
    p.override.set(asset, { providerAssetId: asset, state: 'ready', durationSeconds: 8 });
    expect((await send('post', bob, `/videos/${id}/refresh`)).status).toBe(404);
    const res = await send('post', owner, `/videos/${id}/refresh`);
    expect(res.body.video.processing.state).toBe('ready');
    p.override.clear();
  });

  it('a provider outage during refresh is a clean 502', async () => {
    const { id, owner } = await pending();
    p.failGetAsset = true;
    const res = await send('post', owner, `/videos/${id}/refresh`);
    p.failGetAsset = false;
    expect(res.status).toBe(502);
  });
});

describe('visibility and the vertical feed', () => {
  it('shows only ready + published videos according to visibility; processing and failed stay private to the creator', async () => {
    const creator = await createUser(h.app);
    const follower = await createUser(h.app);
    const stranger = await createUser(h.app);
    await follow(follower, creator);
    const pub = await readyVideo(h.app, creator, { title: 'pub' });
    const fol = await readyVideo(h.app, creator, { title: 'fol', visibility: 'followers' });
    const priv = await readyVideo(h.app, creator, { title: 'priv', visibility: 'private' });
    const proc = (await requestTicket(h.app, creator, { title: 'processing' })).video.id;

    const ids = async (s: Session, q = '') =>
      (await get(s, `/videos?creatorId=${creator.id}&limit=30${q}`)).body.items.map(
        (i: any) => i.id,
      );
    expect((await ids(stranger)).sort()).toEqual([pub].sort());
    expect((await ids(follower)).sort()).toEqual([pub, fol].sort());
    expect((await ids(creator)).sort()).toEqual([pub, fol, priv].sort());
    expect(await ids(creator, '&mine=true')).toContain(proc);
    expect(await ids(stranger, '&mine=true')).toEqual([]);
    for (const id of [fol, priv, proc])
      expect((await get(stranger, `/videos/${id}`)).status).toBe(404);
    expect((await get(follower, `/videos/${priv}`)).status).toBe(404);
    expect((await get(follower, `/videos/${fol}`)).status).toBe(200);
    const global = (await get(stranger, '/videos?limit=30')).body.items.map((i: any) => i.id);
    expect(global).toContain(pub);
    expect(global).not.toContain(fol);
    // unfollowing removes access immediately
    await send('delete', follower, `/users/${creator.id}/follow`);
    expect((await get(follower, `/videos/${fol}`)).status).toBe(404);
  });

  it('pages newest-first by cursor without duplicates; forged cursors are 400', async () => {
    const creator = await createUser(h.app);
    const made: string[] = [];
    for (let i = 0; i < 5; i++) made.push(await readyVideo(h.app, creator, { title: `v${i}` }));
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await get(
        bob,
        `/videos?creatorId=${creator.id}&limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      );
      seen.push(...res.body.items.map((i: any) => i.id));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual([...made].reverse());
    expect((await get(bob, '/videos?cursor=garbage')).status).toBe(400);
    expect((await get(bob, '/videos?limit=0')).status).toBe(400);
    expect((await get(bob, '/videos?limit=500')).status).toBe(400);
    expect((await get(bob, '/videos?bogus=1')).status).toBe(400);
  });

  it('scope=following lists followed creators (and your own) only', async () => {
    const viewer = await createUser(h.app);
    const followed = await createUser(h.app);
    const other = await createUser(h.app);
    await follow(viewer, followed);
    const a = await readyVideo(h.app, followed);
    await readyVideo(h.app, other);
    const mine = await readyVideo(h.app, viewer);
    const res = await get(viewer, '/videos?scope=following&limit=30');
    expect(res.body.items.map((i: any) => i.id).sort()).toEqual([a, mine].sort());
  });

  it('never includes provider secrets or storage ids in responses', async () => {
    const id = await readyVideo(h.app, alice);
    const res = await get(bob, `/videos/${id}`);
    const doc = await Media.findById(id);
    expect(JSON.stringify(res.body)).not.toContain(doc!.providerAssetId!);
    expect(JSON.stringify((await get(bob, '/videos?limit=30')).body)).not.toContain(
      doc!.providerAssetId!,
    );
  });
});

describe('creator-only editing and deletion', () => {
  it('only the creator edits; failures are 404; mass assignment is rejected', async () => {
    const id = await readyVideo(h.app, alice, { title: 'old' });
    expect((await send('patch', bob, `/videos/${id}`, { title: 'hacked' })).status).toBe(404);
    expect((await send('patch', mod, `/videos/${id}`, { title: 'hacked' })).status).toBe(404);
    expect(
      (await send('patch', alice, `/videos/${id}`, { title: 'new', status: 'removed' })).status,
    ).toBe(400);
    expect((await send('patch', alice, `/videos/${id}`, {})).status).toBe(400);
    const ok = await send('patch', alice, `/videos/${id}`, {
      title: 'new',
      visibility: 'followers',
    });
    expect(ok.body.video).toMatchObject({ title: 'new', visibility: 'followers' });
    expect((await get(carol, `/videos/${id}`)).status).toBe(404);
  });

  it('delete is creator-only, hides the video everywhere and removes the provider asset', async () => {
    const id = await readyVideo(h.app, alice);
    const asset = (await Media.findById(id))!.providerAssetId!;
    expect((await send('delete', bob, `/videos/${id}`)).status).toBe(404);
    expect((await send('delete', alice, `/videos/${id}`)).status).toBe(204);
    for (const s of [alice, bob]) expect((await get(s, `/videos/${id}`)).status).toBe(404);
    expect((await get(bob, `/videos/${id}/playback`)).status).toBe(404);
    expect(p.deleted).toContain(asset);
    expect((await Media.findById(id))?.providerDeletedAt).toBeTruthy();
    expect((await send('delete', alice, `/videos/${id}`)).status).toBe(404);
  });

  it('a failing provider delete is retried by the cleanup job', async () => {
    const id = await readyVideo(h.app, alice);
    const asset = (await Media.findById(id))!.providerAssetId!;
    p.failDelete = true;
    await send('delete', alice, `/videos/${id}`);
    p.failDelete = false;
    expect((await Media.findById(id))?.providerDeletedAt).toBeNull();
    const report = await runMediaCleanup({ env: h.env, video: p });
    expect(report.assetsDeleted).toBeGreaterThanOrEqual(1);
    expect(p.deleted).toContain(asset);
    expect((await Media.findById(id))?.providerDeletedAt).toBeTruthy();
  });
});

describe('playback authorization', () => {
  it('returns a short-lived signed URL only to viewers who may watch', async () => {
    const creator = await createUser(h.app);
    const follower = await createUser(h.app);
    const id = await readyVideo(h.app, creator, { visibility: 'followers' });
    await follow(follower, creator);
    expect((await get(bob, `/videos/${id}/playback`)).status).toBe(404);
    const res = await get(follower, `/videos/${id}/playback`);
    expect(res.status).toBe(200);
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(res.body.url).toMatch(/token=/);
    // the link works...
    const file = await request(h.app).get(pathOf(res.body.url));
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('video/mp4');
    // ...supports ranges (seeking)...
    const part = await request(h.app).get(pathOf(res.body.url)).set('range', 'bytes=0-3');
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toMatch(/^bytes 0-3\//);
    // ...and cannot be forged or reused with another id/expiry
    expect(
      (
        await request(h.app).get(
          pathOf(res.body.url).replace(/token=[0-9a-f]+/, 'token=' + '0'.repeat(64)),
        )
      ).status,
    ).toBe(403);
    expect(
      (await request(h.app).get(pathOf(res.body.url).replace(/exp=\d+/, 'exp=9999999999'))).status,
    ).toBe(403);
    expect(
      (await request(h.app).get(pathOf(res.body.url).replace(/exp=\d+/, 'exp=1'))).status,
    ).toBe(403);
  });

  it('is refused for unfinished, hidden or deleted videos and survives a provider outage as 502', async () => {
    const t = await requestTicket(h.app, alice);
    expect((await get(alice, `/videos/${t.video.id}/playback`)).status).toBe(409);
    const id = await readyVideo(h.app, alice);
    p.failSign = true;
    expect((await get(bob, `/videos/${id}/playback`)).status).toBe(502);
    p.failSign = false;
    expect((await get(bob, `/videos/${id}/playback`)).status).toBe(200);
    await send('post', mod, `/moderation/video/${id}/status`, {
      status: 'hidden',
      reason: 'review',
    });
    expect((await get(bob, `/videos/${id}/playback`)).status).toBe(404);
  });
});

describe('view tracking with deduplication', () => {
  it('counts a view only after enough watch time, once per viewer per 24 h, never for the creator', async () => {
    const creator = await createUser(h.app);
    const v = await readyVideo(h.app, creator);
    const view = (s: Session, watchedSeconds: number) =>
      send('post', s, `/videos/${v}/views`, { watchedSeconds });
    expect((await view(creator, 30)).body).toMatchObject({ counted: false, viewCount: 0 });
    expect((await view(bob, 1)).body).toMatchObject({ counted: false, viewCount: 0 });
    expect((await view(bob, 3)).body).toMatchObject({ counted: true, viewCount: 1 });
    expect((await view(bob, 50)).body).toMatchObject({ counted: false, viewCount: 1 });
    expect((await view(carol, 5)).body).toMatchObject({ counted: true, viewCount: 2 });
    expect((await get(alice, `/videos/${v}`)).body.video.viewCount).toBe(2);
    // after the window, the same viewer counts again
    await VideoMetric.updateOne(
      { videoId: v, viewerId: bob.id },
      { $set: { lastCountedAt: new Date(Date.now() - 25 * 3_600_000) } },
    );
    expect((await view(bob, 5)).body).toMatchObject({ counted: true, viewCount: 3 });
    expect(await VideoMetric.countDocuments({ videoId: v, viewerId: bob.id })).toBe(1);
  });

  it('50 parallel reports by one viewer count exactly once', async () => {
    const v = await readyVideo(h.app, alice);
    const viewer = await createUser(h.app);
    await Promise.all(
      Array.from({ length: 50 }, () =>
        send('post', viewer, `/videos/${v}/views`, { watchedSeconds: 10 }),
      ),
    );
    expect((await Media.findById(v))?.viewCount).toBe(1);
    expect(await VideoMetric.countDocuments({ videoId: v, viewerId: viewer.id })).toBe(1);
  });

  it('short videos need half their length; invalid or hidden targets are refused', async () => {
    const v = await readyVideo(h.app, alice);
    await Media.updateOne({ _id: v }, { $set: { durationSeconds: 2 } });
    const viewer = await createUser(h.app);
    expect(
      (await send('post', viewer, `/videos/${v}/views`, { watchedSeconds: 0.5 })).body.counted,
    ).toBe(false);
    expect(
      (await send('post', viewer, `/videos/${v}/views`, { watchedSeconds: 1 })).body.counted,
    ).toBe(true);
    expect((await send('post', viewer, `/videos/${v}/views`, { watchedSeconds: -1 })).status).toBe(
      400,
    );
    expect((await send('post', viewer, `/videos/${v}/views`, { watchedSeconds: 'x' })).status).toBe(
      400,
    );
    expect(
      (await send('post', viewer, `/videos/${v}/views`, { watchedSeconds: 5, userId: bob.id }))
        .status,
    ).toBe(400);
    const priv = await readyVideo(h.app, alice, { visibility: 'private' });
    expect(
      (await send('post', viewer, `/videos/${priv}/views`, { watchedSeconds: 5 })).status,
    ).toBe(404);
  });
});

describe('likes and comments on videos', () => {
  it('likes are idempotent per user, parallel-safe, and unlike never goes negative', async () => {
    const v = await readyVideo(h.app, alice);
    const r = await Promise.all(
      Array.from({ length: 20 }, () => send('post', bob, `/videos/${v}/reactions`)),
    );
    expect(r.every((x) => x.status === 200)).toBe(true);
    expect((await Media.findById(v))?.reactionCount).toBe(1);
    await send('post', carol, `/videos/${v}/reactions`);
    expect((await get(bob, `/videos/${v}`)).body.video).toMatchObject({
      reactionCount: 2,
      viewer: { reacted: true },
    });
    await Promise.all(
      Array.from({ length: 5 }, () => send('delete', bob, `/videos/${v}/reactions`)),
    );
    expect((await send('delete', bob, `/videos/${v}/reactions`)).body).toEqual({
      reacted: false,
      reactionCount: 1,
    });
  });

  it('comments, replies, counters and authorship rules work for videos', async () => {
    const v = await readyVideo(h.app, alice);
    const c = (await send('post', bob, `/videos/${v}/comments`, { body: 'Nice calf' })).body
      .comment;
    const r = (
      await send('post', carol, `/videos/${v}/comments`, { body: 'Agree', parentId: c.id })
    ).body.comment;
    expect(r.parentId).toBe(c.id);
    expect((await Media.findById(v))?.commentCount).toBe(2);
    const list = await get(alice, `/videos/${v}/comments`);
    expect(list.body.items.map((x: any) => x.id)).toEqual([c.id]);
    expect((await get(alice, `/videos/${v}/comments?parentId=${c.id}`)).body.items).toHaveLength(1);
    expect((await send('patch', alice, `/comments/${c.id}`, { body: 'x' })).status).toBe(404); // not the author
    expect((await send('patch', bob, `/comments/${c.id}`, { body: 'Very nice calf' })).status).toBe(
      200,
    );
    expect((await send('delete', carol, `/comments/${r.id}`)).status).toBe(204);
    expect((await Media.findById(v))?.commentCount).toBe(1);
    expect((await send('post', bob, `/videos/${v}/comments`, { body: '' })).status).toBe(400);
  });

  it('video comments and post comments stay separate', async () => {
    const v = await readyVideo(h.app, alice);
    const post = (await send('post', alice, '/posts', { body: 'a post' })).body.post;
    expect((await get(bob, `/posts/${v}/comments`)).status).toBe(404);
    expect((await get(bob, `/videos/${post.id}/comments`)).status).toBe(404);
    const c = (await send('post', bob, `/videos/${v}/comments`, { body: 'on video' })).body.comment;
    expect((await get(bob, `/posts/${post.id}/comments`)).body.items).toHaveLength(0);
    // a comment on a video cannot be posted under a post id as parent
    expect(
      (await send('post', bob, `/posts/${post.id}/comments`, { body: 'x', parentId: c.id })).status,
    ).toBe(404);
  });

  it('hidden, unfinished and private videos accept neither likes nor comments from others', async () => {
    const alice = await createUser(h.app);
    const t = await requestTicket(h.app, alice);
    expect((await send('post', bob, `/videos/${t.video.id}/reactions`)).status).toBe(404);
    expect((await send('post', bob, `/videos/${t.video.id}/comments`, { body: 'x' })).status).toBe(
      404,
    );
    expect(
      (await send('post', alice, `/videos/${t.video.id}/comments`, { body: 'x' })).status,
    ).toBe(409);
    const priv = await readyVideo(h.app, alice, { visibility: 'private' });
    expect((await send('post', bob, `/videos/${priv}/comments`, { body: 'x' })).status).toBe(404);
  });
});

describe('reporting and moderation of videos', () => {
  it('members can report visible videos; moderators hide/restore them; creators see a notice', async () => {
    const creator = await createUser(h.app);
    const v = await readyVideo(h.app, creator);
    expect((await send('post', bob, `/videos/${v}/reports`, { reason: 'spam' })).status).toBe(201);
    expect((await send('post', bob, `/videos/${v}/reports`, { reason: 'spam' })).status).toBe(409);
    expect((await send('post', creator, `/videos/${v}/reports`, { reason: 'spam' })).status).toBe(
      409,
    );
    expect((await send('post', bob, `/videos/${v}/reports`, { reason: 'because' })).status).toBe(
      400,
    );
    const queue = (await get(mod, '/moderation/reports?limit=50')).body.items;
    const rep = queue.find((x: any) => x.targetId === v);
    expect(rep).toMatchObject({
      targetType: 'video',
      containerType: 'video',
      reason: 'spam',
      targetStatus: 'published',
    });
    expect((await get(bob, '/moderation/reports')).status).toBe(403);

    const res = await send('post', mod, `/moderation/reports/${rep.id}/resolve`, {
      action: 'hide',
      note: 'violates rules',
    });
    expect(res.body.report).toMatchObject({ status: 'actioned', targetStatus: 'hidden' });
    expect((await get(bob, `/videos/${v}`)).status).toBe(404);
    expect((await get(bob, `/videos?creatorId=${creator.id}`)).body.items).toHaveLength(0);
    const own = (await get(creator, `/videos/${v}`)).body.video;
    expect(own.status).toBe('hidden');
    expect(own.moderationNotice).toBeTruthy();
    expect(JSON.stringify(own)).not.toContain('violates rules');
    expect((await send('patch', creator, `/videos/${v}`, { title: 'sneaky' })).status).toBe(409);
    const hist = await get(mod, `/moderation/video/${v}/history`);
    expect(hist.body.entries[0]).toMatchObject({
      action: 'hidden',
      reason: 'violates rules',
      by: mod.id,
    });
    expect(
      (
        await send('post', mod, `/moderation/video/${v}/status`, {
          status: 'published',
          reason: 'appeal ok',
        })
      ).status,
    ).toBe(200);
    expect((await get(bob, `/videos/${v}`)).status).toBe(200);
  });

  it('a moderator cannot moderate their own video or resurrect a creator-deleted one', async () => {
    const own = await requestTicket(h.app, mod as unknown as Session);
    const alice = await createUser(h.app);
    expect(
      (
        await send('post', mod, `/moderation/video/${own.video.id}/status`, {
          status: 'hidden',
          reason: 'self',
        })
      ).status,
    ).toBe(403);
    const v = await readyVideo(h.app, alice);
    await send('delete', alice, `/videos/${v}`);
    expect(
      (
        await send('post', mod, `/moderation/video/${v}/status`, {
          status: 'published',
          reason: 'restore',
        })
      ).status,
    ).toBe(409);
  });

  it('removed videos get their provider asset deleted by cleanup after the retention period only', async () => {
    const v = await readyVideo(h.app, alice);
    const asset = (await Media.findById(v))!.providerAssetId!;
    await send('post', mod, `/moderation/video/${v}/status`, {
      status: 'removed',
      reason: 'illegal',
    });
    await runMediaCleanup({ env: h.env, video: p });
    expect(p.deleted).not.toContain(asset);
    await runMediaCleanup({ env: h.env, video: p }, new Date(Date.now() + 31 * 86_400_000));
    expect(p.deleted).toContain(asset);
  });

  it('only moderators can trigger the cleanup endpoint', async () => {
    expect((await send('post', alice, '/moderation/media/cleanup')).status).toBe(403);
    const res = await send('post', mod, '/moderation/media/cleanup');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('uploadsExpired');
  });
});

describe('failed-upload handling and cleanup', () => {
  it('expired uploads become failed(upload_expired) and their asset is deleted; the job is idempotent', async () => {
    const alice = await createUser(h.app);
    const t = await requestTicket(h.app, alice);
    await Media.updateOne(
      { _id: t.video.id },
      { $set: { uploadExpiresAt: new Date(Date.now() - 3_600_000) } },
    );
    const r1 = await runMediaCleanup(
      { env: h.env, video: p },
      new Date(Date.now() + 2 * 3_600_000),
    );
    expect(r1.uploadsExpired).toBeGreaterThanOrEqual(1);
    const doc = await Media.findById(t.video.id);
    expect(doc?.processing).toMatchObject({ state: 'failed', failureCode: 'upload_expired' });
    expect((await get(alice, `/videos/${t.video.id}`)).body.video.processing.failure.code).toBe(
      'upload_expired',
    );
    const r2 = await runMediaCleanup(
      { env: h.env, video: p },
      new Date(Date.now() + 4 * 3_600_000),
    );
    expect(r2.uploadsExpired).toBe(0);
    expect((await Media.findById(t.video.id))?.providerDeletedAt).toBeTruthy();
  });

  it('an upload that finished at the provider but whose webhook was lost is recovered, not failed', async () => {
    const alice = await createUser(h.app);
    const t = await requestTicket(h.app, alice);
    const asset = (await Media.findById(t.video.id))!.providerAssetId!;
    p.override.set(asset, { providerAssetId: asset, state: 'ready', durationSeconds: 5 });
    await Media.updateOne(
      { _id: t.video.id },
      { $set: { uploadExpiresAt: new Date(Date.now() - 3_600_000) } },
    );
    const r = await runMediaCleanup({ env: h.env, video: p });
    p.override.clear();
    expect(r.uploadsRecovered).toBeGreaterThanOrEqual(1);
    expect((await Media.findById(t.video.id))?.processing.state).toBe('ready');
  });

  it('a provider outage during cleanup skips (no false failure) and retries next run', async () => {
    const alice = await createUser(h.app);
    const t = await requestTicket(h.app, alice);
    await Media.updateOne(
      { _id: t.video.id },
      { $set: { uploadExpiresAt: new Date(Date.now() - 3_600_000) } },
    );
    p.failGetAsset = true;
    await runMediaCleanup({ env: h.env, video: p });
    p.failGetAsset = false;
    expect((await Media.findById(t.video.id))?.processing.state).toBe('pending_upload');
  });

  it('videos stuck in processing are failed after the limit', async () => {
    const alice = await createUser(h.app);
    const t = await requestTicket(h.app, alice);
    const asset = (await Media.findById(t.video.id))!.providerAssetId!;
    await postWebhook(h.app, assetEvent(asset, { state: 'processing' }));
    p.override.set(asset, { providerAssetId: asset, state: 'processing' });
    await runMediaCleanup({ env: h.env, video: p }, new Date(Date.now() + 2 * 3_600_000));
    expect((await Media.findById(t.video.id))?.processing.state).toBe('processing'); // 2h: still waiting
    await runMediaCleanup({ env: h.env, video: p }, new Date(Date.now() + 7 * 3_600_000));
    p.override.clear();
    expect((await Media.findById(t.video.id))?.processing).toMatchObject({
      state: 'failed',
      failureCode: 'processing_failed',
    });
  });
});

describe('audit trail', () => {
  it('records upload, ready, delete and moderation without file names or secrets', async () => {
    const creator = await createUser(h.app);
    const v = await readyVideo(h.app, creator, { filename: 'private-name-xyz.mp4' });
    await send('delete', creator, `/videos/${v}`);
    const logs = await AuditLog.find({ targetId: v });
    expect(logs.map((l) => l.action).sort()).toEqual([
      'video.deleted',
      'video.ready',
      'video.upload_requested',
    ]);
    expect(JSON.stringify(logs)).not.toContain('private-name-xyz');
  });
});
