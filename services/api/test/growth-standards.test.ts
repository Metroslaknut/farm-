import request from 'supertest';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog, GrowthStandard } from '../src/models';
import {
  ageWindow,
  applicable,
  evaluateMeasurement,
} from '../src/modules/growth-standards/evaluate';
import {
  addFarmMember,
  createFarmer,
  createStaff,
  createUser,
  daysAgo,
  makeFarm,
  mkAnimal,
  startHarness,
  type Session,
  type Staff,
  type TestHarness,
} from './helpers';

let h: TestHarness;
let admin: Staff;
beforeAll(async () => {
  h = await startHarness();
  admin = await createStaff(h.app, ['super_admin']);
});
afterAll(() => h.stop());

const api = () => request(h.app);
const V = (p: string) => `/api/v1${p}`;
let seq = 0;

/** A fresh animal type per test, so criteria of one test never overlap another's. */
async function newType(): Promise<string> {
  const res = await api()
    .post(V('/animal-types'))
    .set(admin.auth)
    .send({
      key: `gs_type_${++seq}`,
      name: `GS type ${seq}`,
      breeds: [{ key: 'big', name: 'Big breed' }],
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.animalType.id;
}
const SYSTEM = { kind: 'system_recommendation' };
const post = (who: Session, body: object) =>
  api().post(V('/growth-standards')).set(who.auth).send(body);

// ---------------------------------------------------------------------------
describe('evaluation rules (pure)', () => {
  const std = (over: object) => ({
    _id: new Types.ObjectId(),
    breed: null,
    sex: 'any' as const,
    kind: 'weight_for_age' as const,
    ageFromDays: 0,
    ageToDays: 100,
    minWeightKg: 10,
    maxWeightKg: 20,
    minHeightCm: null,
    maxHeightCm: null,
    minLengthCm: null,
    maxLengthCm: null,
    source: { kind: 'system_recommendation' as const },
    active: true,
    ...over,
  });
  const born = new Date('2026-01-01T00:00:00Z');
  const on = (d: number) => new Date(born.getTime() + d * 86_400_000);

  it('never judges without a birth date or without a matching criterion', () => {
    const s = [std({})];
    expect(
      evaluateMeasurement(s, { sex: 'male' }, { date: on(5), weightKg: 1 }).evaluation.status,
    ).toBe('no_age');
    expect(
      evaluateMeasurement(s, { sex: 'male', birthDate: born }, { date: on(150), weightKg: 1 })
        .evaluation.status,
    ).toBe('no_standard');
  });

  it('compares every measured bound and flags estimated ages', () => {
    const s = [std({ minHeightCm: 50, maxHeightCm: 60 })];
    const animal = { sex: 'female', birthDate: born, birthDateEstimated: true };
    const r = evaluateMeasurement(s, animal, { date: on(30), weightKg: 25, heightCm: 55 });
    expect(r.ageDays).toBe(30);
    expect(r.evaluation).toMatchObject({
      status: 'above',
      ageEstimated: true,
      source: { kind: 'system_recommendation' },
      metrics: {
        weight: { status: 'above', value: 25, min: 10, max: 20 },
        height: { status: 'within', value: 55 },
      },
    });
    expect(evaluateMeasurement(s, animal, { date: on(30), weightKg: 5 }).evaluation.status).toBe(
      'below',
    );
    expect(evaluateMeasurement(s, animal, { date: on(30), weightKg: 15 }).evaluation.status).toBe(
      'within',
    );
  });

  it('uses the most specific criterion: breed + sex beats breed beats sex beats general', () => {
    const general = std({ minWeightKg: 1 });
    const bySex = std({ sex: 'male', minWeightKg: 2 });
    const byBreed = std({ breed: 'big', minWeightKg: 3 });
    const exact = std({ breed: 'big', sex: 'male', minWeightKg: 4 });
    const all = [general, bySex, byBreed, exact];
    expect(applicable(all, { sex: 'male', breed: 'big' }, 'weight_for_age')).toEqual([exact]);
    expect(applicable(all, { sex: 'female', breed: 'big' }, 'weight_for_age')).toEqual([byBreed]);
    expect(applicable(all, { sex: 'male', breed: null }, 'weight_for_age')).toEqual([bySex]);
    expect(applicable(all, { sex: 'unknown' }, 'weight_for_age')).toEqual([general]);
    expect(applicable([std({ active: false })], { sex: 'male' }, 'weight_for_age')).toEqual([]);
  });

  it('places the animal before / within / after an age window', () => {
    const w = [std({ kind: 'sale_age', ageFromDays: 100, ageToDays: 200 })];
    const a = { sex: 'male', birthDate: born };
    expect(ageWindow(w, a, 'sale_age', on(50))?.status).toBe('before');
    expect(ageWindow(w, a, 'sale_age', on(150))?.status).toBe('within');
    expect(ageWindow(w, a, 'sale_age', on(250))?.status).toBe('after');
    expect(ageWindow(w, { sex: 'male' }, 'sale_age', on(1))?.status).toBe('no_age');
    expect(ageWindow(w, a, 'breeding_age', on(1))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe('admin management of growth criteria', () => {
  it('is admin-only (animal_types.manage); farm users get 403, anonymous 401', async () => {
    const farmer = await createFarmer(h.app);
    expect((await api().get(V('/growth-standards'))).status).toBe(401);
    expect((await api().get(V('/growth-standards')).set(farmer.auth)).status).toBe(403);
    const typeId = await newType();
    const res = await post(farmer, {
      animalTypeId: typeId,
      kind: 'sale_age',
      ageFromDays: 1,
      ageToDays: 2,
      source: SYSTEM,
    });
    expect(res.status).toBe(403);
    expect(await GrowthStandard.countDocuments({ animalTypeId: typeId })).toBe(0);
  });

  it('requires a source, a citation for references, sane ranges and the right bounds per kind', async () => {
    const typeId = await newType();
    const base = { animalTypeId: typeId, kind: 'weight_for_age', ageFromDays: 0, ageToDays: 90 };
    const cases: [object, string][] = [
      [{ ...base, minWeightKg: 10 }, 'source'],
      [{ ...base, minWeightKg: 10, source: { kind: 'reference' } }, 'source.citation'],
      [{ ...base, ageToDays: 0, minWeightKg: 10, source: SYSTEM }, 'ageToDays'],
      [{ ...base, minWeightKg: 30, maxWeightKg: 20, source: SYSTEM }, 'minWeightKg'],
      [{ ...base, source: SYSTEM }, 'minWeightKg'],
      [{ ...base, kind: 'sale_age', minWeightKg: 5, source: SYSTEM }, 'minWeightKg'],
      [{ ...base, breed: 'nope', minWeightKg: 5, source: SYSTEM }, 'breed'],
    ];
    for (const [body, path] of cases) {
      const res = await post(admin, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(
        res.body.error.details.map((d: { path: string }) => d.path),
        JSON.stringify(res.body),
      ).toContain(path);
    }
    const ok = await post(admin, {
      ...base,
      breed: 'big',
      sex: 'female',
      minWeightKg: 10,
      maxWeightKg: 20,
      source: { kind: 'reference', citation: 'Dept. of Livestock Development, 2024' },
    });
    expect(ok.status).toBe(201);
    expect(ok.body.standard).toMatchObject({
      breed: 'big',
      sex: 'female',
      minWeightKg: 10,
      source: { kind: 'reference', citation: 'Dept. of Livestock Development, 2024' },
      active: true,
    });
    expect(
      await AuditLog.exists({ action: 'growth_standard.created', targetId: ok.body.standard.id }),
    ).toBeTruthy();
  });

  it('refuses overlapping active ranges of the same scope; deactivating frees the range', async () => {
    const typeId = await newType();
    const body = (from: number, to: number, over: object = {}) => ({
      animalTypeId: typeId,
      kind: 'weight_for_age',
      ageFromDays: from,
      ageToDays: to,
      minWeightKg: 10,
      source: SYSTEM,
      ...over,
    });
    const first = await post(admin, body(0, 100));
    expect(first.status).toBe(201);
    expect((await post(admin, body(100, 200))).status).toBe(201); // adjacent is fine
    const clash = await post(admin, body(50, 150));
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('OVERLAPPING_STANDARD');
    // A different scope (sex) may overlap: the more specific one wins at evaluation time.
    expect((await post(admin, body(50, 150, { sex: 'male' }))).status).toBe(201);

    const off = await api()
      .patch(V(`/growth-standards/${first.body.standard.id}`))
      .set(admin.auth)
      .send({ active: false });
    expect(off.status).toBe(200);
    expect(off.body.standard.active).toBe(false);
    expect((await post(admin, body(0, 80))).status).toBe(201);
    // ... and it cannot be reactivated on top of the new one.
    const back = await api()
      .patch(V(`/growth-standards/${first.body.standard.id}`))
      .set(admin.auth)
      .send({ active: true });
    expect(back.status).toBe(409);

    const list = await api()
      .get(V('/growth-standards'))
      .query({ animalTypeId: typeId, includeInactive: 'true' })
      .set(admin.auth);
    expect(list.body.standards).toHaveLength(4); // the refused one was never stored
    const activeOnly = await api()
      .get(V('/growth-standards'))
      .query({ animalTypeId: typeId })
      .set(admin.auth);
    expect(activeOnly.body.standards).toHaveLength(3);
  });

  it('updates are merged and re-validated as a whole (null clears a bound)', async () => {
    const typeId = await newType();
    const created = await post(admin, {
      animalTypeId: typeId,
      kind: 'weight_for_age',
      ageFromDays: 0,
      ageToDays: 100,
      minWeightKg: 10,
      maxWeightKg: 20,
      source: SYSTEM,
    });
    const url = V(`/growth-standards/${created.body.standard.id}`);
    expect((await api().patch(url).set(admin.auth).send({ minWeightKg: 30 })).status).toBe(400);
    const cleared = await api().patch(url).set(admin.auth).send({ maxWeightKg: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.standard.maxWeightKg).toBeUndefined();
    expect(cleared.body.standard.minWeightKg).toBe(10);
    // Removing the last bound of a weight criterion is refused.
    expect((await api().patch(url).set(admin.auth).send({ minWeightKg: null })).status).toBe(400);
    // Type and kind cannot be changed.
    expect((await api().patch(url).set(admin.auth).send({ kind: 'sale_age' })).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('growth tracking against the criteria (farm side)', () => {
  it('records height/length/body condition, evaluates each measurement, alerts on the latest and shows age windows', async () => {
    const typeId = await newType();
    for (const body of [
      {
        kind: 'weight_for_age',
        ageFromDays: 0,
        ageToDays: 60,
        minWeightKg: 20,
        maxWeightKg: 40,
        minHeightCm: 60,
        maxHeightCm: 80,
      },
      { kind: 'weight_for_age', ageFromDays: 60, ageToDays: 400, minWeightKg: 50 },
      { kind: 'sale_age', ageFromDays: 300, ageToDays: 600 },
      { kind: 'breeding_age', ageFromDays: 50, ageToDays: 1000 },
    ])
      expect((await post(admin, { animalTypeId: typeId, source: SYSTEM, ...body })).status).toBe(
        201,
      );

    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner, 'Growth Farm');
    const calf = await mkAnimal(h.app, owner, farmId, {
      animalTypeId: typeId,
      sex: 'female',
      birthDate: daysAgo(100),
    });
    const weigh = (body: object) =>
      api()
        .post(V(`/farms/${farmId}/weights`))
        .set(owner.auth)
        .send({ animalId: calf.id, ...body });
    const w1 = await weigh({
      weighedOn: daysAgo(90),
      weightKg: 30,
      heightCm: 70,
      bodyCondition: 'Good coat',
    });
    expect(w1.status, JSON.stringify(w1.body)).toBe(201);
    expect(w1.body.record).toMatchObject({ heightCm: 70, bodyCondition: 'Good coat' });
    expect((await weigh({ weighedOn: daysAgo(70), weightKg: 18, heightCm: 85 })).status).toBe(201);
    expect((await weigh({ weighedOn: daysAgo(2), weightKg: 45, lengthCm: 120 })).status).toBe(201);

    const res = await api()
      .get(V(`/farms/${farmId}/animals/${calf.id}/growth`))
      .set(owner.auth);
    expect(res.status).toBe(200);
    expect(res.body.age).toMatchObject({ estimated: false, days: 100 });
    const [p1, p2, p3] = res.body.points;
    expect(p1).toMatchObject({ ageDays: 10, heightCm: 70, evaluation: { status: 'within' } });
    expect(p2.evaluation).toMatchObject({
      status: 'below',
      metrics: { weight: { status: 'below' }, height: { status: 'above', max: 80 } },
    });
    expect(p3).toMatchObject({ ageDays: 98, lengthCm: 120, evaluation: { status: 'below' } });
    expect(res.body.alerts).toEqual([
      {
        code: 'LATEST_BELOW_STANDARD',
        metric: 'weight',
        date: daysAgo(2),
        value: 45,
        min: 50,
        ageEstimated: false,
      },
    ]);
    expect(res.body.standards).toHaveLength(2);
    expect(res.body.windows.breeding.status).toBe('within');
    expect(res.body.windows.sale.status).toBe('before');

    // The farm summary counts the animal as outside its criterion.
    const summary = await api()
      .get(V(`/farms/${farmId}/summary`))
      .set(owner.auth);
    expect(summary.body.totals.outsideStandard).toBe(1);

    // Height can be corrected like any other field (with a reason, kept in history).
    const fix = await api()
      .post(V(`/farms/${farmId}/weights/${w1.body.record.id}/corrections`))
      .set(owner.auth)
      .send({ reason: 'tape misread', changes: { heightCm: 72 } });
    expect(fix.status, JSON.stringify(fix.body)).toBe(200);
    expect(fix.body.record.heightCm).toBe(72);
  });

  it('without a birth date nothing is judged; estimated birth dates are flagged', async () => {
    const typeId = await newType();
    await post(admin, {
      animalTypeId: typeId,
      kind: 'weight_for_age',
      ageFromDays: 0,
      ageToDays: 1000,
      minWeightKg: 100,
      source: SYSTEM,
    });
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner, 'Unknown Age Farm');
    const unknown = await mkAnimal(h.app, owner, farmId, { animalTypeId: typeId, sex: 'male' });
    const guessed = await mkAnimal(h.app, owner, farmId, {
      animalTypeId: typeId,
      sex: 'male',
      birthDate: daysAgo(200),
      birthDateEstimated: true,
    });
    for (const a of [unknown, guessed])
      await api()
        .post(V(`/farms/${farmId}/weights`))
        .set(owner.auth)
        .send({ animalId: a.id, weighedOn: daysAgo(1), weightKg: 10 })
        .expect(201);
    const u = await api()
      .get(V(`/farms/${farmId}/animals/${unknown.id}/growth`))
      .set(owner.auth);
    expect(u.body.points[0].evaluation.status).toBe('no_age');
    expect(u.body.alerts).toEqual([]);
    expect(u.body.age.days).toBeUndefined();
    const g = await api()
      .get(V(`/farms/${farmId}/animals/${guessed.id}/growth`))
      .set(owner.auth);
    expect(g.body.age.estimated).toBe(true);
    expect(g.body.points[0].evaluation).toMatchObject({ status: 'below', ageEstimated: true });
    expect(g.body.alerts[0].ageEstimated).toBe(true);
  });

  it('growth data stays farm-private: strangers 404, members without records.read cannot see it', async () => {
    const typeId = await newType();
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner, 'Private Growth Farm');
    const a = await mkAnimal(h.app, owner, farmId, { animalTypeId: typeId, sex: 'male' });
    const stranger = await createFarmer(h.app);
    expect(
      (
        await api()
          .get(V(`/farms/${farmId}/animals/${a.id}/growth`))
          .set(stranger.auth)
      ).status,
    ).toBe(404);
    const viewer = await createUser(h.app);
    await addFarmMember(h.app, owner, farmId, viewer, 'viewer');
    // Viewers hold records.read (read-only) — they may look but not record.
    expect(
      (
        await api()
          .get(V(`/farms/${farmId}/animals/${a.id}/growth`))
          .set(viewer.auth)
      ).status,
    ).toBe(200);
    expect(
      (
        await api()
          .post(V(`/farms/${farmId}/weights`))
          .set(viewer.auth)
          .send({ animalId: a.id, weighedOn: daysAgo(1), weightKg: 10, heightCm: 50 })
      ).status,
    ).toBe(403);
  });
});
