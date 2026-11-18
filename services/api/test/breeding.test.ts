import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Animal, AuditLog, BreedingRecord } from '../src/models';
import {
  createFarmer,
  createStaff,
  daysAgo,
  daysAhead,
  mkAnimal,
  setupFarm,
  startHarness,
  typeIdOf,
  type FarmSetup,
  type Session,
  type Staff,
  type TestHarness,
} from './helpers';

let h: TestHarness;
let f: FarmSetup;
let admin: Staff;
const api = () => request(h.app);
const V = (p: string) => `/api/v1/farms/${f.farmId}${p}`;
const ID = '0123456789abcdef01234567';
const post = (p: string, who: Session, body: object = {}) =>
  api().post(V(p)).set(who.auth).send(body);
const get = (p: string, who: Session = f.owner) => api().get(V(p)).set(who.auth);

/** Fresh animals per test group so breeding histories never interfere. */
const cow = (code: string, extra: object = {}) =>
  mkAnimal(h.app, f.owner, f.farmId, {
    animalCode: code,
    animalTypeId: f.buffalo,
    sex: 'female',
    birthDate: daysAgo(1000),
    ...extra,
  });
const bull = (code: string, extra: object = {}) =>
  mkAnimal(h.app, f.owner, f.farmId, {
    animalCode: code,
    animalTypeId: f.buffalo,
    sex: 'male',
    birthDate: daysAgo(1200),
    ...extra,
  });
const breed = (body: object, who: Session = f.worker) => post('/breeding', who, body);
const animalCount = () => Animal.countDocuments({ farmId: f.farmId });

beforeAll(async () => {
  h = await startHarness();
  f = await setupFarm(h.app);
  admin = await createStaff(h.app, ['admin']);
});
afterAll(() => h.stop());

describe('recording a breeding', () => {
  it('records sire and dam where known, plus method and expected nothing the system does not know', async () => {
    const d = await cow('D-1');
    const s = await bull('S-1');
    const res = await breed({
      damId: d.id,
      sireId: s.id,
      method: 'natural',
      breedingDate: daysAgo(30),
      notes: 'Pasture mating',
    });
    expect(res.status).toBe(201);
    expect(res.body.record).toMatchObject({
      status: 'bred',
      method: 'natural',
      breedingDate: daysAgo(30),
      dam: { id: d.id, animalCode: 'D-1' },
      sire: { id: s.id, animalCode: 'S-1' },
      revision: 1,
      createdBy: { id: f.worker.id },
      warnings: [],
    });
    // No gestation length is configured, so no expected date is invented.
    expect(res.body.record.expectedDeliveryDate).toBeUndefined();
  });

  it('the sire is optional (unknown) or an outside animal (e.g. artificial insemination)', async () => {
    const d = await cow('D-2');
    const unknown = await breed({ damId: d.id, breedingDate: daysAgo(60) });
    expect(unknown.status).toBe(201);
    expect(unknown.body.record.sire).toBeUndefined();
    await post(`/breeding/${unknown.body.record.id}/failure`, f.worker, {
      date: daysAgo(40),
      reason: 'Returned to heat',
    }).then((r) => expect(r.status).toBe(200));
    const ai = await breed({
      damId: d.id,
      sireExternal: { name: 'Bull "Thunder"', code: 'AI-2024-17' },
      method: 'artificial_insemination',
      breedingDate: daysAgo(20),
    });
    expect(ai.status).toBe(201);
    expect(ai.body.record.sireExternal).toEqual({ name: 'Bull "Thunder"', code: 'AI-2024-17' });
    expect(ai.body.record.sire).toBeUndefined();
  });

  it.each([
    [
      'a male dam',
      async () => ({ damId: (await bull('S-BADDAM')).id, breedingDate: daysAgo(10) }),
      'damId',
    ],
    [
      'a female sire',
      async () => ({
        damId: (await cow('D-3')).id,
        sireId: (await cow('D-3B')).id,
        breedingDate: daysAgo(10),
      }),
      'sireId',
    ],
    [
      'a sire of another species',
      async () => ({
        damId: (await cow('D-4')).id,
        sireId: (await mkAnimal(h.app, f.owner, f.farmId, { animalTypeId: f.cattle, sex: 'male' }))
          .id,
        breedingDate: daysAgo(10),
      }),
      'sireId',
    ],
    [
      'the same animal as sire and dam',
      async () => {
        const a = await cow('D-5');
        return { damId: a.id, sireId: a.id, breedingDate: daysAgo(10) };
      },
      'sireId',
    ],
    [
      'both an on-farm and an outside sire',
      async () => ({
        damId: (await cow('D-6')).id,
        sireId: (await bull('S-6')).id,
        sireExternal: { name: 'x' },
        breedingDate: daysAgo(10),
      }),
      'sireExternal',
    ],
    [
      'an empty outside sire',
      async () => ({ damId: (await cow('D-7')).id, sireExternal: {}, breedingDate: daysAgo(10) }),
      'sireExternal',
    ],
    [
      'a future breeding date',
      async () => ({ damId: (await cow('D-8')).id, breedingDate: daysAhead(1) }),
      'breedingDate',
    ],
    [
      'breeding before the dam was born',
      async () => ({
        damId: (await cow('D-9', { birthDate: daysAgo(100) })).id,
        breedingDate: daysAgo(200),
      }),
      'breedingDate',
    ],
    [
      'breeding before the sire was born',
      async () => ({
        damId: (await cow('D-10')).id,
        sireId: (await bull('S-10', { birthDate: daysAgo(50) })).id,
        breedingDate: daysAgo(100),
      }),
      'breedingDate',
    ],
    [
      'an unknown method',
      async () => ({ damId: (await cow('D-11')).id, method: 'magic', breedingDate: daysAgo(10) }),
      'method',
    ],
    ['a dam from nowhere', async () => ({ damId: ID, breedingDate: daysAgo(10) }), 'damId'],
    [
      'an unknown field',
      async () => ({
        damId: (await cow('D-12')).id,
        breedingDate: daysAgo(10),
        expectedDeliveryDate: daysAhead(100),
      }),
      '', // unknown keys are a whole-object violation (empty path)
    ],
  ])('rejects %s', async (_name, build, path) => {
    const res = await breed(await build());
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
  });

  it('blocks pairing an animal with its own parent or child; shared ancestry is only a warning', async () => {
    const grandsire = await bull('S-G');
    const dam = await mkAnimal(h.app, f.owner, f.farmId, {
      animalCode: 'D-KID',
      animalTypeId: f.buffalo,
      sex: 'female',
      birthDate: daysAgo(900),
      sireId: grandsire.id,
    });
    const father = await breed({ damId: dam.id, sireId: grandsire.id, breedingDate: daysAgo(30) });
    expect(father.status).toBe(400);
    expect(father.body.error.details[0].message).toMatch(/own father/);

    const son = await mkAnimal(h.app, f.owner, f.farmId, {
      animalCode: 'S-SON',
      animalTypeId: f.buffalo,
      sex: 'male',
      birthDate: daysAgo(300),
      damId: dam.id,
    });
    expect(
      (await breed({ damId: dam.id, sireId: son.id, breedingDate: daysAgo(30) })).body.error
        .details[0].message,
    ).toMatch(/own son/);

    const half = await mkAnimal(h.app, f.owner, f.farmId, {
      animalCode: 'S-HALF',
      animalTypeId: f.buffalo,
      sex: 'male',
      birthDate: daysAgo(800),
      sireId: grandsire.id,
    });
    const warned = await breed({ damId: dam.id, sireId: half.id, breedingDate: daysAgo(30) });
    expect(warned.status).toBe(201);
    expect(warned.body.record.warnings).toEqual([
      'The sire and dam share a parent (siblings or half-siblings).',
    ]);
  });

  it('allows one open pregnancy per dam, and no overlapping periods', async () => {
    const d = await cow('D-OPEN');
    const first = await breed({ damId: d.id, breedingDate: daysAgo(100) });
    const second = await breed({ damId: d.id, breedingDate: daysAgo(10) });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DAM_ALREADY_BRED');
    await post(`/breeding/${first.body.record.id}/delivery`, f.worker, {
      date: daysAgo(50),
      offspring: [{ outcome: 'stillborn' }],
    }).then((r) => expect(r.status).toBe(201));
    const inside = await breed({ damId: d.id, breedingDate: daysAgo(70) }); // between breeding (100d) and delivery (50d)
    expect(inside.status).toBe(409);
    expect(inside.body.error.code).toBe('OVERLAPPING_BREEDING');
    expect((await breed({ damId: d.id, breedingDate: daysAgo(40) })).status).toBe(201);
  });

  it('the species configuration (set by an administrator) adds an expected date and a minimum age — and only then', async () => {
    const goat = await typeIdOf(h.app, f.owner, 'goat');
    const mk = (code: string, sex: string, age: number) =>
      mkAnimal(h.app, f.owner, f.farmId, {
        animalCode: code,
        animalTypeId: goat,
        sex,
        birthDate: daysAgo(age),
      });
    const young = await mk('G-YOUNG', 'female', 120);
    expect((await breed({ damId: young.id, breedingDate: daysAgo(10) })).status).toBe(201); // nothing configured: accepted
    await post(
      `/breeding/${(await get(`/breeding?damId=${young.id}`)).body.items[0].id}/failure`,
      f.worker,
      { date: daysAgo(5), reason: 'Test cleanup' },
    );

    await api()
      .patch(`/api/v1/animal-types/${goat}`)
      .set(admin.auth)
      .send({ gestationDays: 150, minBreedingAgeDays: 240 })
      .expect(200);
    const tooYoung = await breed({ damId: young.id, breedingDate: daysAgo(1) });
    expect(tooYoung.status).toBe(400);
    expect(tooYoung.body.error.details[0].message).toMatch(
      /minimum configured for Goat is 240 days/,
    );
    const adult = await mk('G-ADULT', 'female', 600);
    const ok = await breed({ damId: adult.id, breedingDate: daysAgo(30) });
    expect(ok.status).toBe(201);
    const expected = new Date(Date.now() - 30 * 86_400_000 + 150 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(ok.body.record.expectedDeliveryDate).toBe(expected);
    expect((await get(`/breeding/${ok.body.record.id}`)).body.record.expectedDeliveryDate).toBe(
      expected,
    );
  });
});

describe('pregnancy, failure and delivery', () => {
  it('walks bred → pregnant → delivered, recording each step in the history', async () => {
    const d = await cow('D-FLOW');
    const s = await bull('S-FLOW');
    const rec = (await breed({ damId: d.id, sireId: s.id, breedingDate: daysAgo(300) })).body
      .record;
    const preg = await post(`/breeding/${rec.id}/pregnancy`, f.worker, {
      date: daysAgo(250),
      notes: 'Palpation',
    });
    expect(preg.status).toBe(200);
    expect(preg.body.record).toMatchObject({
      status: 'pregnant',
      pregnancyConfirmedOn: daysAgo(250),
    });
    expect(
      (await post(`/breeding/${rec.id}/pregnancy`, f.worker, { date: daysAgo(250) })).body.error
        .code,
    ).toBe('INVALID_TRANSITION');
    expect(
      (await post(`/breeding/${rec.id}/delivery`, f.worker, { date: daysAgo(260), offspring: [] }))
        .status,
    ).toBe(400); // before the pregnancy check

    const del = await post(`/breeding/${rec.id}/delivery`, f.worker, {
      date: daysAgo(10),
      offspring: [{ register: { animalCode: 'CALF-FLOW', sex: 'female', name: 'Dao' } }],
    });
    expect(del.status).toBe(201);
    const full = (await get(`/breeding/${rec.id}`, f.viewer)).body.record;
    expect(full.status).toBe('delivered');
    expect(full.history.map((e: { kind: string }) => e.kind)).toEqual(['event', 'event']);
    expect(full.history[1].changes[0]).toEqual({
      field: 'status',
      from: 'pregnant',
      to: 'delivered',
    });
    expect(full.history[1].by.id).toBe(f.worker.id);
    for (const [path, body] of [
      ['pregnancy', { date: daysAgo(1) }],
      ['failure', { date: daysAgo(1), reason: 'too late' }],
    ] as [string, object][]) {
      expect(
        (await post(`/breeding/${rec.id}/${path}`, f.worker, body)).body.error.code,
        path,
      ).toBe('INVALID_TRANSITION');
    }
  });

  it('a failed breeding is closed with a reason and frees the dam', async () => {
    const d = await cow('D-FAIL');
    const rec = (await breed({ damId: d.id, breedingDate: daysAgo(80) })).body.record;
    expect(
      (await post(`/breeding/${rec.id}/failure`, f.worker, { date: daysAgo(60) })).status,
    ).toBe(400);
    expect(
      (
        await post(`/breeding/${rec.id}/failure`, f.worker, {
          date: daysAgo(90),
          reason: 'Backdated',
        })
      ).status,
    ).toBe(400);
    const failed = await post(`/breeding/${rec.id}/failure`, f.worker, {
      date: daysAgo(60),
      reason: 'Not pregnant at check',
    });
    expect(failed.body.record).toMatchObject({
      status: 'failed',
      failedOn: daysAgo(60),
      failureReason: 'Not pregnant at check',
    });
    expect((await breed({ damId: d.id, breedingDate: daysAgo(30) })).status).toBe(201);
  });
});

describe('offspring keep ONE identity (no duplicate animals)', () => {
  it('registers new calves and links existing ones, setting parents on the same animal records', async () => {
    const d = await cow('D-OFF');
    const s = await bull('S-OFF');
    const existing = await mkAnimal(h.app, f.owner, f.farmId, {
      animalCode: 'CALF-EXIST',
      animalTypeId: f.buffalo,
      sex: 'male',
      birthDate: daysAgo(15),
    });
    const rec = (await breed({ damId: d.id, sireId: s.id, breedingDate: daysAgo(310) })).body
      .record;
    const before = await animalCount();

    const res = await post(`/breeding/${rec.id}/delivery`, f.worker, {
      date: daysAgo(15),
      offspring: [
        { animalId: existing.id, note: 'Registered earlier' },
        { register: { animalCode: 'CALF-NEW', sex: 'female', name: 'Fah' } },
        { outcome: 'stillborn', sex: 'male' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.record.status).toBe('delivered');
    expect(res.body.record.delivery.offspring).toHaveLength(3);
    expect(res.body.record.delivery.offspring.map((o: { outcome: string }) => o.outcome)).toEqual([
      'alive',
      'alive',
      'stillborn',
    ]);
    expect(res.body.record.delivery.offspring[2].animal).toBeUndefined(); // a stillbirth gets no identity

    // exactly ONE new animal exists (the registered one); the linked one is the same document as before.
    expect(await animalCount()).toBe(before + 1);
    const linked = await Animal.findById(existing.id);
    const fresh = await Animal.findOne({ farmId: f.farmId, animalCode: 'CALF-NEW' });
    for (const calf of [linked!, fresh!]) {
      expect(String(calf.damId)).toBe(d.id);
      expect(String(calf.sireId)).toBe(s.id);
    }
    expect(fresh?.birthDate?.toISOString().slice(0, 10)).toBe(daysAgo(15));

    const lineage = (await get(`/animals/${d.id}/lineage`, f.viewer)).body;
    expect(lineage.offspring.map((o: { animalCode: string }) => o.animalCode).sort()).toEqual([
      'CALF-EXIST',
      'CALF-NEW',
    ]);
    expect(lineage.offspring.every((o: { role: string }) => o.role === 'dam')).toBe(true);
    const calfLineage = (await get(`/animals/${fresh!._id}/lineage`)).body;
    expect(calfLineage).toMatchObject({
      dam: { animalCode: 'D-OFF' },
      sire: { animalCode: 'S-OFF' },
      offspring: [],
    });
    expect(
      (await get(`/animals/${s.id}/lineage`)).body.offspring.every(
        (o: { role: string }) => o.role === 'sire',
      ),
    ).toBe(true);
    expect(
      (await get(`/animals/${fresh!._id}/history`)).body.items.find(
        (i: { role?: string }) => i.role === 'offspring',
      ),
    ).toMatchObject({ title: 'Born', summary: 'dam D-OFF · sire S-OFF' });
  });

  it.each([
    ['an animal that is its own parent', async (ctx: Ctx) => ({ animalId: ctx.dam }), 400],
    [
      'an animal of another species',
      async () => ({
        animalId: (
          await mkAnimal(h.app, f.owner, f.farmId, { animalTypeId: f.cattle, sex: 'male' })
        ).id,
      }),
      400,
    ],
    [
      'an animal born on a different day',
      async () => ({
        animalId: (
          await mkAnimal(h.app, f.owner, f.farmId, {
            animalTypeId: f.buffalo,
            sex: 'male',
            birthDate: daysAgo(400),
          })
        ).id,
      }),
      400,
    ],
    [
      'an animal with a different recorded dam',
      async () => ({
        animalId: (
          await mkAnimal(h.app, f.owner, f.farmId, {
            animalTypeId: f.buffalo,
            sex: 'male',
            birthDate: daysAgo(10),
            damId: (await cow(`OTHERDAM-${Math.random().toString(36).slice(2, 6)}`)).id,
          })
        ).id,
      }),
      409,
    ],
    ['an unknown animal', async () => ({ animalId: ID }), 400],
    [
      'an archived animal',
      async () => {
        const a = await mkAnimal(h.app, f.owner, f.farmId, {
          animalTypeId: f.buffalo,
          sex: 'male',
          birthDate: daysAgo(10),
        });
        await api()
          .post(V(`/animals/${a.id}/archive`))
          .set(f.owner.auth)
          .send({});
        return { animalId: a.id };
      },
      409,
    ],
  ])('refuses to link %s', async (_name, build, status) => {
    const d = await cow(`D-REF-${Math.random().toString(36).slice(2, 7)}`);
    const rec = (await breed({ damId: d.id, breedingDate: daysAgo(300) })).body.record;
    const entry = await build({ dam: d.id }); // may create helper animals first
    const before = await animalCount();
    const res = await post(`/breeding/${rec.id}/delivery`, f.worker, {
      date: daysAgo(10),
      offspring: [entry],
    });
    expect(res.status).toBe(status);
    expect((await get(`/breeding/${rec.id}`)).body.record.status).toBe('bred'); // nothing was recorded
    expect(await animalCount()).toBe(before);
  });

  type Ctx = { dam: string };

  it('an animal can be the offspring of only one breeding record', async () => {
    const d1 = await cow('D-ONCE-1');
    const d2 = await cow('D-ONCE-2');
    const calf = await mkAnimal(h.app, f.owner, f.farmId, {
      animalTypeId: f.buffalo,
      sex: 'female',
      birthDate: daysAgo(12),
    });
    const r1 = (await breed({ damId: d1.id, breedingDate: daysAgo(300) })).body.record;
    const r2 = (await breed({ damId: d2.id, breedingDate: daysAgo(300) })).body.record;
    await post(`/breeding/${r1.id}/delivery`, f.worker, {
      date: daysAgo(12),
      offspring: [{ animalId: calf.id }],
    }).then((r) => expect(r.status).toBe(201));
    const dup = await post(`/breeding/${r2.id}/delivery`, f.worker, {
      date: daysAgo(12),
      offspring: [{ animalId: calf.id }],
    });
    expect(dup.status).toBe(409);
    expect(['PARENT_CONFLICT', 'ALREADY_OFFSPRING']).toContain(dup.body.error.code);
    const twice = await post(`/breeding/${r2.id}/delivery`, f.worker, {
      date: daysAgo(12),
      offspring: [
        { register: { animalCode: 'TWIN-X', sex: 'male' } },
        { register: { animalCode: 'twin-x', sex: 'female' } },
      ],
    });
    expect(twice.status).toBe(400);
    expect(await Animal.countDocuments({ farmId: f.farmId, animalCode: /^twin-x$/i })).toBe(0);
  });

  it('delivery is atomic: if one calf cannot be registered nothing is recorded and earlier calves are rolled back', async () => {
    const d = await cow('D-ATOM');
    await mkAnimal(h.app, f.owner, f.farmId, {
      animalCode: 'TAKEN-1',
      animalTypeId: f.buffalo,
      sex: 'male',
    });
    const rec = (await breed({ damId: d.id, breedingDate: daysAgo(300) })).body.record;
    const res = await post(`/breeding/${rec.id}/delivery`, f.worker, {
      date: daysAgo(10),
      offspring: [
        { register: { animalCode: 'CALF-ROLLED', sex: 'female' } },
        { register: { animalCode: 'TAKEN-1', sex: 'male' } },
      ],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_ANIMAL_CODE');
    const after = (await get(`/breeding/${rec.id}`)).body.record;
    expect(after.status).toBe('bred');
    expect(after.delivery).toBeUndefined();
    const rolled = await Animal.findOne({ farmId: f.farmId, animalCode: 'CALF-ROLLED' });
    expect(rolled?.archivedAt).toBeTruthy(); // identities are never deleted — it is archived and its code stays reserved
    expect(rolled?.archiveReason).toMatch(/Rolled back/);
    // and the delivery can simply be tried again
    expect(
      (
        await post(`/breeding/${rec.id}/delivery`, f.worker, {
          date: daysAgo(10),
          offspring: [{ register: { animalCode: 'CALF-OK', sex: 'female' } }],
        })
      ).status,
    ).toBe(201);
  });

  it('concurrent deliveries: exactly one wins and calves are created once', async () => {
    const d = await cow('D-RACE');
    const rec = (await breed({ damId: d.id, breedingDate: daysAgo(300) })).body.record;
    const before = await animalCount();
    const attempts = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        post(`/breeding/${rec.id}/delivery`, f.worker, {
          date: daysAgo(10),
          offspring: [{ register: { animalCode: `RACE-CALF-${n}`, sex: 'female' } }],
        }),
      ),
    );
    expect(attempts.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    expect(await animalCount()).toBe(before + 1);
  });

  it('late offspring can be added to a delivered record, but not to an open one', async () => {
    const d = await cow('D-LATE');
    const rec = (await breed({ damId: d.id, breedingDate: daysAgo(300) })).body.record;
    expect(
      (
        await post(`/breeding/${rec.id}/offspring`, f.worker, {
          offspring: [{ register: { sex: 'male' } }],
        })
      ).body.error.code,
    ).toBe('INVALID_TRANSITION');
    await post(`/breeding/${rec.id}/delivery`, f.worker, {
      date: daysAgo(10),
      offspring: [{ register: { animalCode: 'LATE-1', sex: 'female' } }],
    }).then((r) => expect(r.status).toBe(201));
    const more = await post(`/breeding/${rec.id}/offspring`, f.worker, {
      offspring: [{ register: { animalCode: 'LATE-2', sex: 'male' } }],
    });
    expect(more.status).toBe(201);
    expect(
      more.body.record.delivery.offspring.map(
        (o: { animal?: { animalCode: string } }) => o.animal?.animalCode,
      ),
    ).toEqual(['LATE-1', 'LATE-2']);
    expect((await post(`/breeding/${rec.id}/offspring`, f.worker, { offspring: [] })).status).toBe(
      400,
    );
  });

  it('voiding a delivered record releases the parent links but keeps every animal', async () => {
    const d = await cow('D-VOID');
    const s = await bull('S-VOID');
    const rec = (await breed({ damId: d.id, sireId: s.id, breedingDate: daysAgo(300) })).body
      .record;
    await post(`/breeding/${rec.id}/delivery`, f.worker, {
      date: daysAgo(10),
      offspring: [{ register: { animalCode: 'VOID-CALF', sex: 'female' } }],
    });
    const calf = (await Animal.findOne({ farmId: f.farmId, animalCode: 'VOID-CALF' }))!;
    expect(String(calf.damId)).toBe(d.id);

    expect((await post(`/breeding/${rec.id}/void`, f.worker, { reason: 'Wrong dam' })).status).toBe(
      403,
    );
    const voided = await post(`/breeding/${rec.id}/void`, f.manager, {
      reason: 'Recorded against the wrong dam',
    });
    expect(voided.status).toBe(200);
    const after = (await Animal.findById(calf._id))!;
    expect(after.damId).toBeNull();
    expect(after.sireId).toBeNull();
    expect(after.archivedAt).toBeFalsy(); // the animal itself is untouched
    expect(
      await AuditLog.countDocuments({
        action: 'breeding.offspring_unlinked',
        targetId: String(calf._id),
      }),
    ).toBe(1);
    // the dam is free again, and the calf can be linked to a correct record
    const d2 = await cow('D-VOID-2');
    const r2 = (await breed({ damId: d2.id, breedingDate: daysAgo(300) })).body.record;
    expect(
      (
        await post(`/breeding/${r2.id}/delivery`, f.worker, {
          date: daysAgo(10),
          offspring: [{ animalId: String(calf._id) }],
        })
      ).status,
    ).toBe(201);
    expect(String((await Animal.findById(calf._id))?.damId)).toBe(d2.id);
  });
});

describe('correcting breeding records', () => {
  it('corrects the date and sire of an open record with validation and history; the dam is fixed', async () => {
    const d = await cow('D-COR');
    const s1 = await bull('S-COR-1');
    const s2 = await bull('S-COR-2');
    const rec = (await breed({ damId: d.id, sireId: s1.id, breedingDate: daysAgo(40) })).body
      .record;
    const fixed = await post(`/breeding/${rec.id}/corrections`, f.manager, {
      reason: 'Wrong bull and date',
      changes: { sireId: s2.id, breedingDate: daysAgo(45) },
    });
    expect(fixed.status).toBe(200);
    expect(fixed.body.record).toMatchObject({
      sire: { animalCode: 'S-COR-2' },
      breedingDate: daysAgo(45),
      revision: 2,
    });
    expect(fixed.body.record.history[0].changes).toEqual(
      expect.arrayContaining([
        { field: 'sireId', from: s1.id, to: s2.id },
        { field: 'breedingDate', from: daysAgo(40), to: daysAgo(45) },
      ]),
    );
    for (const changes of [
      { damId: s1.id },
      { status: 'delivered' },
      { breedingDate: daysAhead(3) },
      { sireId: d.id },
    ]) {
      expect(
        (
          await post(`/breeding/${rec.id}/corrections`, f.manager, {
            reason: 'Trying something',
            changes,
          })
        ).status,
        JSON.stringify(changes),
      ).toBe(400);
    }
    expect(
      (
        await post(`/breeding/${rec.id}/corrections`, f.manager, {
          reason: 'Remove the sire',
          changes: { sireId: null },
        })
      ).body.record.sire,
    ).toBeUndefined();
  });

  it('after delivery the sire is locked and the breeding cannot move past the delivery', async () => {
    const d = await cow('D-LOCK');
    const s = await bull('S-LOCK');
    const other = await bull('S-LOCK-2');
    const rec = (await breed({ damId: d.id, sireId: s.id, breedingDate: daysAgo(300) })).body
      .record;
    await post(`/breeding/${rec.id}/delivery`, f.worker, {
      date: daysAgo(20),
      offspring: [{ register: { sex: 'male' } }],
    });
    const lock = await post(`/breeding/${rec.id}/corrections`, f.manager, {
      reason: 'Different bull',
      changes: { sireId: other.id },
    });
    expect(lock.status).toBe(409);
    expect(lock.body.error.code).toBe('SIRE_LOCKED');
    expect(
      (
        await post(`/breeding/${rec.id}/corrections`, f.manager, {
          reason: 'Later date',
          changes: { breedingDate: daysAgo(5) },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(`/breeding/${rec.id}/corrections`, f.manager, {
          reason: 'Earlier date',
          changes: { breedingDate: daysAgo(310) },
        })
      ).status,
    ).toBe(200);
  });
});

describe('who can do what, and what is traceable', () => {
  it('worker records events but cannot correct; viewer only reads; stranger gets 404', async () => {
    const d = await cow('D-PERM');
    expect((await breed({ damId: d.id, breedingDate: daysAgo(20) }, f.viewer)).status).toBe(403);
    const rec = (await breed({ damId: d.id, breedingDate: daysAgo(20) }, f.worker)).body.record;
    expect(
      (
        await post(`/breeding/${rec.id}/corrections`, f.worker, {
          reason: 'Fix the date',
          changes: { breedingDate: daysAgo(21) },
        })
      ).status,
    ).toBe(403);
    expect(
      (await post(`/breeding/${rec.id}/pregnancy`, f.viewer, { date: daysAgo(1) })).status,
    ).toBe(403);
    expect(
      (await post(`/breeding/${rec.id}/delivery`, f.viewer, { date: daysAgo(1), offspring: [] }))
        .status,
    ).toBe(403);
    expect((await get(`/breeding/${rec.id}`, f.viewer)).status).toBe(200);
    const stranger = await createFarmer(h.app);
    expect(
      (
        await api()
          .post(V(`/breeding/${rec.id}/pregnancy`))
          .set(stranger.auth)
          .send({ date: daysAgo(1) })
      ).status,
    ).toBe(404);
    await post(`/breeding/${rec.id}/failure`, f.worker, { date: daysAgo(2), reason: 'cleanup' });
  });

  it('lists with filters and pagination; the audit trail names the actor', async () => {
    const list = (qs = '') => get(`/breeding?${qs}`).then((r) => r.body);
    const all = await list('pageSize=100');
    expect(all.total).toBeGreaterThan(5);
    const delivered = await list('status=delivered&pageSize=100');
    expect(delivered.items.every((r: { status: string }) => r.status === 'delivered')).toBe(true);
    const dam = all.items[0].dam.id;
    expect(
      (await list(`damId=${dam}&pageSize=100`)).items.every(
        (r: { dam: { id: string } }) => r.dam.id === dam,
      ),
    ).toBe(true);
    expect((await list('pageSize=2&page=1')).items).toHaveLength(2);
    expect((await get('/breeding?status=pending')).status).toBe(400);
    expect(
      (await get(`/breeding?from=${daysAgo(60)}&pageSize=100`)).body.items.every(
        (r: { breedingDate: string }) => r.breedingDate >= daysAgo(60),
      ),
    ).toBe(true);
    const actions = new Set(
      (await AuditLog.find({ action: /^breeding\./ }).distinct('action')) as string[],
    );
    for (const a of [
      'breeding.created',
      'breeding.pregnancy_confirmed',
      'breeding.failed',
      'breeding.delivered',
      'breeding.offspring_added',
      'breeding.corrected',
      'breeding.voided',
      'breeding.offspring_linked',
      'breeding.offspring_unlinked',
    ]) {
      expect(actions.has(a), a).toBe(true);
    }
    expect(await BreedingRecord.countDocuments({ voided: true })).toBeGreaterThan(0); // voided records are still in the collection
  });
});
