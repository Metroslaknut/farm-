/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog, LiveSession } from '../src/models';
import { runMediaCleanup } from '../src/modules/media/cleanup.service';
import {
  createFarmer,
  createStaff,
  createUser,
  startHarness,
  type Session,
  type Staff,
  type TestHarness,
} from './helpers';
import { API, TestProvider, postWebhook } from './video-helpers';

let h: TestHarness;
let p: TestProvider;
let mod: Staff;
let root: Staff;

beforeAll(async () => {
  h = await startHarness({}, { video: (env) => (p = new TestProvider(env)) });
  mod = await createStaff(h.app, ['moderator']);
  root = await createStaff(h.app, ['super_admin']);
});
afterAll(async () => {
  await h.stop();
});

const get = (s: Session, path: string) => request(h.app).get(`${API}${path}`).set(s.auth);
const send = (m: 'post' | 'patch' | 'delete', s: Session, path: string, body?: object) =>
  request(h.app)[m](`${API}${path}`).set(s.auth).send(body);
const host = () => createFarmer(h.app);
const goLive = async (s: Session, body: object = {}) => {
  const res = await send('post', s, '/live', { title: 'Morning milking', ...body });
  if (res.status !== 201) throw new Error(`live create ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { live: any; ingest: { rtmpsUrl: string; streamKey: string } };
};
const inputOf = async (id: string) => (await LiveSession.findById(id))!.providerInputId;
const connected = (input: string) =>
  postWebhook(h.app, { type: 'live.connected', providerInputId: input });
const disconnected = (input: string) =>
  postWebhook(h.app, { type: 'live.disconnected', providerInputId: input });

describe('host authorization', () => {
  it('requires authentication', async () => {
    expect((await request(h.app).post(`${API}/live`).send({ title: 'x' })).status).toBe(401);
    expect((await request(h.app).get(`${API}/live`)).status).toBe(401);
  });

  it('plain members cannot go live; farm owners can', async () => {
    const member = await createUser(h.app);
    const res = await send('post', member, '/live', { title: 'Hi' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('LIVE_HOST_REQUIRED');
    expect((await goLive(await host())).live.state).toBe('created');
  });

  it('the setting live.requireHostRole opens hosting to every member', async () => {
    const member = await createUser(h.app);
    await send('patch', root, '/admin/settings', {
      values: { 'live.requireHostRole': false },
      reason: 'open for test',
    });
    const ok = await send('post', member, '/live', { title: 'Open stage' });
    await send('patch', root, '/admin/settings', {
      values: { 'live.requireHostRole': true },
      reason: 'restore',
    });
    expect(ok.status).toBe(201);
    expect((await send('post', await createUser(h.app), '/live', { title: 'x' })).status).toBe(403);
  });

  it('validates input and rejects mass assignment', async () => {
    const s = await host();
    for (const body of [
      { title: '' },
      { title: 'x'.repeat(121) },
      { title: 'ok', access: 'friends' },
      { title: 'ok', state: 'live' },
      { title: 'ok', hostId: 'a'.repeat(24) },
      { title: 'ok', providerInputId: 'x' },
    ])
      expect((await send('post', s, '/live', body)).status, JSON.stringify(body)).toBe(400);
  });

  it('a host has at most one session that is not over (also under parallel requests)', async () => {
    const s = await host();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => send('post', s, '/live', { title: 'race' })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(
      results
        .filter((r) => r.status === 409)
        .every((r) => r.body.error.code === 'LIVE_ALREADY_ACTIVE'),
    ).toBe(true);
    expect(
      await LiveSession.countDocuments({
        hostId: s.id,
        state: { $in: ['created', 'live', 'interrupted'] },
      }),
    ).toBe(1);
  });

  it('a provider outage fails cleanly and stores nothing', async () => {
    const s = await host();
    p.failLive = true;
    const res = await send('post', s, '/live', { title: 'x' });
    p.failLive = false;
    expect(res.status).toBe(502);
    expect(await LiveSession.countDocuments({ hostId: s.id })).toBe(0);
  });
});

describe('stream key handling', () => {
  it('the ingest address is shown to the host at creation and on request, and nowhere else', async () => {
    const s = await host();
    const other = await host();
    const { live, ingest } = await goLive(s);
    expect(ingest.rtmpsUrl).toMatch(/^rtmps:\/\//);
    expect(ingest.streamKey).toHaveLength(24);
    const again = await send('post', s, `/live/${live.id}/ingest`);
    expect(again.body).toEqual(ingest);
    expect(again.headers['cache-control']).toBe('no-store');
    // not for anyone else, and never part of normal responses or the database
    expect((await send('post', other, `/live/${live.id}/ingest`)).status).toBe(404);
    expect((await send('post', mod, `/live/${live.id}/ingest`)).status).toBe(404);
    expect((await get(s, `/live/${live.id}`)).status).toBe(200);
    for (const res of [
      await get(s, `/live/${live.id}`),
      await get(other, '/live?state=live'),
      await get(s, '/live?state=created'),
    ])
      expect(JSON.stringify(res.body)).not.toContain(ingest.streamKey);
    expect(JSON.stringify(await LiveSession.findById(live.id))).not.toContain(ingest.streamKey);
    expect(await AuditLog.countDocuments({ action: 'live.ingest_viewed', targetId: live.id })).toBe(
      1,
    );
    expect(JSON.stringify(await AuditLog.find({ targetId: live.id }))).not.toContain(
      ingest.streamKey,
    );
  });

  it('is refused once the stream is over', async () => {
    const s = await host();
    const { live } = await goLive(s);
    await send('post', s, `/live/${live.id}/end`);
    expect((await send('post', s, `/live/${live.id}/ingest`)).status).toBe(409);
  });
});

describe('controlling a session', () => {
  it('only the host can end it; others get 404 and the session keeps running', async () => {
    const s = await host();
    const other = await host();
    const { live } = await goLive(s);
    await connected(await inputOf(live.id));
    for (const who of [other, mod, root])
      expect((await send('post', who, `/live/${live.id}/end`)).status).toBe(404);
    expect((await LiveSession.findById(live.id))?.state).toBe('live');
    const res = await send('post', s, `/live/${live.id}/end`);
    expect(res.body.live).toMatchObject({ state: 'ended' });
    expect(res.body.live.endedAt).toBeTruthy();
    expect(p.liveDeleted).toContain(await inputOf(live.id));
    // idempotent
    expect((await send('post', s, `/live/${live.id}/end`)).status).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'live.ended', targetId: live.id })).toBe(1);
  });

  it('after ending, the host can start a new session', async () => {
    const s = await host();
    const a = await goLive(s);
    await send('post', s, `/live/${a.live.id}/end`);
    expect((await goLive(s, { title: 'second' })).live.id).not.toBe(a.live.id);
  });

  it('malformed ids are 404', async () => {
    const s = await host();
    expect((await send('post', s, '/live/not-an-id/end')).status).toBe(404);
    expect((await get(s, '/live/not-an-id')).status).toBe(404);
  });
});

describe('states and provider webhooks', () => {
  it('created → live → interrupted → live → ended, driven by authenticated webhooks', async () => {
    const s = await host();
    const { live } = await goLive(s);
    const input = await inputOf(live.id);
    const state = async () => (await get(s, `/live/${live.id}`)).body.live;
    expect((await state()).state).toBe('created');
    expect((await connected(input)).status).toBe(200);
    const first = await state();
    expect(first.state).toBe('live');
    expect(first.startedAt).toBeTruthy();
    await disconnected(input);
    expect((await state()).state).toBe('interrupted');
    await connected(input);
    const again = await state();
    expect(again.state).toBe('live');
    expect(again.startedAt).toBe(first.startedAt); // reconnect keeps the original start
    await send('post', s, `/live/${live.id}/end`);
    await connected(input); // late event must not resurrect an ended session
    expect((await state()).state).toBe('ended');
  });

  it('unauthenticated or forged webhooks change nothing', async () => {
    const s = await host();
    const { live } = await goLive(s);
    const input = await inputOf(live.id);
    const ev = { type: 'live.connected', providerInputId: input };
    expect((await postWebhook(h.app, ev, { header: null })).status).toBe(401);
    expect((await postWebhook(h.app, ev, { secret: 'wrong-secret-wrong-secret' })).status).toBe(
      401,
    );
    expect((await postWebhook(h.app, ev, { time: 1 })).status).toBe(401);
    expect((await request(h.app).post(`${API}/webhooks/video`).set(s.auth).send(ev)).status).toBe(
      401,
    );
    expect((await LiveSession.findById(live.id))?.state).toBe('created');
  });

  it('events for unknown inputs are acknowledged and ignored', async () => {
    expect((await connected('mock-live-unknown')).status).toBe(200);
    expect((await disconnected('mock-live-unknown')).status).toBe(200);
  });

  it('cleanup closes streams that never reconnected or never started, and removes their provider input', async () => {
    const a = await host();
    const b = await host();
    const keep = await host();
    const la = (await goLive(a)).live.id;
    const lb = (await goLive(b)).live.id;
    const lk = (await goLive(keep)).live.id;
    await connected(await inputOf(la));
    await disconnected(await inputOf(la));
    await connected(await inputOf(lk));
    await LiveSession.collection.updateOne(
      { _id: new Types.ObjectId(lb) },
      { $set: { createdAt: new Date(Date.now() - 13 * 3_600_000) } },
    ); // never started
    const now = new Date(Date.now() + 6 * 60_000);
    const r = await runMediaCleanup({ env: h.env, video: p }, now);
    expect(r.livesClosed).toBeGreaterThanOrEqual(2);
    expect(await LiveSession.findById(la)).toMatchObject({ state: 'ended', endReason: 'timeout' });
    expect(await LiveSession.findById(lb)).toMatchObject({ state: 'ended', endReason: 'timeout' });
    expect((await LiveSession.findById(lk))?.state).toBe('live'); // a healthy stream is untouched
    expect((await runMediaCleanup({ env: h.env, video: p }, now)).livesClosed).toBe(0);
  });
});

describe('viewer access', () => {
  it('public streams are playable by anyone once live; not before, not after', async () => {
    const s = await host();
    const viewer = await createUser(h.app);
    const { live } = await goLive(s);
    const input = await inputOf(live.id);
    expect((await get(viewer, `/live/${live.id}`)).status).toBe(200); // visible, but...
    expect((await get(viewer, `/live/${live.id}/playback`)).status).toBe(409); // ...nothing to watch yet
    expect((await get(s, `/live/${live.id}/playback`)).status).toBe(200); // the host can preview
    await connected(input);
    const res = await get(viewer, `/live/${live.id}/playback`);
    expect(res.status).toBe(200);
    expect(res.body.url).toBeTruthy();
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    await send('post', s, `/live/${live.id}/end`);
    expect((await get(viewer, `/live/${live.id}/playback`)).status).toBe(404);
    expect((await get(s, `/live/${live.id}/playback`)).status).toBe(409);
  });

  it('followers-only streams need a follow; unfollowing removes access immediately', async () => {
    const s = await host();
    const fan = await createUser(h.app);
    const stranger = await createUser(h.app);
    const { live } = await goLive(s, { access: 'followers' });
    await connected(await inputOf(live.id));
    await send('post', fan, `/users/${s.id}/follow`);
    expect((await get(fan, `/live/${live.id}/playback`)).status).toBe(200);
    for (const path of [`/live/${live.id}`, `/live/${live.id}/playback`])
      expect((await get(stranger, path)).status).toBe(404);
    expect(
      (await send('post', stranger, `/live/${live.id}/reports`, { reason: 'spam' })).status,
    ).toBe(404);
    const listIds = async (u: Session) =>
      (await get(u, '/live?state=live')).body.items.map((i: any) => i.id);
    expect(await listIds(fan)).toContain(live.id);
    expect(await listIds(stranger)).not.toContain(live.id);
    await send('delete', fan, `/users/${s.id}/follow`);
    expect((await get(fan, `/live/${live.id}/playback`)).status).toBe(404);
  });

  it("lists only running public streams (and followed ones); not-started and ended lists are the host's own", async () => {
    const s = await host();
    const viewer = await createUser(h.app);
    const { live } = await goLive(s);
    expect((await get(viewer, '/live?state=live')).body.items.map((i: any) => i.id)).not.toContain(
      live.id,
    ); // created only
    await connected(await inputOf(live.id));
    expect((await get(viewer, '/live?state=live')).body.items.map((i: any) => i.id)).toContain(
      live.id,
    );
    expect((await get(viewer, '/live?state=created')).body.items).toEqual([]);
    expect((await get(viewer, '/live?state=ended')).body.items).toEqual([]);
    await send('post', s, `/live/${live.id}/end`);
    expect((await get(s, '/live?state=ended')).body.items.map((i: any) => i.id)).toContain(live.id);
    expect((await get(viewer, '/live?state=live')).body.items.map((i: any) => i.id)).not.toContain(
      live.id,
    );
    expect((await get(viewer, '/live?state=bogus')).status).toBe(400);
  });

  it('a playback outage is a clean 502', async () => {
    const s = await host();
    const { live } = await goLive(s);
    await connected(await inputOf(live.id));
    p.failSign = true;
    const res = await get(await createUser(h.app), `/live/${live.id}/playback`);
    p.failSign = false;
    expect(res.status).toBe(502);
  });
});

describe('reporting and moderation of live streams', () => {
  it('a report lets a moderator take the stream down: it stops, the provider input is removed, the host is told', async () => {
    const s = await host();
    const viewer = await createUser(h.app);
    const { live } = await goLive(s);
    const input = await inputOf(live.id);
    await connected(input);
    expect(
      (await send('post', viewer, `/live/${live.id}/reports`, { reason: 'animal_cruelty' })).status,
    ).toBe(201);
    expect(
      (await send('post', viewer, `/live/${live.id}/reports`, { reason: 'spam' })).status,
    ).toBe(409);
    expect((await send('post', s, `/live/${live.id}/reports`, { reason: 'spam' })).status).toBe(
      409,
    );
    const rep = (await get(mod, '/moderation/reports?limit=50')).body.items.find(
      (x: any) => x.targetId === live.id,
    );
    expect(rep).toMatchObject({
      targetType: 'live',
      containerType: 'live',
      reason: 'animal_cruelty',
    });
    expect((await get(viewer, '/moderation/reports')).status).toBe(403);

    const res = await send('post', mod, `/moderation/reports/${rep.id}/resolve`, {
      action: 'remove',
      note: 'cruelty',
    });
    expect(res.body.report).toMatchObject({ status: 'actioned', targetStatus: 'removed' });
    const doc = await LiveSession.findById(live.id);
    expect(doc).toMatchObject({ state: 'ended', status: 'removed', endReason: 'moderator' });
    expect(p.liveDeleted).toContain(input);
    expect((await get(viewer, `/live/${live.id}`)).status).toBe(404);
    const own = (await get(s, `/live/${live.id}`)).body.live;
    expect(own.moderationNotice).toBeTruthy();
    expect(JSON.stringify(own)).not.toContain('cruelty');
    expect((await get(mod, `/moderation/live/${live.id}/history`)).body.entries[0]).toMatchObject({
      action: 'removed',
      by: mod.id,
    });
    // the host can start again (the session is over), but cannot end/inspect the removed one
    expect((await send('post', s, `/live/${live.id}/ingest`)).status).toBe(409);
  });

  it('moderators cannot moderate their own stream', async () => {
    const m = await createStaff(h.app, ['moderator', 'farm_owner']);
    const { live } = await goLive(m);
    expect(
      (
        await send('post', m, `/moderation/live/${live.id}/status`, {
          status: 'hidden',
          reason: 'self',
        })
      ).status,
    ).toBe(403);
  });
});

describe('audit trail', () => {
  it('records creation and ending with the actor', async () => {
    const s = await host();
    const { live } = await goLive(s);
    await send('post', s, `/live/${live.id}/end`);
    const logs = await AuditLog.find({ targetId: live.id });
    expect(logs.map((l) => l.action).sort()).toEqual(['live.created', 'live.ended']);
    expect(String(logs[0]?.actorId)).toBe(s.id);
  });
});
