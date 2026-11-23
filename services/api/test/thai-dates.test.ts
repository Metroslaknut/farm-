import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { thaiDayBegins, thaiDayStart, thaiToday, thaiYymmdd } from '@farmplus/validation';
import { newOrderNo } from '../src/modules/orders/orders.service';
import { newRefundNo, newWithdrawalNo } from '../src/modules/finance/refunds.numbers';
import {
  createStaff,
  createUser,
  daysAgo,
  mkAnimal,
  setupFarm,
  startHarness,
  type Staff,
  type TestHarness,
} from './helpers';

/**
 * "Today" is the Thai calendar day everywhere, at any hour. Between 00:00 and 07:00 in Bangkok the UTC date is still
 * yesterday, and late in the evening both agree — so every check runs at 00:30 and at 23:30 Thai time on 23 Nov 2026.
 * Only `Date` is faked (timers stay real, the in-memory MongoDB keeps working).
 */
const THAI_DAY = '2026-11-23';
const TIMES = [
  ['00:30', '2026-11-22T17:30:00.000Z'],
  ['23:30', '2026-11-23T16:30:00.000Z'],
] as const;

let h: TestHarness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  vi.useRealTimers();
  await h.stop();
});
afterEach(() => {
  vi.useRealTimers();
});

describe.each(TIMES)('at %s in Bangkok', (_label, instant) => {
  const at = () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(instant));
  };
  /** Staff signed in at the faked time (a token from the real clock may already be expired there). */
  const staff = (): Promise<Staff> => createStaff(h.app, ['admin']);
  const api = () => request(h.app);

  it('the date helpers name the Thai day', () => {
    at();
    expect(thaiToday()).toBe(THAI_DAY);
    expect(daysAgo(1)).toBe('2026-11-22');
    expect(thaiDayStart().toISOString()).toBe(`${THAI_DAY}T00:00:00.000Z`);
    expect(thaiDayBegins(THAI_DAY).toISOString()).toBe('2026-11-22T17:00:00.000Z');
    expect(thaiYymmdd()).toBe('261123');
    expect(newOrderNo()).toMatch(/^FP-261123-[0-9A-F]{8}$/);
    expect(newRefundNo()).toMatch(/^RF-261123-/);
    expect(newWithdrawalNo()).toMatch(/^WD-261123-/);
  });

  it('records: today is accepted, tomorrow refused; ages, feeding schedules and the timeline use the Thai day', async () => {
    at();
    const f = await setupFarm(h.app);
    const F = (p: string) => `/api/v1/farms/${f.farmId}${p}`;
    // Born 100 Thai days ago (15 Aug → 23 Nov).
    const animal = await mkAnimal(h.app, f.owner, f.farmId, {
      animalTypeId: f.buffalo,
      sex: 'female',
      birthDate: '2026-08-15',
    });

    // "Not in the future" = not after today in Thailand.
    const weigh = (weighedOn: string) =>
      api()
        .post(F('/weights'))
        .set(f.owner.auth)
        .send({ animalId: animal.id, weighedOn, weightKg: 250 });
    expect((await weigh(THAI_DAY)).status).toBe(201);
    expect((await weigh('2026-11-24')).status).toBe(400);

    // Age today (growth page).
    const growth = await api()
      .get(F(`/animals/${animal.id}/growth`))
      .set(f.owner.auth);
    expect(growth.status).toBe(200);
    expect(growth.body.age.days).toBe(100);

    // Feeding schedules: one ending today still runs; one that ended yesterday does not.
    const feed = (body: object) =>
      api()
        .post(F('/feeding'))
        .set(f.owner.auth)
        .send({ kind: 'schedule', feedName: 'Hay', quantity: { amount: 2, unit: 'kg' }, ...body });
    const endsToday = await feed({ date: daysAgo(5), endDate: THAI_DAY });
    const endedYesterday = await feed({ date: daysAgo(5), endDate: daysAgo(1) });
    const startsToday = await feed({ date: THAI_DAY });
    expect(endsToday.body.record.active).toBe(true);
    expect(endedYesterday.body.record.active).toBe(false);
    expect(startsToday.body.record.active).toBe(true);

    // Timeline: the animal was registered "today" in Thailand, whatever the UTC date.
    const history = (q: string) =>
      api().get(`/api/v1/farms/${f.farmId}/animals/${animal.id}/history${q}`).set(f.owner.auth);
    const yesterday = (await history('?to=2026-11-22')).body.items;
    const today = (await history(`?from=${THAI_DAY}&to=${THAI_DAY}`)).body.items;
    expect(yesterday.some((e: { type: string }) => e.type === 'animal')).toBe(false);
    expect(today.some((e: { type: string }) => e.type === 'animal')).toBe(true);
  });

  it('breeding: the expected delivery date counts from the entered (Thai) breeding date', async () => {
    at();
    const admin = await staff();
    const f = await setupFarm(h.app);
    await api()
      .patch(`/api/v1/animal-types/${f.buffalo}`)
      .set(admin.auth)
      .send({ gestationDays: 310 })
      .expect(200);
    const dam = await mkAnimal(h.app, f.owner, f.farmId, {
      animalTypeId: f.buffalo,
      sex: 'female',
      birthDate: '2022-01-01',
    });
    const bred = await api()
      .post(`/api/v1/farms/${f.farmId}/breeding`)
      .set(f.owner.auth)
      .send({ damId: dam.id, breedingDate: THAI_DAY });
    expect(bred.status, JSON.stringify(bred.body)).toBe(201);
    expect(bred.body.record.expectedDeliveryDate).toBe('2027-09-29'); // 23 Nov 2026 + 310 days
    await api()
      .patch(`/api/v1/animal-types/${f.buffalo}`)
      .set(admin.auth)
      .send({ gestationDays: null })
      .expect(200);
  });

  it('the admin dashboard counts sign-ups on the Thai day', async () => {
    at();
    const admin = await staff();
    await createUser(h.app);
    const res = await api().get('/api/v1/admin/dashboard').set(admin.auth);
    expect(res.status).toBe(200);
    const days = res.body.signupsByDay as { date: string; count: number }[];
    expect(days).toHaveLength(14);
    expect(days.at(-1)!.date).toBe(THAI_DAY);
    expect(days.at(-1)!.count).toBeGreaterThanOrEqual(1);
  });
});
