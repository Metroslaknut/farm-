/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LiveSession } from '../../src/models';
import { runMediaCleanup } from '../../src/modules/media/cleanup.service';
import {
  createFarmer,
  createStaff,
  createUser,
  startHarness,
  type Session,
  type Staff,
  type TestHarness,
} from '../helpers';
import { API, TestProvider, postWebhook, readyVideo } from '../video-helpers';

/**
 * Regression tests for media and community-moderation defects found in the full-system audit.
 * Each test reproduces the reported behaviour first; the fix makes it pass.
 */
let h: TestHarness;
let p: TestProvider;
let mod: Staff;
beforeAll(async () => {
  h = await startHarness({}, { video: (env) => (p = new TestProvider(env)) });
  mod = await createStaff(h.app, ['moderator']);
});
afterAll(() => h.stop());

const send = (s: Session, path: string, body?: object) =>
  request(h.app).post(`${API}${path}`).set(s.auth).send(body);
const liveStream = async (s: Session) => {
  const res = await send(s, '/live', { title: 'Morning milking' });
  if (res.status !== 201) throw new Error(`live create ${res.status} ${JSON.stringify(res.body)}`);
  const id: string = res.body.live.id;
  const input = (await LiveSession.findById(id))!.providerInputId;
  await postWebhook(h.app, { type: 'live.connected', providerInputId: input });
  return { id, input };
};

describe('AUDIT-M1: taking a stream down directly (not through a report) also stops the broadcast', () => {
  it('removes the provider input when a moderator sets a live stream to removed', async () => {
    const { id, input } = await liveStream(await createFarmer(h.app));
    const res = await send(mod, `/moderation/live/${id}/status`, {
      status: 'removed',
      reason: 'unsafe handling',
    });
    expect(res.status).toBe(200);
    expect(await LiveSession.findById(id)).toMatchObject({ state: 'ended', status: 'removed' });
    expect(p.liveDeleted).toContain(input);
  });
});

describe('AUDIT-M2: a moderator cannot dismiss reports about their own content', () => {
  it('refuses to dismiss a report whose target the moderator authored', async () => {
    const m = await createStaff(h.app, ['moderator', 'farm_owner']);
    const { id } = await liveStream(m);
    const viewer = await createUser(h.app);
    expect((await send(viewer, `/live/${id}/reports`, { reason: 'spam' })).status).toBe(201);
    const reports = await request(h.app).get(`${API}/moderation/reports?limit=50`).set(mod.auth);
    const rep = reports.body.items.find((x: any) => x.targetId === id);
    const res = await send(m, `/moderation/reports/${rep.id}/resolve`, { action: 'dismiss' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SELF_MODERATION');
  });
});

describe('AUDIT-M3: a stream whose disconnect was never reported does not stay live forever', () => {
  it('ends a stream that has been live beyond the maximum duration', async () => {
    const { id, input } = await liveStream(await createFarmer(h.app));
    await LiveSession.collection.updateOne(
      { _id: new Types.ObjectId(id) },
      { $set: { startedAt: new Date(Date.now() - 13 * 3_600_000) } },
    );
    const fresh = await liveStream(await createFarmer(h.app));
    await runMediaCleanup({ env: h.env, video: p });
    expect(await LiveSession.findById(id)).toMatchObject({ state: 'ended', endReason: 'timeout' });
    expect(p.liveDeleted).toContain(input);
    expect((await LiveSession.findById(fresh.id))?.state).toBe('live'); // a recent stream is untouched
  });
});

describe('AUDIT-M4: the upload screens can poll processing status for their whole polling window', () => {
  it('allows a 3-second poll for several minutes without a 429', async () => {
    const limited = await startHarness(
      { RATE_LIMIT_ENABLED: 'true' },
      { video: (env) => new TestProvider(env) },
    );
    try {
      const owner = await createFarmer(limited.app);
      const id = await readyVideo(limited.app, owner);
      const statuses: number[] = [];
      for (let i = 0; i < 100; i++)
        // the clients poll at most 100 times, every 3 s
        statuses.push(
          (await request(limited.app).post(`${API}/videos/${id}/refresh`).set(owner.auth)).status,
        );
      expect(statuses.filter((s) => s !== 200)).toEqual([]);
    } finally {
      await limited.stop();
    }
  });
});
