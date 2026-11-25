import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UserTourProgress } from '../src/models';
import { createUser, startHarness, type TestHarness } from './helpers';

/** `/api/v1/me/tours`: each signed-in user's own guided-tour progress. */
let h: TestHarness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.stop();
});

const api = () => request(h.app);

describe('guided-tour progress', () => {
  it("is per user: one person cannot see or change another person's progress", async () => {
    const a = await createUser(h.app);
    const b = await createUser(h.app);
    const put = await api()
      .put('/api/v1/me/tours/welcome')
      .set(a.auth)
      .send({ version: 1, status: 'completed', lastStep: 4 });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.tour).toMatchObject({
      tourId: 'welcome',
      version: 1,
      status: 'completed',
      lastStep: 4,
    });

    expect((await api().get('/api/v1/me/tours').set(a.auth)).body.tours).toHaveLength(1);
    expect((await api().get('/api/v1/me/tours').set(b.auth)).body.tours).toEqual([]);
    // There is no way to name another user: unknown fields are refused, and the user always comes from the token.
    const smuggled = await api()
      .put('/api/v1/me/tours/welcome')
      .set(b.auth)
      .send({ version: 1, status: 'skipped', lastStep: 0, userId: a.id });
    expect(smuggled.status).toBe(400);
    expect((await api().get('/api/v1/me/tours').set(a.auth)).body.tours[0].status).toBe(
      'completed',
    );
  });

  it('the latest answer wins (one record per user and tour); a newer version is stored', async () => {
    const u = await createUser(h.app);
    const save = (body: object) => api().put('/api/v1/me/tours/farm-setup').set(u.auth).send(body);
    await save({ version: 1, status: 'skipped', lastStep: 2 });
    await save({ version: 2, status: 'dismissed_forever', lastStep: 0 });
    const tours = (await api().get('/api/v1/me/tours').set(u.auth)).body.tours;
    expect(tours).toEqual([
      expect.objectContaining({
        tourId: 'farm-setup',
        version: 2,
        status: 'dismissed_forever',
        lastStep: 0,
      }),
    ]);
    expect(await UserTourProgress.countDocuments({ tourId: 'farm-setup' })).toBe(1);
  });

  it('needs a signed-in user and valid input', async () => {
    expect((await api().get('/api/v1/me/tours')).status).toBe(401);
    expect(
      (
        await api()
          .put('/api/v1/me/tours/welcome')
          .send({ version: 1, status: 'completed', lastStep: 0 })
      ).status,
    ).toBe(401);
    const u = await createUser(h.app);
    for (const [tourId, body] of [
      ['Welcome Tour', { version: 1, status: 'completed', lastStep: 0 }],
      ['welcome', { version: 0, status: 'completed', lastStep: 0 }],
      ['welcome', { version: 1, status: 'started', lastStep: 0 }],
      ['welcome', { version: 1, status: 'completed', lastStep: -1 }],
      ['welcome', { version: 1, status: 'completed' }],
    ] as const) {
      const res = await api()
        .put(`/api/v1/me/tours/${encodeURIComponent(tourId)}`)
        .set(u.auth)
        .send(body);
      expect(res.status, `${tourId} ${JSON.stringify(body)}`).toBe(400);
    }
  });
});
