import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../src/db/migrations';
import { AnimalType, AuditLog } from '../src/models';
import {
  createStaff,
  daysAgo,
  mkAnimal,
  setupFarm,
  startHarness,
  typeIdOf,
  type FarmSetup,
  type Session,
  type Staff,
  type TestHarness,
} from './helpers';

/**
 * Module 2 (fighting-cock breed catalogue) and Module 3 (chicken breeding, hatching, pedigree, F-generations).
 * Lineage always follows the real sire/dam; breed names are only suggested from them.
 */
let h: TestHarness;
let f: FarmSetup;
let admin: Staff;
let chicken: string;
beforeAll(async () => {
  h = await startHarness();
  f = await setupFarm(h.app);
  admin = await createStaff(h.app, ['admin']);
  chicken = await typeIdOf(h.app, f.owner, 'chicken');
});
afterAll(() => h.stop());

const api = () => request(h.app);
const F = (p: string) => `/api/v1/farms/${f.farmId}${p}`;
const post = (p: string, who: Session, body: object = {}) =>
  api().post(F(p)).set(who.auth).send(body);
const get = (p: string, who: Session = f.owner) => api().get(F(p)).set(who.auth);
let seq = 0;
const bird = (sex: 'male' | 'female', breed?: string, extra: object = {}) =>
  mkAnimal(h.app, f.owner, f.farmId, {
    animalCode: `C-${++seq}`,
    animalTypeId: chicken,
    sex,
    birthDate: daysAgo(400),
    rearingType: 'fighting_cock',
    ...(breed ? { breed } : {}),
    ...extra,
  });

/** Breed sire × dam, hatch `n` chicks with the suggested breed, and return the record and the chick ids. */
async function hatch(sireId: string, damId: string, n = 1, daysBack = 60) {
  const rec = await post('/breeding', f.worker, {
    damId,
    sireId,
    method: 'natural',
    breedingDate: daysAgo(daysBack),
    clutch: { eggsLaid: 8 },
  });
  expect(rec.status).toBe(201);
  const suggested = rec.body.record.offspringBreedSuggestion?.breed?.key;
  const done = await post(`/breeding/${rec.body.record.id}/delivery`, f.worker, {
    date: daysAgo(daysBack - 21),
    clutch: { eggsSet: 8, chicksHatched: n },
    offspring: Array.from({ length: n }, (_, i) => ({
      register: { sex: i % 2 ? 'female' : 'male', ...(suggested ? { breed: suggested } : {}) },
    })),
  });
  expect(done.status).toBe(201);
  const chicks = done.body.record.delivery.offspring.map(
    (o: { animal: { id: string } }) => o.animal.id,
  );
  return { record: done.body.record, chicks: chicks as string[], suggested };
}

describe('fighting-cock catalogue (data, not code)', () => {
  it('chicken offers the fighting-cock rearing type, 5 breed groups and the 39 starter breeds', async () => {
    const res = await api().get('/api/v1/animal-types').set(f.owner.auth);
    const type = res.body.animalTypes.find((t: { key: string }) => t.key === 'chicken');
    expect(type.reproduction).toBe('egg');
    expect(type.rearingTypes).toEqual([
      { key: 'fighting_cock', name: 'Fighting cock', nameTh: 'ไก่ชน', active: true },
    ]);
    expect(type.breedGroups.map((g: { key: string }) => g.key)).toEqual([
      'thai',
      'burmese',
      'saigon',
      'foreign',
      'crossbred',
    ]);
    const grouped = type.breeds.filter((b: { groupKey?: string }) => b.groupKey);
    expect(grouped).toHaveLength(39);
    const count = (g: string) =>
      grouped.filter((b: { groupKey: string }) => b.groupKey === g).length;
    expect([
      count('thai'),
      count('burmese'),
      count('saigon'),
      count('foreign'),
      count('crossbred'),
    ]).toEqual([10, 10, 4, 5, 10]);
    expect(grouped.find((b: { key: string }) => b.key === 'cross_burmese_thai')).toMatchObject({
      nameTh: 'พม่า + ไทย',
      composition: ['burmese', 'thai'],
    });
    // The older generic breeds are untouched.
    expect(type.breeds.map((b: { key: string }) => b.key)).toEqual(
      expect.arrayContaining(['native', 'layer', 'broiler']),
    );
  });

  it('administrators add, edit and deactivate breeds and groups; farmers cannot', async () => {
    const add = await api().post(`/api/v1/animal-types/${chicken}/breeds`).set(admin.auth).send({
      key: 'lueang_hang_dam',
      name: 'Lueang Hang Dam',
      nameTh: 'เหลืองหางดำ',
      groupKey: 'thai',
    });
    expect(add.status).toBe(201);
    expect(
      (
        await api()
          .post(`/api/v1/animal-types/${chicken}/breeds`)
          .set(admin.auth)
          .send({ key: 'bad_group', name: 'X', groupKey: 'no_such_group' })
      ).status,
    ).toBe(400);
    expect(
      (
        await api()
          .post(`/api/v1/animal-types/${chicken}/breeds`)
          .set(f.owner.auth)
          .send({ key: 'mine', name: 'Mine', groupKey: 'thai' })
      ).status,
    ).toBe(403);
    const group = await api()
      .post(`/api/v1/animal-types/${chicken}/breed-groups`)
      .set(admin.auth)
      .send({ key: 'pakoi', name: 'Pakoi', nameTh: 'ป่าก๋อย', rearingTypeKey: 'fighting_cock' });
    expect(group.status).toBe(201);
    expect(
      (
        await api()
          .patch(`/api/v1/animal-types/${chicken}/breeds/lueang_hang_dam`)
          .set(admin.auth)
          .send({ nameTh: 'เหลืองหางดำ (แก้ไข)' })
      ).body.animalType.breeds.find((b: { key: string }) => b.key === 'lueang_hang_dam').nameTh,
    ).toBe('เหลืองหางดำ (แก้ไข)');
    expect(await AuditLog.countDocuments({ action: 'animal_type.breed_group_added' })).toBe(1);
  });

  it('deactivating a breed hides it from pickers but keeps the history of animals that have it', async () => {
    const hen = await bird('female', 'khiao_lao');
    const off = await api()
      .patch(`/api/v1/animal-types/${chicken}/breeds/khiao_lao`)
      .set(admin.auth)
      .send({ active: false });
    expect(off.status).toBe(200);
    const picker = (
      await api().get('/api/v1/animal-types').set(f.owner.auth)
    ).body.animalTypes.find((t: { key: string }) => t.key === 'chicken');
    expect(picker.breeds.some((b: { key: string }) => b.key === 'khiao_lao')).toBe(false);
    // existing animal keeps its breed and display name
    const detail = await get(`/animals/${hen.id}`);
    expect(detail.body.animal).toMatchObject({
      breed: 'khiao_lao',
      breedNameTh: 'เขียวเลา',
      breedGroup: { key: 'thai', nameTh: 'สายพันธุ์ไก่ชนไทย' },
    });
    // new animals cannot use it
    expect(
      (await post('/animals', f.owner, { animalTypeId: chicken, sex: 'male', breed: 'khiao_lao' }))
        .status,
    ).toBe(400);
    await api()
      .patch(`/api/v1/animal-types/${chicken}/breeds/khiao_lao`)
      .set(admin.auth)
      .send({ active: true });
  });

  it('migration 0002 adds the catalogue to an existing database without touching what is there', async () => {
    const db = mongoose.connection.db!;
    const migration = MIGRATIONS.find((m) => m.id === '0002-fighting-cock-catalogue')!;
    // An "old" chicken type: generic breeds only, one renamed by an admin, no groups, no reproduction field.
    const legacy = 'chicken_legacy_check';
    await db.collection('animal_types').updateOne({ key: 'chicken' }, { $set: { key: legacy } });
    await db.collection('animal_types').insertOne({
      key: 'chicken',
      name: 'Chicken',
      status: 'active',
      breeds: [
        { key: 'native', name: 'Native (renamed)', active: true },
        { key: 'lai', name: 'Lai (admin edit)', active: false },
      ],
    });
    try {
      const log: string[] = [];
      await migration.up({ db, log: (m) => log.push(m) });
      const after = (await db.collection('animal_types').findOne({ key: 'chicken' }))!;
      expect(after['reproduction']).toBe('egg');
      expect(after['breedGroups']).toHaveLength(5);
      expect(after['breeds']).toHaveLength(2 + 38); // `lai` already existed and is left exactly as it was
      const lai = (after['breeds'] as { key: string; name: string; active: boolean }[]).find(
        (b) => b.key === 'lai',
      );
      expect(lai).toEqual({ key: 'lai', name: 'Lai (admin edit)', active: false });
      expect((after['breeds'] as { key: string; name: string }[])[0]!.name).toBe(
        'Native (renamed)',
      );
      // Idempotent: a second run changes nothing.
      await migration.up({ db, log: (m) => log.push(m) });
      const again = (await db.collection('animal_types').findOne({ key: 'chicken' }))!;
      expect(again['breeds']).toHaveLength(40);
      expect(log.at(-2)).toContain('added 0 rearing type(s), 0 group(s), 0 breed(s)');
    } finally {
      await db.collection('animal_types').deleteOne({ key: 'chicken' });
      await db.collection('animal_types').updateOne({ key: legacy }, { $set: { key: 'chicken' } });
    }
  });
});

describe('registering chickens', () => {
  it('stores rearing type, breed, cross-breeds; shows the breed group; filters by group', async () => {
    const res = await post('/animals', f.owner, {
      animalTypeId: chicken,
      sex: 'male',
      name: 'เจ้าสายฟ้า',
      breed: 'pama_ma_lo',
      crossBreeds: ['lueang_hang_khao'],
      rearingType: 'fighting_cock',
      color: 'เหลืองแดง',
      origin: { kind: 'purchased', note: 'ซื้อจากฟาร์มข้างเคียง' },
    });
    expect(res.status).toBe(201);
    expect(res.body.animal).toMatchObject({
      animalCode: expect.stringMatching(/^A-\d{5}$/),
      breedNameTh: 'พม่าม้าล่อ',
      breedGroup: { key: 'burmese' },
      rearingType: 'fighting_cock',
      crossBreeds: ['lueang_hang_khao'],
      origin: { kind: 'purchased' },
    });
    expect(
      (
        await post('/animals', f.owner, {
          animalTypeId: chicken,
          sex: 'male',
          rearingType: 'racing',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post('/animals', f.owner, {
          animalTypeId: chicken,
          sex: 'male',
          breed: 'lai',
          crossBreeds: ['lai'],
        })
      ).status,
    ).toBe(400);
    const burmese = await get('/animals?breedGroup=burmese&pageSize=100');
    expect(burmese.body.items.length).toBeGreaterThan(0);
    expect(
      burmese.body.items.every(
        (a: { breedGroup?: { key: string } }) => a.breedGroup?.key === 'burmese',
      ),
    ).toBe(true);
  });
});

describe('chicken breeding', () => {
  it('validates sex, identity and farm; records a code, the parents’ breeds and a breed suggestion', async () => {
    const rooster = await bird('male', 'pama_ma_lo');
    const hen = await bird('female', 'lueang_hang_khao');
    const hen2 = await bird('female', 'lueang_hang_khao');
    expect(
      (await post('/breeding', f.worker, { damId: rooster.id, breedingDate: daysAgo(5) })).status,
    ).toBe(400);
    expect(
      (
        await post('/breeding', f.worker, {
          damId: hen.id,
          sireId: hen2.id,
          breedingDate: daysAgo(5),
        })
      ).body.error.details[0].path,
    ).toBe('sireId');
    expect(
      (
        await post('/breeding', f.worker, {
          damId: hen.id,
          sireId: hen.id,
          breedingDate: daysAgo(5),
        })
      ).status,
    ).toBe(400);
    // A bird from another farm cannot be chosen (404-style "not found on this farm").
    const other = await setupFarm(h.app);
    const foreign = await mkAnimal(h.app, other.owner, other.farmId, {
      animalTypeId: chicken,
      sex: 'male',
    });
    expect(
      (
        await post('/breeding', f.worker, {
          damId: hen.id,
          sireId: foreign.id,
          breedingDate: daysAgo(5),
        })
      ).status,
    ).toBe(400);
    // The viewer may read but not record.
    expect(
      (await post('/breeding', f.viewer, { damId: hen.id, breedingDate: daysAgo(5) })).status,
    ).toBe(403);

    const res = await post('/breeding', f.worker, {
      damId: hen.id,
      sireId: rooster.id,
      method: 'artificial_insemination',
      breedingDate: daysAgo(10),
      clutch: { eggsLaid: 10, eggsFertile: 9 },
    });
    expect(res.status).toBe(201);
    expect(res.body.record).toMatchObject({
      code: expect.stringMatching(/^BR-\d{5}$/),
      reproduction: 'egg',
      method: 'artificial_insemination',
      clutch: { eggsLaid: 10, eggsFertile: 9 },
      sireBreed: { key: 'pama_ma_lo', nameTh: 'พม่าม้าล่อ', group: { key: 'burmese' } },
      damBreed: { key: 'lueang_hang_khao', group: { key: 'thai' } },
      offspringBreedSuggestion: {
        basis: 'composition_match',
        breed: { key: 'cross_burmese_thai', nameTh: 'พม่า + ไทย' },
        group: { key: 'crossbred' },
      },
    });
    const id = res.body.record.id;
    // Clutch counts must stay consistent.
    const bad = await post(`/breeding/${id}/clutch`, f.worker, { clutch: { eggsSet: 11 } });
    expect(bad.status).toBe(400);
    const ok = await post(`/breeding/${id}/clutch`, f.worker, { clutch: { eggsSet: 9 } });
    expect(ok.body.record.clutch).toEqual({ eggsLaid: 10, eggsFertile: 9, eggsSet: 9 });
    const full = await get(`/breeding/${id}`);
    expect(full.body.record.history.at(-1).changes).toEqual([
      { field: 'clutch.eggsSet', from: null, to: 9 },
    ]);
    // Breeding history of one animal (as dam or sire)
    const hist = await get(`/breeding?animalId=${rooster.id}`);
    expect(hist.body.items.map((r: { id: string }) => r.id)).toEqual([id]);
  });

  it('hatching registers the chicks linked to both parents, inheriting the rearing type (F1)', async () => {
    const sire = await bird('male', 'pama_ma_lo', { name: 'เจ้าสายฟ้า' });
    const dam = await bird('female', 'lueang_hang_khao', { name: 'แม่ทองดี' });
    const { record, chicks, suggested } = await hatch(sire.id, dam.id, 3);
    expect(suggested).toBe('cross_burmese_thai');
    expect(record.clutch).toEqual({ eggsLaid: 8, eggsSet: 8, chicksHatched: 3 });
    expect(chicks).toHaveLength(3);
    const chick = (await get(`/animals/${chicks[0]}`)).body.animal;
    expect(chick).toMatchObject({
      sire: { id: sire.id },
      dam: { id: dam.id },
      breed: 'cross_burmese_thai',
      breedGroup: { key: 'crossbred' },
      rearingType: 'fighting_cock',
      origin: { kind: 'born_on_farm' },
    });
    const lineage = (await get(`/animals/${chicks[0]}/lineage`)).body;
    expect(lineage.pedigree.animal.filialGeneration).toBe(1);
    expect(lineage.pedigree.sire.animal).toMatchObject({
      id: sire.id,
      breedNameTh: 'พม่าม้าล่อ',
      filialGeneration: 0,
    });
    expect(lineage.pedigree.dam.animal).toMatchObject({ id: dam.id, filialGeneration: 0 });
    expect(lineage.siblings.map((s: { relation: string }) => s.relation)).toEqual(['full', 'full']);
    const sireLineage = (await get(`/animals/${sire.id}/lineage`)).body;
    expect(sireLineage.offspring).toHaveLength(3);
    expect(
      sireLineage.offspring.every((o: { filialGeneration: number }) => o.filialGeneration === 1),
    ).toBe(true);
  });

  it('F1 × Burmese → F2, F2 × Saigon → F3, with grandparents visible and breed suggestions from real parents', async () => {
    const s0 = await bird('male', 'pama_ma_lo');
    const d0 = await bird('female', 'lueang_hang_khao');
    const [f1] = (await hatch(s0.id, d0.id, 1, 300)).chicks; // male F1, Burmese + Thai
    const burmeseHen = await bird('female', 'pama_ramwong');
    const f2run = await hatch(f1!, burmeseHen.id, 1, 120);
    expect(f2run.suggested).toBe('cross_burmese_thai'); // {burmese, thai} ∪ {burmese}
    const f2 = f2run.chicks[0]!; // male
    const saigonHen = await bird('female', 'saigon');
    const f3run = await hatch(f2, saigonHen.id, 2, 60);
    expect(f3run.suggested).toBe('cross_burmese_saigon_thai');

    const lin = (await get(`/animals/${f3run.chicks[0]}/lineage?generations=4`)).body;
    expect(lin.pedigree.animal.filialGeneration).toBe(3);
    expect(lin.pedigree.sire.animal.filialGeneration).toBe(2);
    expect(lin.pedigree.sire.sire.animal.filialGeneration).toBe(1);
    expect(lin.pedigree.sire.sire.sire.animal.id).toBe(s0.id); // great-grandsire
    expect(lin.pedigree.sire.dam.animal.id).toBe(burmeseHen.id); // grandmother
    expect(lin.pedigree.dam.animal).toMatchObject({ id: saigonHen.id, filialGeneration: 0 });
    expect(lin.generation).toBe(3);
  });

  it('an unknown parent stays unknown: no generation or lineage is invented', async () => {
    const hen = await bird('female', 'nok_daeng');
    const rec = await post('/breeding', f.worker, {
      damId: hen.id,
      sireExternal: { name: 'พ่อไก่ไม่ทราบที่มา' },
      breedingDate: daysAgo(40),
    });
    expect(rec.status).toBe(201);
    expect(rec.body.record.offspringBreedSuggestion.basis).toBe('parent_unknown');
    const done = await post(`/breeding/${rec.body.record.id}/delivery`, f.worker, {
      date: daysAgo(19),
      offspring: [{ register: { sex: 'female' } }],
    });
    const chick = done.body.record.delivery.offspring[0].animal.id;
    const lin = (await get(`/animals/${chick}/lineage`)).body;
    expect(lin.dam.id).toBe(hen.id);
    expect(lin.sire).toBeUndefined();
    expect(lin.pedigree.animal.filialGeneration).toBeNull();
    // A bought-in bird with no parents is parent stock.
    const bought = await bird('male', 'brazil', { origin: { kind: 'purchased' } });
    expect((await get(`/animals/${bought.id}/lineage`)).body.pedigree.animal.filialGeneration).toBe(
      0,
    );
  });

  it('blocks circular pedigrees and audits every lineage change with old and new parents', async () => {
    const s = await bird('male', 'chi');
    const d = await bird('female', 'chi');
    const { chicks } = await hatch(s.id, d.id, 1, 200);
    const son = chicks[0]!;
    // The son cannot become his own father's sire.
    const loop = await api()
      .patch(F(`/animals/${s.id}`))
      .set(f.owner.auth)
      .send({ sireId: son });
    expect(loop.status).toBe(400);
    // Clearing and setting a parent is audited with from/to.
    const otherSire = await bird('male', 'chi', { birthDate: daysAgo(500) });
    const change = await api()
      .patch(F(`/animals/${son}`))
      .set(f.owner.auth)
      .send({ sireId: otherSire.id });
    expect(change.status).toBe(200);
    const log = await AuditLog.findOne({ action: 'animal.updated', targetId: son }).sort({
      createdAt: -1,
    });
    expect(log?.metadata?.['lineage']).toEqual({ sireId: { from: s.id, to: otherSire.id } });
  });

  it('breeding is a separate permission: without breeding.read the timeline omits breeding records', async () => {
    const hen = await bird('female', 'lai');
    await post('/breeding', f.worker, { damId: hen.id, breedingDate: daysAgo(3) }).expect(201);
    const all = await get(`/animals/${hen.id}/history?types=breeding`);
    expect(all.body.items.length).toBeGreaterThan(0);
    const members = (await get('/members')).body.members as { id: string; userId: string }[];
    const worker = members.find((m) => m.userId === f.worker.id)!;
    await api()
      .put(F(`/members/${worker.id}/permissions`))
      .set(f.owner.auth)
      .send({ permissions: ['animals.read', 'records.read'] })
      .expect(200);
    const narrowed = await get(`/animals/${hen.id}/history?types=breeding`, f.worker);
    expect(narrowed.status).toBe(200);
    expect(narrowed.body.items).toEqual([]);
    expect((await get('/breeding', f.worker)).status).toBe(403);
    await api()
      .put(F(`/members/${worker.id}/permissions`))
      .set(f.owner.auth)
      .send({ permissions: null })
      .expect(200);
  });
});

it('catalogue lookups never depend on keys in code (sanity: chicken type is a normal document)', async () => {
  expect(await AnimalType.countDocuments({ key: 'chicken' })).toBe(1);
});
