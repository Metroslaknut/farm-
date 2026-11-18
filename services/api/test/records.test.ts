import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog, FarmExpense, HealthRecord } from '../src/models';
import {
  addFarmMember,
  createFarmer,
  createStaff,
  createStaffWithPermissions,
  daysAgo,
  daysAhead,
  makeFarm,
  mkAnimal,
  setupFarm,
  startHarness,
  type FarmSetup,
  type Session,
  type Staff,
  type TestHarness,
} from './helpers';

let h: TestHarness;
let f: FarmSetup;
let root: Staff;
let cow: { id: string; animalCode: string };
let bull: { id: string; animalCode: string };

beforeAll(async () => {
  h = await startHarness();
  root = await createStaff(h.app, ['super_admin']);
  f = await setupFarm(h.app);
  cow = await mkAnimal(h.app, f.owner, f.farmId, {
    animalCode: 'COW-1',
    animalTypeId: f.buffalo,
    sex: 'female',
    birthDate: daysAgo(900),
    name: 'Bua',
  });
  bull = await mkAnimal(h.app, f.owner, f.farmId, {
    animalCode: 'BULL-1',
    animalTypeId: f.buffalo,
    sex: 'male',
    birthDate: daysAgo(1200),
  });
});
afterAll(() => h.stop());

const api = () => request(h.app);
const V = (p: string) => `/api/v1/farms/${f.farmId}${p}`;
const post = (p: string, who: Session, body: object = {}) =>
  api().post(V(p)).set(who.auth).send(body);
const get = (p: string, who: Session = f.owner) => api().get(V(p)).set(who.auth);
const ID = '0123456789abcdef01234567';

// ---------------------------------------------------------------------------
describe('authentication and farm scoping', () => {
  const endpoints = ['health', 'weights', 'feeding', 'expenses', 'breeding'];
  it.each(endpoints)('/%s requires a signed-in user', async (kind) => {
    for (const res of [
      await api().get(V(`/${kind}`)),
      await api()
        .post(V(`/${kind}`))
        .send({}),
      await api().get(V(`/${kind}/${ID}`)),
      await api()
        .post(V(`/${kind}/${ID}/corrections`))
        .send({}),
      await api()
        .post(V(`/${kind}/${ID}/void`))
        .send({}),
    ]) {
      expect(res.status).toBe(401);
    }
    expect((await api().get(V(`/animals/${ID}/history`))).status).toBe(401);
    expect((await api().get(V(`/animals/${ID}/growth`))).status).toBe(401);
    expect((await api().get(V(`/animals/${ID}/lineage`))).status).toBe(401);
  });

  it('strangers get 404 on every records endpoint (farm ids cannot be probed)', async () => {
    const stranger = await createFarmer(h.app);
    for (const kind of endpoints) {
      expect((await get(`/${kind}`, stranger)).status, kind).toBe(404);
      expect((await post(`/${kind}`, stranger, {})).status, kind).toBe(404);
    }
    expect((await get(`/animals/${cow.id}/history`, stranger)).status).toBe(404);
  });

  it('a record id from another farm is 404 through this farm (IDOR)', async () => {
    const other = await createFarmer(h.app);
    const otherFarm = await makeFarm(h.app, other, 'Other');
    const otherAnimal = await mkAnimal(h.app, other, otherFarm, {
      animalTypeId: f.buffalo,
      sex: 'male',
    });
    const created = await api()
      .post(`/api/v1/farms/${otherFarm}/health`)
      .set(other.auth)
      .send({
        animalId: otherAnimal.id,
        type: 'checkup',
        recordedOn: daysAgo(1),
        title: 'Routine check',
      });
    expect(created.status).toBe(201);
    const rid = created.body.record.id;
    expect((await get(`/health/${rid}`)).status).toBe(404);
    expect(
      (
        await post(`/health/${rid}/corrections`, f.owner, {
          reason: 'nope nope',
          changes: { title: 'Hijacked' },
        })
      ).status,
    ).toBe(404);
    expect((await post(`/health/${rid}/void`, f.owner, { reason: 'nope nope' })).status).toBe(404);
    // and an animal of the other farm cannot be referenced from this one
    const res = await post('/health', f.owner, {
      animalId: otherAnimal.id,
      type: 'checkup',
      recordedOn: daysAgo(1),
      title: 'Cross farm',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('animalId');
  });

  it('roles: viewer reads; worker writes but cannot correct; manager corrects; expenses are owner/manager only', async () => {
    const body = { animalId: cow.id, type: 'checkup', recordedOn: daysAgo(2), title: 'Role check' };
    expect((await post('/health', f.viewer, body)).status).toBe(403);
    const mine = await post('/health', f.worker, body);
    expect(mine.status).toBe(201);
    const rid = mine.body.record.id;
    for (const who of [f.viewer, f.worker, f.manager, f.owner])
      expect((await get(`/health/${rid}`, who)).status).toBe(200);
    const change = { reason: 'Fixing the title', changes: { title: 'Role check 2' } };
    expect((await post(`/health/${rid}/corrections`, f.worker, change)).status).toBe(403);
    expect((await post(`/health/${rid}/void`, f.worker, { reason: 'mistake' })).status).toBe(403);
    expect((await post(`/health/${rid}/corrections`, f.manager, change)).status).toBe(200);

    const exp = {
      category: 'feed',
      expenseDate: daysAgo(1),
      amount: 100,
      description: 'Hay bales',
    };
    for (const who of [f.viewer, f.worker]) {
      expect((await post('/expenses', who, exp)).status).toBe(403);
      expect((await get('/expenses', who)).status).toBe(403);
      expect((await get('/expenses/summary', who)).status).toBe(403);
    }
    const made = await post('/expenses', f.manager, exp);
    expect(made.status).toBe(201);
    // Money is protected by id too: reading, correcting, voiding or attaching to a single expense.
    const eid = made.body.record.id;
    for (const who of [f.viewer, f.worker]) {
      expect((await get(`/expenses/${eid}`, who)).status).toBe(403);
      expect(
        (
          await post(`/expenses/${eid}/corrections`, who, {
            reason: 'Trying it',
            changes: { amount: 1 },
          })
        ).status,
      ).toBe(403);
      expect((await post(`/expenses/${eid}/void`, who, { reason: 'Trying it' })).status).toBe(403);
      expect(
        (
          await post(`/expenses/${eid}/attachments`, who, {
            kind: 'document',
            url: 'https://cdn.example.test/r.pdf',
          })
        ).status,
      ).toBe(403);
    }
    expect((await get(`/expenses/${eid}`, f.manager)).status).toBe(200);
    expect((await get(`/animals/${cow.id}/history?types=expense`, f.worker)).body.items).toEqual(
      [],
    );
  });

  it('platform staff with farms.read can read records but never expenses; farms.manage can also write', async () => {
    const reader = await createStaffWithPermissions(h.app, root, ['farms.read']);
    const manager = await createStaffWithPermissions(h.app, root, ['farms.manage']);
    expect((await get('/health', reader)).status).toBe(200);
    expect((await get('/breeding', reader)).status).toBe(200);
    expect((await get('/expenses', reader)).status).toBe(403);
    expect(
      (
        await post('/health', reader, {
          animalId: cow.id,
          type: 'checkup',
          recordedOn: daysAgo(1),
          title: 'Staff entry',
        })
      ).status,
    ).toBe(403);
    expect((await get('/expenses', manager)).status).toBe(200);
    expect(
      (
        await post('/health', manager, {
          animalId: cow.id,
          type: 'checkup',
          recordedOn: daysAgo(1),
          title: 'Staff entry',
        })
      ).status,
    ).toBe(201);
  });

  it('archived farms are read-only for records', async () => {
    const o = await createFarmer(h.app);
    const fid = await makeFarm(h.app, o, 'Soon archived');
    const a = await mkAnimal(h.app, o, fid, { animalTypeId: f.buffalo, sex: 'male' });
    const created = await api()
      .post(`/api/v1/farms/${fid}/weights`)
      .set(o.auth)
      .send({ animalId: a.id, weighedOn: daysAgo(1), weightKg: 300 });
    await api().post(`/api/v1/farms/${fid}/archive`).set(o.auth).expect(200);
    expect(
      (
        await api()
          .post(`/api/v1/farms/${fid}/weights`)
          .set(o.auth)
          .send({ animalId: a.id, weighedOn: daysAgo(1), weightKg: 310 })
      ).body.error.code,
    ).toBe('FARM_ARCHIVED');
    expect(
      (
        await api()
          .post(`/api/v1/farms/${fid}/weights/${created.body.record.id}/void`)
          .set(o.auth)
          .send({ reason: 'no longer' })
      ).status,
    ).toBe(409);
    expect((await api().get(`/api/v1/farms/${fid}/weights`).set(o.auth)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe('health records: a log of what people report — no diagnosis, no advice', () => {
  const base = () => ({
    animalId: cow.id,
    type: 'illness',
    recordedOn: daysAgo(5),
    title: 'Not eating since morning',
  });

  it('records an illness with who said what', async () => {
    const res = await post('/health', f.worker, {
      ...base(),
      symptoms: 'Lethargic, reduced appetite',
      condition: 'Foot rot',
      conditionStatedBy: 'veterinarian',
      severity: 'moderate',
      veterinarian: { name: 'Dr. Somsri', clinic: 'Khon Kaen Vet' },
    });
    expect(res.status).toBe(201);
    expect(res.body.record).toMatchObject({
      type: 'illness',
      title: 'Not eating since morning',
      condition: 'Foot rot',
      conditionStatedBy: 'veterinarian',
      severity: 'moderate',
      animal: { id: cow.id, animalCode: 'COW-1' },
      revision: 1,
      createdBy: { displayName: 'Test User' },
    });
    expect(res.body.record.createdBy.id).toBe(f.worker.id);
  });

  it('treatments and vaccinations need provenance and the right details', async () => {
    const ok = await post('/health', f.manager, {
      ...base(),
      type: 'treatment',
      title: 'Wound cleaned',
      medication: { name: 'Product X', dosage: '5 ml', batchNumber: 'B12' },
      prescribedBy: 'veterinarian',
      withdrawalEndsOn: daysAhead(10),
    });
    expect(ok.status).toBe(201);
    expect(ok.body.record).toMatchObject({
      medication: { name: 'Product X', dosage: '5 ml' },
      prescribedBy: 'veterinarian',
      withdrawalEndsOn: daysAhead(10),
    });
    const vacc = await post('/health', f.manager, {
      ...base(),
      type: 'vaccination',
      title: 'Annual',
      vaccine: { name: 'FMD', batchNumber: 'V1', manufacturer: 'Acme' },
      nextDueOn: daysAhead(180),
    });
    expect(vacc.status).toBe(201);
    expect(vacc.body.record.nextDueOn).toBe(daysAhead(180));
  });

  it.each([
    ['vaccination without a vaccine', { type: 'vaccination' }, 'vaccine.name'],
    [
      'vaccine details on a non-vaccination',
      { type: 'illness', vaccine: { name: 'FMD' } },
      'vaccine.name',
    ],
    ['condition without who stated it', { condition: 'Mastitis' }, 'conditionStatedBy'],
    ['"stated by" without a condition', { conditionStatedBy: 'farmer' }, 'condition'],
    [
      'medication without who prescribed it',
      { type: 'treatment', medication: { name: 'X' } },
      'prescribedBy',
    ],
    [
      '"prescribed by" without a medication',
      { type: 'treatment', prescribedBy: 'farmer' },
      'medication.name',
    ],
    ['recovery without an outcome', { type: 'recovery' }, 'outcome'],
    ['outcome on a non-recovery', { outcome: 'recovered' }, 'outcome'],
    ['future date', { recordedOn: daysAhead(2) }, 'recordedOn'],
    [
      'next due before the record date',
      { type: 'vaccination', vaccine: { name: 'FMD' }, nextDueOn: daysAgo(30) },
      'nextDueOn',
    ],
    [
      'withdrawal ending before the record date',
      {
        type: 'treatment',
        medication: { name: 'X' },
        prescribedBy: 'farmer',
        withdrawalEndsOn: daysAgo(30),
      },
      'withdrawalEndsOn',
    ],
    ['dated before the animal was born', { recordedOn: daysAgo(2000) }, 'recordedOn'],
    ['unknown severity', { severity: 'catastrophic' }, 'severity'],
    ['empty title', { title: ' ' }, 'title'],
  ])('rejects %s', async (_name, extra, path) => {
    const res = await post('/health', f.manager, { ...base(), ...extra });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
  });

  it('has no fields or endpoints for diagnosing or recommending anything', async () => {
    for (const extra of [
      { diagnosis: 'Anthrax' },
      { suggestedTreatment: 'Penicillin' },
      { recommendedDose: '10 ml' },
      { aiAssessment: 'x' },
    ]) {
      expect(
        (await post('/health', f.manager, { ...base(), ...extra })).status,
        JSON.stringify(extra),
      ).toBe(400);
    }
    for (const path of [
      '/health/diagnose',
      '/health/suggest',
      '/health/recommendations',
      `/animals/${cow.id}/diagnosis`,
    ]) {
      expect((await get(path)).status, path).toBe(404);
    }
    expect(await HealthRecord.countDocuments({ condition: 'Anthrax' })).toBe(0);
  });

  it('links a recovery to the illness it concludes; the link must be a live record of the same animal', async () => {
    const ill = (await post('/health', f.manager, base())).body.record;
    const ok = await post('/health', f.manager, {
      animalId: cow.id,
      type: 'recovery',
      recordedOn: daysAgo(1),
      title: 'Eating normally again',
      outcome: 'recovered',
      relatedRecordId: ill.id,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.record.relatedRecordId).toBe(ill.id);
    const otherAnimal = (
      await post('/health', f.manager, {
        animalId: bull.id,
        type: 'checkup',
        recordedOn: daysAgo(1),
        title: 'Bull check',
      })
    ).body.record;
    const wrong = await post('/health', f.manager, {
      animalId: cow.id,
      type: 'recovery',
      recordedOn: daysAgo(1),
      title: 'x1',
      outcome: 'recovered',
      relatedRecordId: otherAnimal.id,
    });
    expect(wrong.status).toBe(400);
    expect(
      (
        await post('/health', f.manager, {
          animalId: cow.id,
          type: 'recovery',
          recordedOn: daysAgo(1),
          title: 'x2',
          outcome: 'recovered',
          relatedRecordId: ID,
        })
      ).status,
    ).toBe(400);
    await post(`/health/${ill.id}/void`, f.manager, {
      reason: 'Entered for the wrong animal',
    }).expect(200);
    expect(
      (
        await post('/health', f.manager, {
          animalId: cow.id,
          type: 'recovery',
          recordedOn: daysAgo(1),
          title: 'x3',
          outcome: 'recovered',
          relatedRecordId: ill.id,
        })
      ).status,
    ).toBe(400);
  });

  it('archived animals are frozen', async () => {
    const a = await mkAnimal(h.app, f.owner, f.farmId, { animalTypeId: f.buffalo, sex: 'male' });
    await api()
      .post(V(`/animals/${a.id}/archive`))
      .set(f.owner.auth)
      .send({})
      .expect(200);
    const res = await post('/health', f.manager, {
      animalId: a.id,
      type: 'checkup',
      recordedOn: daysAgo(1),
      title: 'After archive',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ANIMAL_ARCHIVED');
  });

  it('lists with filters, search and pagination; voided records are hidden unless asked for', async () => {
    const o = await createFarmer(h.app);
    const fid = await makeFarm(h.app, o, 'List Farm');
    const a = await mkAnimal(h.app, o, fid, { animalTypeId: f.buffalo, sex: 'female' });
    const b = await mkAnimal(h.app, o, fid, { animalTypeId: f.buffalo, sex: 'male' });
    const mk = (body: object) =>
      api()
        .post(`/api/v1/farms/${fid}/health`)
        .set(o.auth)
        .send(body)
        .expect(201)
        .then((r) => r.body.record);
    const first = await mk({
      animalId: a.id,
      type: 'checkup',
      recordedOn: daysAgo(30),
      title: 'Check A',
    });
    await mk({
      animalId: a.id,
      type: 'vaccination',
      recordedOn: daysAgo(20),
      title: 'Shot',
      vaccine: { name: 'FMD' },
    });
    await mk({ animalId: b.id, type: 'illness', recordedOn: daysAgo(10), title: 'Cough B' });
    await mk({ animalId: b.id, type: 'checkup', recordedOn: daysAgo(5), title: 'Check B' });
    const list = (qs = '') =>
      api()
        .get(`/api/v1/farms/${fid}/health?${qs}`)
        .set(o.auth)
        .then((r) => r.body);
    expect((await list()).total).toBe(4);
    expect((await list('animalId=' + a.id)).total).toBe(2);
    expect((await list('type=checkup')).total).toBe(2);
    expect((await list('q=fmd')).total).toBe(1);
    expect((await list(`from=${daysAgo(12)}`)).total).toBe(2);
    expect((await list(`to=${daysAgo(25)}`)).total).toBe(1);
    const p1 = await list('pageSize=3&order=asc');
    expect(p1.items.map((i: { title: string }) => i.title)).toEqual(['Check A', 'Shot', 'Cough B']);
    expect((await list('pageSize=3&page=2')).items).toHaveLength(1);
    for (const bad of [
      'pageSize=0',
      'pageSize=101',
      'type=cancer',
      'sortBy=password',
      'from=yesterday',
      'animalId=x',
    ]) {
      expect((await api().get(`/api/v1/farms/${fid}/health?${bad}`).set(o.auth)).status, bad).toBe(
        400,
      );
    }
    await api()
      .post(`/api/v1/farms/${fid}/health/${first.id}/void`)
      .set(o.auth)
      .send({ reason: 'Duplicate entry' })
      .expect(200);
    expect((await list()).total).toBe(3);
    expect((await list('includeVoided=true')).total).toBe(4);
  });
});

// ---------------------------------------------------------------------------
describe('weights and growth', () => {
  let heifer: { id: string };
  beforeAll(async () => {
    heifer = await mkAnimal(h.app, f.owner, f.farmId, {
      animalCode: 'HEIFER-1',
      animalTypeId: f.buffalo,
      sex: 'female',
      birthDate: daysAgo(400),
    });
  });
  const weigh = (body: object, who: Session = f.worker) =>
    post('/weights', who, { animalId: heifer.id, ...body });

  it('validates weights and dates', async () => {
    for (const [body, path] of [
      [{ weighedOn: daysAgo(10), weightKg: 0 }, 'weightKg'],
      [{ weighedOn: daysAgo(10), weightKg: -5 }, 'weightKg'],
      [{ weighedOn: daysAgo(10), weightKg: 300.123 }, 'weightKg'],
      [{ weighedOn: daysAgo(10), weightKg: 999999 }, 'weightKg'],
      [{ weighedOn: daysAgo(10), weightKg: '300' }, 'weightKg'],
      [{ weighedOn: daysAhead(1), weightKg: 300 }, 'weighedOn'],
      [{ weighedOn: daysAgo(900), weightKg: 300 }, 'weighedOn'],
      [{ weighedOn: daysAgo(10), weightKg: 300, method: 'guess' }, 'method'],
    ] as [object, string][]) {
      const res = await weigh(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
    }
  });

  it('computes growth between weighings with plain arithmetic, ignoring voided records', async () => {
    const a = (await weigh({ weighedOn: daysAgo(100), weightKg: 200 })).body.record;
    await weigh({ weighedOn: daysAgo(70), weightKg: 230.5 }).then((r) =>
      expect(r.status).toBe(201),
    );
    const mistaken = (await weigh({ weighedOn: daysAgo(50), weightKg: 900 })).body.record;
    await weigh({ weighedOn: daysAgo(10), weightKg: 290, method: 'tape_estimate' }).then((r) =>
      expect(r.status).toBe(201),
    );
    await post(`/weights/${mistaken.id}/void`, f.manager, {
      reason: 'Typed 900 instead of 250',
    }).expect(200);
    expect(a.id).toBeTruthy();

    const g = (await get(`/animals/${heifer.id}/growth`, f.viewer)).body;
    expect(g.animal.animalCode).toBe('HEIFER-1');
    expect(g.points.map((p: { weightKg: number }) => p.weightKg)).toEqual([200, 230.5, 290]);
    expect(g.points[0]).not.toHaveProperty('changeKg');
    expect(g.points[1]).toMatchObject({
      daysSincePrevious: 30,
      changeKg: 30.5,
      gainKgPerDay: 1.017,
    });
    expect(g.points[2]).toMatchObject({
      daysSincePrevious: 60,
      changeKg: 59.5,
      gainKgPerDay: 0.992,
    });
    expect(g.summary).toMatchObject({
      count: 3,
      firstKg: 200,
      latestKg: 290,
      totalChangeKg: 90,
      averageGainKgPerDay: 1,
    });
    expect(g.maxWeightKg).toBeNull();
    expect(JSON.stringify(g)).not.toMatch(/healthy|underweight|abnormal|recommend/i);
  });

  it('rejects an identical weighing twice, but allows two different weights on the same day', async () => {
    await weigh({ weighedOn: daysAgo(3), weightKg: 280 }).then((r) => expect(r.status).toBe(201));
    const dup = await weigh({ weighedOn: daysAgo(3), weightKg: 280 });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_RECORD');
    expect((await weigh({ weighedOn: daysAgo(3), weightKg: 281 })).status).toBe(201);
  });

  it('enforces a species maximum ONLY when an administrator configured one', async () => {
    const goat = await createFarmer(h.app);
    const fid = await makeFarm(h.app, goat, 'Goat Farm');
    const types = (await api().get('/api/v1/animal-types').set(goat.auth)).body.animalTypes;
    const goatType = types.find((t: { key: string }) => t.key === 'goat');
    expect(goatType.maxWeightKg).toBeUndefined(); // nothing is shipped with the system
    const a = await mkAnimal(h.app, goat, fid, { animalTypeId: goatType.id, sex: 'male' });
    const w = (kg: number) =>
      api()
        .post(`/api/v1/farms/${fid}/weights`)
        .set(goat.auth)
        .send({ animalId: a.id, weighedOn: daysAgo(1), weightKg: kg });
    expect((await w(450)).status).toBe(201); // unconfigured: accepted

    const admin = await createStaff(h.app, ['admin']);
    await api()
      .patch(`/api/v1/animal-types/${goatType.id}`)
      .set(admin.auth)
      .send({ maxWeightKg: 200 })
      .expect(200);
    const refused = await w(300);
    expect(refused.status).toBe(400);
    expect(refused.body.error.details[0]).toMatchObject({ path: 'weightKg' });
    expect(refused.body.error.details[0].message).toContain('200 kg');
    expect(
      (await api().get('/api/v1/animal-types').set(goat.auth)).body.animalTypes.find(
        (t: { key: string }) => t.key === 'goat',
      ).maxWeightKg,
    ).toBe(200);
    expect(
      (await api().get(`/api/v1/farms/${fid}/animals/${a.id}/growth`).set(goat.auth)).body
        .maxWeightKg,
    ).toBe(200);
    expect(
      (
        await api()
          .patch(`/api/v1/animal-types/${goatType.id}`)
          .set(goat.auth)
          .send({ maxWeightKg: 1 })
      ).status,
    ).toBe(403);
    await api()
      .patch(`/api/v1/animal-types/${goatType.id}`)
      .set(admin.auth)
      .send({ maxWeightKg: null })
      .expect(200);
    expect((await w(300)).status).toBe(201);
    expect(
      (
        await api()
          .patch(`/api/v1/animal-types/${goatType.id}`)
          .set(admin.auth)
          .send({ gestationDays: 0 })
      ).status,
    ).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('feeding logs and schedules', () => {
  const feed = (body: object, who: Session = f.worker) => post('/feeding', who, body);
  const qty = { amount: 2.5, unit: 'kg' };

  it('records a log for an animal, a group, or the whole farm', async () => {
    const forAnimal = await feed({
      kind: 'log',
      animalId: cow.id,
      date: daysAgo(1),
      feedName: 'Napier grass',
      category: 'roughage',
      quantity: qty,
    });
    expect(forAnimal.status).toBe(201);
    expect(forAnimal.body.record).toMatchObject({
      kind: 'log',
      feedName: 'Napier grass',
      animal: { animalCode: 'COW-1' },
      quantity: { amount: 2.5, unit: 'kg' },
    });
    const group = await feed({
      kind: 'log',
      groupLabel: 'Calf pen',
      date: daysAgo(1),
      feedName: 'Milk replacer',
      category: 'supplement',
      quantity: { amount: 8, unit: 'l' },
    });
    expect(group.body.record).toMatchObject({ groupLabel: 'Calf pen' });
    expect(group.body.record.animal).toBeUndefined();
    expect(
      (await feed({ kind: 'log', date: daysAgo(1), feedName: 'Rice straw', quantity: qty })).status,
    ).toBe(201);
  });

  it('schedules carry a routine and know whether they are running', async () => {
    const s = await feed({
      kind: 'schedule',
      animalId: cow.id,
      date: daysAgo(10),
      feedName: 'Concentrate',
      category: 'concentrate',
      quantity: { amount: 1.5, unit: 'kg' },
      frequencyPerDay: 2,
      timesOfDay: ['06:30', '17:00'],
    });
    expect(s.status).toBe(201);
    expect(s.body.record).toMatchObject({
      kind: 'schedule',
      frequencyPerDay: 2,
      timesOfDay: ['06:30', '17:00'],
      active: true,
    });
    const ended = await feed({
      kind: 'schedule',
      animalId: cow.id,
      date: daysAgo(30),
      endDate: daysAgo(20),
      feedName: 'Starter',
      quantity: qty,
    });
    expect(ended.body.record.active).toBe(false);
    const future = await feed({
      kind: 'schedule',
      date: daysAhead(5),
      feedName: 'Planned',
      quantity: qty,
    });
    expect(future.body.record.active).toBe(false);

    const running = await get('/feeding?kind=schedule&active=true');
    expect(running.body.items.map((i: { feedName: string }) => i.feedName)).toContain(
      'Concentrate',
    );
    expect(running.body.items.map((i: { feedName: string }) => i.feedName)).not.toContain(
      'Starter',
    );
    const notRunning = await get('/feeding?kind=schedule&active=false');
    expect(notRunning.body.items.map((i: { feedName: string }) => i.feedName)).toEqual(
      expect.arrayContaining(['Starter', 'Planned']),
    );
  });

  it.each([
    ['both an animal and a group', { animalId: 'A', groupLabel: 'Pen 1' }, 'groupLabel'],
    ['a future log', { date: daysAhead(1) }, 'date'],
    ['a log with a schedule field', { frequencyPerDay: 2 }, 'frequencyPerDay'],
    ['a log with an end date', { endDate: daysAgo(0) }, 'endDate'],
    ['zero quantity', { quantity: { amount: 0, unit: 'kg' } }, 'quantity.amount'],
    ['an unknown unit', { quantity: { amount: 1, unit: 'bucket' } }, 'quantity.unit'],
    ['no feed name', { feedName: '' }, 'feedName'],
    ['unknown category', { category: 'candy' }, 'category'],
  ])('rejects %s', async (_n, extra, path) => {
    const body = {
      kind: 'log',
      date: daysAgo(1),
      feedName: 'Hay',
      category: 'roughage',
      quantity: qty,
      ...extra,
    };
    if ((extra as { animalId?: string }).animalId === 'A')
      (body as { animalId: string }).animalId = cow.id;
    const res = await feed(body);
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
  });

  it.each([
    ['end before start', { date: daysAgo(5), endDate: daysAgo(9) }, 'endDate'],
    [
      'times that do not match the frequency',
      { frequencyPerDay: 3, timesOfDay: ['06:00'] },
      'timesOfDay',
    ],
    ['a malformed time', { timesOfDay: ['6am'] }, 'timesOfDay.0'],
    ['25 feedings a day', { frequencyPerDay: 25 }, 'frequencyPerDay'],
  ])('rejects a schedule with %s', async (_n, extra, path) => {
    const res = await feed({
      kind: 'schedule',
      date: daysAgo(5),
      feedName: 'Hay',
      quantity: qty,
      ...extra,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
  });

  it('a schedule is ended by a correction, which keeps the original in the history', async () => {
    const s = (
      await feed({
        kind: 'schedule',
        animalId: cow.id,
        date: daysAgo(40),
        feedName: 'Mineral lick',
        quantity: qty,
      })
    ).body.record;
    expect(s.active).toBe(true);
    const fixed = await post(`/feeding/${s.id}/corrections`, f.manager, {
      reason: 'Switched to a new product',
      changes: { endDate: daysAgo(1) },
    });
    expect(fixed.status).toBe(200);
    expect(fixed.body.record.active).toBe(false);
    expect(fixed.body.record.history[0].changes).toEqual([
      { field: 'endDate', from: null, to: daysAgo(1) },
    ]);
  });
});

// ---------------------------------------------------------------------------
describe('expenses: exact money', () => {
  const spend = (body: object, who: Session = f.manager) => post('/expenses', who, body);

  it('stores integer satang and sums without float drift', async () => {
    const o = await createFarmer(h.app);
    const fid = await makeFarm(h.app, o, 'Money Farm');
    const add = (amount: number, category = 'feed', date = daysAgo(1)) =>
      api()
        .post(`/api/v1/farms/${fid}/expenses`)
        .set(o.auth)
        .send({ category, expenseDate: date, amount, description: `Item ${amount}` });
    await add(0.1).then((r) => expect(r.status).toBe(201));
    await add(0.2).then((r) => expect(r.status).toBe(201));
    await add(1234.56, 'medication').then((r) => expect(r.status).toBe(201));
    const stored = await FarmExpense.find({ farmId: fid }).sort({ amountMinor: 1 });
    expect(stored.map((e) => e.amountMinor)).toEqual([10, 20, 123456]);
    expect(stored.every((e) => Number.isInteger(e.amountMinor))).toBe(true);
    const s = (await api().get(`/api/v1/farms/${fid}/expenses/summary`).set(o.auth)).body.summary;
    expect(s.total).toBe(1234.86);
    expect(s.count).toBe(3);
    expect(s.byCategory).toEqual([
      { category: 'feed', total: 0.3, count: 2 },
      { category: 'medication', total: 1234.56, count: 1 },
    ]);
    expect(0.1 + 0.2).not.toBe(0.3); // the trap this avoids
  });

  it.each([
    ['zero', { amount: 0 }, 'amount'],
    ['negative', { amount: -5 }, 'amount'],
    ['three decimals', { amount: 10.005 }, 'amount'],
    ['absurdly large', { amount: 1e12 }, 'amount'],
    ['a string', { amount: '100' }, 'amount'],
    ['an unknown category', { category: 'gambling' }, 'category'],
    ['a future date', { expenseDate: daysAhead(1) }, 'expenseDate'],
    ['no description', { description: '' }, 'description'],
    ['an animal from nowhere', { animalId: ID }, 'animalId'],
  ])('rejects %s', async (_n, extra, path) => {
    const res = await spend({
      category: 'feed',
      expenseDate: daysAgo(1),
      amount: 100,
      description: 'Hay',
      ...extra,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
  });

  it('attributes cost to an animal or to a health/feeding record, and summarises by month and animal', async () => {
    const o = await createFarmer(h.app);
    const fid = await makeFarm(h.app, o, 'Cost Farm');
    const a = await mkAnimal(h.app, o, fid, { animalTypeId: f.buffalo, sex: 'female' });
    const b = await mkAnimal(h.app, o, fid, { animalTypeId: f.buffalo, sex: 'male' });
    const treat = (
      await api()
        .post(`/api/v1/farms/${fid}/health`)
        .set(o.auth)
        .send({
          animalId: a.id,
          type: 'treatment',
          recordedOn: daysAgo(3),
          title: 'Treated',
          medication: { name: 'Product X' },
          prescribedBy: 'veterinarian',
        })
    ).body.record;
    const ex = (body: object) => api().post(`/api/v1/farms/${fid}/expenses`).set(o.auth).send(body);
    const linked = await ex({
      category: 'medication',
      expenseDate: daysAgo(3),
      amount: 450,
      description: 'Product X',
      animalId: a.id,
      related: { kind: 'health', id: treat.id },
    });
    expect(linked.status).toBe(201);
    expect(linked.body.record).toMatchObject({
      amount: 450,
      currency: 'THB',
      animal: { id: a.id },
      related: { kind: 'health', id: treat.id },
    });
    expect(
      (
        await ex({
          category: 'medication',
          expenseDate: daysAgo(3),
          amount: 1,
          description: 'wrong animal',
          animalId: b.id,
          related: { kind: 'health', id: treat.id },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await ex({
          category: 'medication',
          expenseDate: daysAgo(3),
          amount: 1,
          description: 'missing',
          related: { kind: 'health', id: ID },
        })
      ).status,
    ).toBe(400);
    await ex({
      category: 'feed',
      expenseDate: daysAgo(40),
      amount: 1000,
      description: 'Old feed',
      animalId: a.id,
    }).then((r) => expect(r.status).toBe(201));
    await ex({
      category: 'feed',
      expenseDate: daysAgo(2),
      amount: 200,
      description: 'Feed for b',
      animalId: b.id,
    }).then((r) => expect(r.status).toBe(201));

    const all = (await api().get(`/api/v1/farms/${fid}/expenses/summary`).set(o.auth)).body.summary;
    expect(all.total).toBe(1650);
    expect(all.byMonth.reduce((n: number, m: { total: number }) => n + m.total, 0)).toBe(1650);
    const forA = (
      await api().get(`/api/v1/farms/${fid}/expenses/summary?animalId=${a.id}`).set(o.auth)
    ).body.summary;
    expect(forA.total).toBe(1450);
    const recent = (
      await api()
        .get(`/api/v1/farms/${fid}/expenses/summary?from=${daysAgo(10)}`)
        .set(o.auth)
    ).body.summary;
    expect(recent.total).toBe(650);
    expect(
      (await api().get(`/api/v1/farms/${fid}/expenses/summary?animalId=${ID}`).set(o.auth)).status,
    ).toBe(400);
    expect(
      (
        await api()
          .get(`/api/v1/farms/${fid}/expenses?animalId=${a.id}&sortBy=amount&order=desc`)
          .set(o.auth)
      ).body.items.map((i: { amount: number }) => i.amount),
    ).toEqual([1000, 450]);
    // voided expenses leave the totals but stay in the list on request
    const voidedId = linked.body.record.id;
    await api()
      .post(`/api/v1/farms/${fid}/expenses/${voidedId}/void`)
      .set(o.auth)
      .send({ reason: 'Entered twice' })
      .expect(200);
    expect(
      (await api().get(`/api/v1/farms/${fid}/expenses/summary`).set(o.auth)).body.summary.total,
    ).toBe(1200);
    expect(
      (await api().get(`/api/v1/farms/${fid}/expenses?includeVoided=true`).set(o.auth)).body.total,
    ).toBe(3);
  });

  it('corrections to the amount are exact and audited', async () => {
    const e = (
      await spend({
        category: 'feed',
        expenseDate: daysAgo(1),
        amount: 99.9,
        description: 'Pellets',
      })
    ).body.record;
    const fixed = await post(`/expenses/${e.id}/corrections`, f.manager, {
      reason: 'Receipt says 109.90',
      changes: { amount: 109.9 },
    });
    expect(fixed.body.record.amount).toBe(109.9);
    expect(fixed.body.record.history[0].changes).toEqual([
      { field: 'amount', from: 99.9, to: 109.9 },
    ]);
    expect((await FarmExpense.findById(e.id))?.amountMinor).toBe(10990);
  });
});

// ---------------------------------------------------------------------------
describe('corrections, voiding and attachments: history is preserved and reviewable', () => {
  let rec: { id: string };
  beforeAll(async () => {
    rec = (
      await post('/health', f.worker, {
        animalId: cow.id,
        type: 'illness',
        recordedOn: daysAgo(4),
        title: 'Limping',
        symptoms: 'Left hind leg',
      })
    ).body.record;
  });

  it('a correction needs a reason and shows what changed, by whom and when', async () => {
    expect(
      (
        await post(`/health/${rec.id}/corrections`, f.manager, {
          changes: { title: 'Limping (left leg)' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(`/health/${rec.id}/corrections`, f.manager, {
          reason: 'ok',
          changes: { title: 'x' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(`/health/${rec.id}/corrections`, f.manager, {
          reason: 'No changes at all',
          changes: {},
        })
      ).status,
    ).toBe(400);

    const res = await post(`/health/${rec.id}/corrections`, f.manager, {
      reason: 'More precise wording',
      changes: { title: 'Limping (left hind)', severity: 'mild' },
    });
    expect(res.status).toBe(200);
    const r = res.body.record;
    expect(r).toMatchObject({
      title: 'Limping (left hind)',
      severity: 'mild',
      revision: 2,
      updatedBy: { id: f.manager.id },
      createdBy: { id: f.worker.id },
    });
    expect(r.history).toHaveLength(1);
    expect(r.history[0]).toMatchObject({
      kind: 'correction',
      reason: 'More precise wording',
      by: { id: f.manager.id },
    });
    expect(r.history[0].changes).toEqual(
      expect.arrayContaining([
        { field: 'title', from: 'Limping', to: 'Limping (left hind)' },
        { field: 'severity', from: null, to: 'mild' },
      ]),
    );
    expect(new Date(r.history[0].at).getTime()).toBeGreaterThan(Date.now() - 60_000);

    const second = await post(`/health/${rec.id}/corrections`, f.owner, {
      reason: 'Remove the severity, not assessed',
      changes: { severity: null },
    });
    expect(second.body.record.severity).toBeUndefined();
    expect(second.body.record.revision).toBe(3);
    expect(second.body.record.history.map((h: { by: { id: string } }) => h.by.id)).toEqual([
      f.manager.id,
      f.owner.id,
    ]);
    expect(second.body.record.history[1].changes).toEqual([
      { field: 'severity', from: 'mild', to: null },
    ]);
    // the stored document keeps both entries too
    expect((await HealthRecord.findById(rec.id))?.history).toHaveLength(2);
  });

  it('refuses identity changes, unknown fields and no-ops', async () => {
    const c = (changes: object) =>
      post(`/health/${rec.id}/corrections`, f.manager, { reason: 'A valid reason', changes });
    for (const changes of [
      { animalId: bull.id },
      { farmId: ID },
      { createdBy: f.owner.id },
      { history: [] },
      { revision: 99 },
      { voided: true },
      { attachments: [] },
      { diagnosis: 'x' },
    ]) {
      const res = await c(changes);
      expect(res.status, JSON.stringify(changes)).toBe(400);
      expect(res.body.error.details[0].path).toMatch(/^changes\./);
    }
    const current = (await get(`/health/${rec.id}`)).body.record;
    expect((await c({ title: current.title })).status).toBe(409);
  });

  it('re-validates the WHOLE record: a correction cannot create something creation would refuse', async () => {
    const res = await post(`/health/${rec.id}/corrections`, f.manager, {
      reason: 'Switching type',
      changes: { type: 'vaccination' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain('vaccine.name');
    const bad = await post(`/health/${rec.id}/corrections`, f.manager, {
      reason: 'Condition with no source',
      changes: { condition: 'Something' },
    });
    expect(bad.body.error.details.map((d: { path: string }) => d.path)).toContain(
      'conditionStatedBy',
    );
    const future = await post(`/health/${rec.id}/corrections`, f.manager, {
      reason: 'Wrong date',
      changes: { recordedOn: daysAhead(3) },
    });
    expect(future.status).toBe(400);
  });

  it('voiding keeps the record, says who/when/why, and freezes it', async () => {
    const mine = (
      await post('/health', f.worker, {
        animalId: cow.id,
        type: 'checkup',
        recordedOn: daysAgo(2),
        title: 'Entered by mistake',
      })
    ).body.record;
    expect((await post(`/health/${mine.id}/void`, f.manager, {})).status).toBe(400);
    const voided = await post(`/health/${mine.id}/void`, f.manager, { reason: 'Wrong animal' });
    expect(voided.status).toBe(200);
    expect(voided.body.record.voided).toMatchObject({
      reason: 'Wrong animal',
      by: { id: f.manager.id },
    });
    expect(voided.body.record.history.at(-1)).toMatchObject({
      kind: 'void',
      reason: 'Wrong animal',
    });
    expect(await HealthRecord.countDocuments({ _id: mine.id })).toBe(1); // never deleted
    expect(
      (await post(`/health/${mine.id}/void`, f.manager, { reason: 'Again please' })).status,
    ).toBe(409);
    const edit = await post(`/health/${mine.id}/corrections`, f.manager, {
      reason: 'Trying to edit',
      changes: { title: 'x2' },
    });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('RECORD_VOIDED');
    expect(
      (
        await post(`/health/${mine.id}/attachments`, f.worker, {
          kind: 'photo',
          url: 'https://cdn.example.test/a.jpg',
        })
      ).status,
    ).toBe(409);
    expect((await get(`/health/${mine.id}`, f.viewer)).body.record.voided.reason).toBe(
      'Wrong animal',
    );
  });

  it('attaches photos and documents by link (history entry on add and on removal)', async () => {
    const add = await post(`/health/${rec.id}/attachments`, f.worker, {
      kind: 'document',
      url: 'https://cdn.example.test/lab.pdf',
      mimeType: 'application/pdf',
      caption: 'Lab result',
    });
    expect(add.status).toBe(201);
    expect(add.body.record.attachments).toHaveLength(1);
    expect(add.body.record.attachments[0]).toMatchObject({
      kind: 'document',
      caption: 'Lab result',
      addedBy: { id: f.worker.id },
    });
    expect(add.body.record.history.at(-1)).toMatchObject({
      kind: 'attachment_added',
      by: { id: f.worker.id },
    });
    for (const [body, status] of [
      [{ kind: 'photo', url: 'http://cdn.example.test/x.jpg' }, 400],
      [{ kind: 'document', url: 'https://cdn.example.test/lab.pdf' }, 409],
      [{ kind: 'photo', url: 'https://cdn.example.test/p.pdf', mimeType: 'application/pdf' }, 400],
    ] as [object, number][])
      expect(
        (await post(`/health/${rec.id}/attachments`, f.worker, body)).status,
        JSON.stringify(body),
      ).toBe(status);
    expect(
      (
        await post(`/health/${rec.id}/attachments`, f.viewer, {
          kind: 'photo',
          url: 'https://cdn.example.test/v.jpg',
        })
      ).status,
    ).toBe(403);

    const attId = add.body.record.attachments[0].id;
    expect(
      (
        await post(`/health/${rec.id}/attachments/${attId}/remove`, f.worker, {
          reason: 'wrong file',
        })
      ).status,
    ).toBe(403); // removing needs the corrector permission
    expect(
      (await post(`/health/${rec.id}/attachments/${attId}/remove`, f.manager, {})).status,
    ).toBe(400);
    const removed = await post(`/health/${rec.id}/attachments/${attId}/remove`, f.manager, {
      reason: 'Uploaded the wrong file',
    });
    expect(removed.body.record.attachments).toHaveLength(0);
    expect(removed.body.record.history.at(-1)).toMatchObject({
      kind: 'attachment_removed',
      reason: 'Uploaded the wrong file',
    });
  });

  it('records can be created with attachments, and the host policy applies', async () => {
    const strict = await startHarness({ MEDIA_ALLOWED_HOSTS: 'files.farmplus.test' });
    try {
      const body = (url: string) => ({
        animalId: cow.id,
        type: 'checkup',
        recordedOn: daysAgo(1),
        title: 'With file',
        attachments: [{ kind: 'document', url }],
      });
      const make = (url: string) =>
        request(strict.app).post(V('/health')).set(f.owner.auth).send(body(url));
      expect((await make('https://files.farmplus.test/a.pdf')).status).toBe(201);
      expect((await make('https://evil.test/a.pdf')).status).toBe(400);
    } finally {
      await strict.stop();
    }
  });

  it('every mutation is in the audit log, with no secrets', async () => {
    const actions = new Set(
      (await AuditLog.find({ action: /^(health|weight|feeding|expense|breeding)\./ }).distinct(
        'action',
      )) as string[],
    );
    for (const a of [
      'health.created',
      'health.corrected',
      'health.voided',
      'health.attachment_added',
      'health.attachment_removed',
      'weight.created',
      'weight.voided',
      'feeding.created',
      'feeding.corrected',
      'expense.created',
      'expense.corrected',
      'expense.voided',
    ]) {
      expect(actions.has(a), a).toBe(true);
    }
    const log = await AuditLog.findOne({ action: 'health.corrected', targetId: rec.id });
    expect(log?.metadata).toMatchObject({
      reason: 'More precise wording',
      fields: expect.arrayContaining(['title']),
    });
    expect(
      JSON.stringify(await AuditLog.find({ action: /^(health|weight|feeding|expense)\./ }).lean()),
    ).not.toMatch(/passwordHash|accessToken|refreshToken/);
  });
});

// ---------------------------------------------------------------------------
describe('the complete history of one animal', () => {
  let a: { id: string };
  let farm: FarmSetup;
  beforeAll(async () => {
    farm = await setupFarm(h.app);
    a = await mkAnimal(h.app, farm.owner, farm.farmId, {
      animalCode: 'HIST-1',
      animalTypeId: farm.buffalo,
      sex: 'female',
      birthDate: daysAgo(500),
    });
    const p = (path: string, who: Session, body: object) =>
      api().post(`/api/v1/farms/${farm.farmId}${path}`).set(who.auth).send(body);
    await p('/health', farm.worker, {
      animalId: a.id,
      type: 'illness',
      recordedOn: daysAgo(40),
      title: 'Cough',
      condition: 'Respiratory infection',
      conditionStatedBy: 'veterinarian',
    }).then((r) => expect(r.status).toBe(201));
    const wrong = await p('/health', farm.worker, {
      animalId: a.id,
      type: 'checkup',
      recordedOn: daysAgo(35),
      title: 'Wrong entry',
    });
    await p(`/health/${wrong.body.record.id}/void`, farm.manager, {
      reason: 'Not this animal',
    }).then((r) => expect(r.status).toBe(200));
    await p('/weights', farm.worker, {
      animalId: a.id,
      weighedOn: daysAgo(30),
      weightKg: 250,
    }).then((r) => expect(r.status).toBe(201));
    await p('/feeding', farm.worker, {
      kind: 'log',
      animalId: a.id,
      date: daysAgo(20),
      feedName: 'Hay',
      quantity: { amount: 3, unit: 'kg' },
    }).then((r) => expect(r.status).toBe(201));
    await p('/expenses', farm.manager, {
      category: 'veterinary',
      expenseDate: daysAgo(38),
      amount: 800,
      description: 'Vet visit',
      animalId: a.id,
    }).then((r) => expect(r.status).toBe(201));
    await api()
      .patch(`/api/v1/farms/${farm.farmId}/animals/${a.id}`)
      .set(farm.owner.auth)
      .send({ name: 'Histia' })
      .expect(200);
  });
  const hist = (qs = '', who: Session = farm.owner) =>
    api().get(`/api/v1/farms/${farm.farmId}/animals/${a.id}/history?${qs}`).set(who.auth);

  it('merges profile changes, health, weights, feeding and costs, newest first, with who did each', async () => {
    const res = await hist();
    expect(res.status).toBe(200);
    const types = res.body.items.map((i: { type: string }) => i.type);
    expect(new Set(types)).toEqual(new Set(['animal', 'health', 'weight', 'feeding', 'expense']));
    const dates = res.body.items.map((i: { date: string }) => i.date.slice(0, 10));
    expect([...dates].sort().reverse()).toEqual(dates);
    const health = res.body.items.find((i: { title: string }) => i.title.includes('Cough'));
    expect(health).toMatchObject({
      summary: 'Respiratory infection (stated by veterinarian)',
      by: { id: farm.worker.id },
    });
    expect(res.body.items.find((i: { title: string }) => i.title === 'Registered')).toMatchObject({
      by: { id: farm.owner.id },
    });
    expect(
      res.body.items.find((i: { title: string }) => i.title === 'Details updated').summary,
    ).toBe('Changed: name');
    expect(res.body.items.find((i: { type: string }) => i.type === 'expense')).toMatchObject({
      summary: '800.00 THB',
    });
  });

  it('voided records stay visible (flagged) and can be filtered out', async () => {
    const all = await hist();
    const voided = all.body.items.find((i: { title: string }) => i.title.includes('Wrong entry'));
    expect(voided).toMatchObject({ voided: true });
    const live = await hist('includeVoided=false');
    expect(live.body.items.some((i: { title: string }) => i.title.includes('Wrong entry'))).toBe(
      false,
    );
  });

  it('filters by type and date, and paginates', async () => {
    expect((await hist('types=weight')).body.items.map((i: { type: string }) => i.type)).toEqual([
      'weight',
    ]);
    expect(
      new Set((await hist('types=health,feeding')).body.items.map((i: { type: string }) => i.type)),
    ).toEqual(new Set(['health', 'feeding']));
    expect(
      (await hist(`from=${daysAgo(25)}`)).body.items.every(
        (i: { type: string; date: string }) => i.type === 'animal' || i.date >= daysAgo(25),
      ),
    ).toBe(true);
    const page1 = await hist('pageSize=3');
    expect(page1.body.items).toHaveLength(3);
    expect(page1.body.total).toBeGreaterThan(5);
    const keys = new Set(
      [...page1.body.items, ...(await hist('pageSize=3&page=2')).body.items].map(
        (i: { key: string }) => i.key,
      ),
    );
    expect(keys.size).toBe(6);
    for (const bad of ['types=cancer', 'pageSize=500', 'from=x', 'includeVoided=maybe'])
      expect((await hist(bad)).status, bad).toBe(400);
  });

  it('costs are only shown to people who may see money', async () => {
    expect(
      (await hist('', farm.worker)).body.items.some((i: { type: string }) => i.type === 'expense'),
    ).toBe(false);
    expect(
      (await hist('', farm.viewer)).body.items.some((i: { type: string }) => i.type === 'expense'),
    ).toBe(false);
    expect(
      (await hist('', farm.manager)).body.items.some((i: { type: string }) => i.type === 'expense'),
    ).toBe(true);
  });

  it('is scoped to the farm and the animal', async () => {
    expect(
      (await api().get(`/api/v1/farms/${farm.farmId}/animals/${ID}/history`).set(farm.owner.auth))
        .status,
    ).toBe(404);
    expect(
      (await api().get(`/api/v1/farms/${f.farmId}/animals/${a.id}/history`).set(f.owner.auth))
        .status,
    ).toBe(404); // right animal id, wrong farm
    const stranger = await createFarmer(h.app);
    expect((await hist('', stranger)).status).toBe(404);
  });
});

describe('members can only reach records of their own farms', () => {
  it('a member of farm A has no access to the records of farm B', async () => {
    const b = await setupFarm(h.app);
    const animal = await mkAnimal(h.app, b.owner, b.farmId, {
      animalTypeId: b.buffalo,
      sex: 'female',
    });
    const created = await api()
      .post(`/api/v1/farms/${b.farmId}/weights`)
      .set(b.owner.auth)
      .send({ animalId: animal.id, weighedOn: daysAgo(1), weightKg: 200 });
    for (const path of [
      '/weights',
      '/health',
      '/feeding',
      '/expenses',
      '/breeding',
      `/weights/${created.body.record.id}`,
      `/animals/${animal.id}/growth`,
      `/animals/${animal.id}/history`,
    ]) {
      expect(
        (await api().get(`/api/v1/farms/${b.farmId}${path}`).set(f.owner.auth)).status,
        path,
      ).toBe(404);
    }
    await addFarmMember(h.app, b.owner, b.farmId, f.viewer, 'viewer');
    expect((await api().get(`/api/v1/farms/${b.farmId}/weights`).set(f.viewer.auth)).status).toBe(
      200,
    );
    expect((await api().get(`/api/v1/farms/${b.farmId}/expenses`).set(f.viewer.auth)).status).toBe(
      403,
    );
  });
});
