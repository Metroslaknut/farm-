import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Animal, AnimalPhoto, AnimalType, AuditLog } from '../src/models';
import {
  addFarmMember,
  createFarmer,
  createStaff,
  createUser,
  makeFarm,
  startHarness,
  typeIdOf,
  type Session,
  type Staff,
  type TestHarness,
} from './helpers';

let h: TestHarness;
let admin: Staff;
let owner: Session;
let farmId: string;
let buffalo: string;
let cattle: string;

beforeAll(async () => {
  h = await startHarness();
  admin = await createStaff(h.app, ['admin']);
  owner = await createFarmer(h.app);
  farmId = await makeFarm(h.app, owner);
  buffalo = await typeIdOf(h.app, owner, 'buffalo');
  cattle = await typeIdOf(h.app, owner, 'cattle');
});
afterAll(() => h.stop());

const api = () => request(h.app);
const V = (p: string) => `/api/v1${p}`;
const animals = (fid = farmId) => `/farms/${fid}/animals`;
const create = (body: object, who: Session = owner, fid = farmId) =>
  api()
    .post(V(animals(fid)))
    .set(who.auth)
    .send(body);
const newFarmWithOwner = async () => {
  const o = await createFarmer(h.app);
  return { o, fid: await makeFarm(h.app, o, 'Second Farm') };
};

describe('animal types are configurable data, not code', () => {
  it('any signed-in user can read the starter catalogue (several species, with breeds)', async () => {
    const res = await api().get(V('/animal-types')).set(owner.auth);
    expect(res.status).toBe(200);
    const keys = res.body.animalTypes.map((t: { key: string }) => t.key);
    expect(keys).toEqual(
      expect.arrayContaining(['buffalo', 'cattle', 'goat', 'pig', 'chicken', 'duck']),
    );
    expect(
      res.body.animalTypes.find((t: { key: string }) => t.key === 'buffalo').breeds.length,
    ).toBeGreaterThan(0);
    expect(await AnimalType.countDocuments({ isSeeded: true })).toBeGreaterThanOrEqual(6);
  });

  it('only animal_types.manage holders change it (admin yes; farmer, support no)', async () => {
    const body = {
      key: 'alpaca',
      name: 'Alpaca',
      nameTh: 'อัลปากา',
      breeds: [{ key: 'huacaya', name: 'Huacaya' }],
    };
    expect((await api().post(V('/animal-types')).set(owner.auth).send(body)).status).toBe(403);
    const support = await createStaff(h.app, ['support']);
    expect((await api().post(V('/animal-types')).set(support.auth).send(body)).status).toBe(403);
    const weakAdmin = await createStaff(h.app, ['admin'], { enrollMfa: false });
    expect(
      (await api().post(V('/animal-types')).set(weakAdmin.auth).send(body)).body.error.code,
    ).toBe('MFA_REQUIRED');

    const res = await api().post(V('/animal-types')).set(admin.auth).send(body);
    expect(res.status).toBe(201);
    expect(res.body.animalType).toMatchObject({
      key: 'alpaca',
      status: 'active',
      breeds: [{ key: 'huacaya', active: true }],
    });
    expect((await api().post(V('/animal-types')).set(admin.auth).send(body)).status).toBe(409);
    expect(
      (await api().post(V('/animal-types')).set(admin.auth).send({ key: 'Bad Key', name: 'x' }))
        .status,
    ).toBe(400);
    expect(
      (
        await api()
          .post(V('/animal-types'))
          .set(admin.auth)
          .send({
            key: 'dupbreeds',
            name: 'x',
            breeds: [
              { key: 'a', name: 'A' },
              { key: 'a', name: 'B' },
            ],
          })
      ).status,
    ).toBe(400);
    expect(
      await AuditLog.countDocuments({ action: 'animal_type.created', 'metadata.key': 'alpaca' }),
    ).toBe(1);
  });

  it('a brand-new species works end-to-end with no code change', async () => {
    const alpaca = await typeIdOf(h.app, owner, 'alpaca');
    const res = await create({
      animalTypeId: alpaca,
      sex: 'female',
      breed: 'huacaya',
      name: 'Dolly',
    });
    expect(res.status).toBe(201);
    expect(res.body.animal.animalType).toMatchObject({ key: 'alpaca', name: 'Alpaca' });
  });

  it('inactive types and breeds disappear from pickers and cannot be used for new animals; old animals keep them', async () => {
    await api()
      .post(V('/animal-types'))
      .set(admin.auth)
      .send({
        key: 'llama',
        name: 'Llama',
        breeds: [
          { key: 'classic', name: 'Classic' },
          { key: 'woolly', name: 'Woolly' },
        ],
      })
      .expect(201);
    const llama = await typeIdOf(h.app, owner, 'llama');
    const kept = (await create({ animalTypeId: llama, sex: 'male', breed: 'woolly' })).body.animal;

    await api()
      .patch(V(`/animal-types/${llama}/breeds/woolly`))
      .set(admin.auth)
      .send({ active: false })
      .expect(200);
    expect((await create({ animalTypeId: llama, sex: 'male', breed: 'woolly' })).status).toBe(400);
    expect((await create({ animalTypeId: llama, sex: 'male', breed: 'classic' })).status).toBe(201);
    const picker = (await api().get(V('/animal-types')).set(owner.auth)).body.animalTypes.find(
      (t: { key: string }) => t.key === 'llama',
    );
    expect(picker.breeds.map((b: { key: string }) => b.key)).toEqual(['classic']);
    const adminView = (
      await api().get(V('/animal-types?includeInactive=true')).set(admin.auth)
    ).body.animalTypes.find((t: { key: string }) => t.key === 'llama');
    expect(adminView.breeds).toHaveLength(2);
    expect((await api().get(V('/animal-types?includeInactive=true')).set(owner.auth)).status).toBe(
      403,
    );
    expect(
      (
        await api()
          .get(V(`/farms/${farmId}/animals/${kept.id}`))
          .set(owner.auth)
      ).body.animal.breed,
    ).toBe('woolly');

    await api()
      .patch(V(`/animal-types/${llama}`))
      .set(admin.auth)
      .send({ status: 'inactive' })
      .expect(200);
    const gone = await create({ animalTypeId: llama, sex: 'male' });
    expect(gone.status).toBe(400);
    expect(gone.body.error.details[0].path).toBe('animalTypeId');
    expect(
      (await api().get(V('/animal-types')).set(owner.auth)).body.animalTypes.some(
        (t: { key: string }) => t.key === 'llama',
      ),
    ).toBe(false);
    expect(
      (
        await api()
          .post(V(`/animal-types/${llama}/breeds`))
          .set(admin.auth)
          .send({ key: 'classic', name: 'Dup' })
      ).status,
    ).toBe(409);
    expect(
      (
        await api()
          .post(V(`/animal-types/${llama}/breeds`))
          .set(admin.auth)
          .send({ key: 'suri', name: 'Suri' })
      ).status,
    ).toBe(201);
    expect(
      await AuditLog.countDocuments({ action: { $regex: '^animal_type\\.' } }),
    ).toBeGreaterThanOrEqual(5);
  });
});

describe('registering animals: required fields and validation', () => {
  it('needs only a type and a sex; the server issues the identifier', async () => {
    const first = await create({ animalTypeId: buffalo, sex: 'female' });
    expect(first.status).toBe(201);
    expect(first.body.animal).toMatchObject({
      animalCode: expect.stringMatching(/^A-\d{5}$/),
      farmId,
      currentStatus: 'active',
      archived: false,
      origin: { kind: 'born_on_farm' },
      offspringCount: 0,
    });
    const second = await create({ animalTypeId: buffalo, sex: 'male' });
    expect(Number(second.body.animal.animalCode.slice(2))).toBe(
      Number(first.body.animal.animalCode.slice(2)) + 1,
    );
  });

  it('stores the full record, with dates as calendar days', async () => {
    const res = await create({
      animalCode: 'TH-0001',
      animalTypeId: buffalo,
      breed: 'swamp',
      name: 'Thong',
      sex: 'female',
      birthDate: '2022-03-15',
      birthDateEstimated: true,
      acquisitionDate: '2022-03-20',
      origin: { kind: 'purchased', note: 'From Khon Kaen market' },
      currentStatus: 'for_sale',
      notes: 'Calm temperament',
    });
    expect(res.status).toBe(201);
    expect(res.body.animal).toMatchObject({
      animalCode: 'TH-0001',
      breed: 'swamp',
      breedName: 'Swamp buffalo',
      name: 'Thong',
      sex: 'female',
      birthDate: '2022-03-15',
      birthDateEstimated: true,
      acquisitionDate: '2022-03-20',
      origin: { kind: 'purchased', note: 'From Khon Kaen market' },
      currentStatus: 'for_sale',
      notes: 'Calm temperament',
    });
  });

  it.each([
    ['missing sex', { animalTypeId: 'T' }, 'sex'],
    ['missing type', { sex: 'male' }, 'animalTypeId'],
    ['malformed type id', { animalTypeId: 'nope', sex: 'male' }, 'animalTypeId'],
    ['unknown type', { animalTypeId: '0123456789abcdef01234567', sex: 'male' }, 'animalTypeId'],
    ['bad sex', { animalTypeId: 'T', sex: 'robot' }, 'sex'],
    ['code with spaces', { animalTypeId: 'T', sex: 'male', animalCode: 'A 1' }, 'animalCode'],
    ['code too long', { animalTypeId: 'T', sex: 'male', animalCode: 'A'.repeat(41) }, 'animalCode'],
    ['future birth date', { animalTypeId: 'T', sex: 'male', birthDate: '2999-01-01' }, 'birthDate'],
    ['impossible date', { animalTypeId: 'T', sex: 'male', birthDate: '2022-02-31' }, 'birthDate'],
    [
      'acquired before birth',
      { animalTypeId: 'T', sex: 'male', birthDate: '2022-05-01', acquisitionDate: '2022-04-01' },
      'acquisitionDate',
    ],
    ['breed of another species', { animalTypeId: 'T', sex: 'male', breed: 'brahman' }, 'breed'],
    ['bad status', { animalTypeId: 'T', sex: 'male', currentStatus: 'flying' }, 'currentStatus'],
    ['bad origin', { animalTypeId: 'T', sex: 'male', origin: { kind: 'stolen' } }, 'origin.kind'],
    ['overlong notes', { animalTypeId: 'T', sex: 'male', notes: 'x'.repeat(2001) }, 'notes'],
  ] as [string, Record<string, unknown>, string][])(
    'rejects %s with a field-level error',
    async (_name, body, path) => {
      const res = await create({
        ...body,
        ...(body['animalTypeId'] === 'T' ? { animalTypeId: buffalo } : {}),
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
    },
  );

  it('ignores nothing silently: farmId, status flags and server fields are rejected', async () => {
    for (const extra of [
      { farmId: '0123456789abcdef01234567' },
      { archivedAt: '2020-01-01' },
      { createdBy: 'x' },
      { media: [] },
    ]) {
      expect(
        (await create({ animalTypeId: buffalo, sex: 'male', ...extra })).status,
        JSON.stringify(extra),
      ).toBe(400);
    }
  });
});

describe('animal identifiers are unique within the farm', () => {
  it('rejects a duplicate code with 409 and a field error, case-insensitively', async () => {
    await create({ animalCode: 'DUP-1', animalTypeId: buffalo, sex: 'male' }).expect(201);
    for (const code of ['DUP-1', 'dup-1', 'Dup-1']) {
      const res = await create({ animalCode: code, animalTypeId: buffalo, sex: 'male' });
      expect(res.status, code).toBe(409);
      expect(res.body.error.code).toBe('DUPLICATE_ANIMAL_CODE');
      expect(res.body.error.details[0]).toMatchObject({ path: 'animalCode' });
    }
    expect(await Animal.countDocuments({ farmId, animalCode: /^dup-1$/i })).toBe(1);
  });

  it('the same code can exist on a different farm (the scope is the farm)', async () => {
    const { o, fid } = await newFarmWithOwner();
    expect(
      (await create({ animalCode: 'DUP-1', animalTypeId: buffalo, sex: 'female' }, o, fid)).status,
    ).toBe(201);
  });

  it('an archived animal keeps its code reserved', async () => {
    const a = (await create({ animalCode: 'RETIRED-1', animalTypeId: buffalo, sex: 'male' })).body
      .animal;
    await api()
      .post(V(`${animals()}/${a.id}/archive`))
      .set(owner.auth)
      .send({})
      .expect(200);
    expect(
      (await create({ animalCode: 'retired-1', animalTypeId: buffalo, sex: 'male' })).status,
    ).toBe(409);
  });

  it('concurrent registrations of one code: exactly one wins', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        create({ animalCode: 'RACE-1', animalTypeId: buffalo, sex: 'male' }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409, 409]);
    expect(await Animal.countDocuments({ farmId, animalCode: 'RACE-1' })).toBe(1);
  });

  it('server-issued codes skip over hand-entered ones and never collide, even in parallel', async () => {
    const { o, fid } = await newFarmWithOwner();
    await create({ animalCode: 'A-00001', animalTypeId: buffalo, sex: 'male' }, o, fid).expect(201);
    await create({ animalCode: 'a-00003', animalTypeId: buffalo, sex: 'male' }, o, fid).expect(201);
    const batch = await Promise.all(
      Array.from({ length: 5 }, () => create({ animalTypeId: buffalo, sex: 'female' }, o, fid)),
    );
    expect(batch.every((r) => r.status === 201)).toBe(true);
    const codes = batch.map((r) => r.body.animal.animalCode);
    expect(new Set(codes).size).toBe(5);
    expect(codes).not.toContain('A-00001');
    expect(codes.map((c: string) => c.toUpperCase())).not.toContain('A-00003');
  });

  it('the identifier, type and farm of an existing animal can never be changed', async () => {
    const a = (await create({ animalCode: 'FIXED-1', animalTypeId: buffalo, sex: 'male' })).body
      .animal;
    for (const body of [
      { animalCode: 'NEW-1' },
      { animalTypeId: cattle },
      { farmId: '0123456789abcdef01234567' },
    ]) {
      expect(
        (
          await api()
            .patch(V(`${animals()}/${a.id}`))
            .set(owner.auth)
            .send(body)
        ).status,
        JSON.stringify(body),
      ).toBe(400);
    }
  });
});

describe('parent references', () => {
  const mk = async (over: object) => (await create({ animalTypeId: buffalo, ...over })).body.animal;

  it('links known parents on the same farm and reports them on the child', async () => {
    const sire = await mk({ animalCode: 'SIRE-1', sex: 'male', birthDate: '2015-01-01' });
    const dam = await mk({
      animalCode: 'DAM-1',
      sex: 'female',
      name: 'Mother',
      birthDate: '2016-01-01',
    });
    const calf = await create({
      animalCode: 'CALF-1',
      animalTypeId: buffalo,
      sex: 'female',
      birthDate: '2023-06-01',
      sireId: sire.id,
      damId: dam.id,
    });
    expect(calf.status).toBe(201);
    expect(calf.body.animal.sire).toMatchObject({ id: sire.id, animalCode: 'SIRE-1' });
    expect(calf.body.animal.dam).toMatchObject({ animalCode: 'DAM-1', name: 'Mother' });
    expect(
      (
        await api()
          .get(V(`${animals()}/${dam.id}`))
          .set(owner.auth)
      ).body.animal.offspringCount,
    ).toBe(1);
  });

  it('rejects parents that make no sense', async () => {
    const male = await mk({ animalCode: 'M-1', sex: 'male', birthDate: '2015-01-01' });
    const female = await mk({ animalCode: 'F-1', sex: 'female' });
    const cow = (await create({ animalCode: 'COW-1', animalTypeId: cattle, sex: 'female' })).body
      .animal;
    const { o, fid } = await newFarmWithOwner();
    const foreign = (
      await create({ animalCode: 'FOREIGN-1', animalTypeId: buffalo, sex: 'male' }, o, fid)
    ).body.animal;
    const base = { animalTypeId: buffalo, sex: 'male' };
    const bad: [string, object, string][] = [
      ['female sire', { sireId: female.id }, 'sireId'],
      ['male dam', { damId: male.id }, 'damId'],
      ['other species', { damId: cow.id }, 'damId'],
      ['parent from another farm', { sireId: foreign.id }, 'sireId'],
      ['unknown parent', { sireId: '0123456789abcdef01234567' }, 'sireId'],
      ['same animal as sire and dam', { sireId: male.id, damId: male.id }, 'damId'],
      ['born before the parent', { sireId: male.id, birthDate: '2010-01-01' }, 'birthDate'],
    ];
    for (const [name, body, path] of bad) {
      const res = await create({ ...base, ...body });
      expect(res.status, name).toBe(400);
      expect(
        res.body.error.details.map((d: { path: string }) => d.path),
        name,
      ).toContain(path);
    }
  });

  it('on update: not your own parent, no ancestry loops, and sex cannot contradict offspring', async () => {
    const grand = await mk({ animalCode: 'G-1', sex: 'female' });
    const parent = await mk({ animalCode: 'P-1', sex: 'male', damId: grand.id });
    const child = await mk({ animalCode: 'C-1', sex: 'female', sireId: parent.id });
    const patch = (id: string, body: object) =>
      api()
        .patch(V(`${animals()}/${id}`))
        .set(owner.auth)
        .send(body);

    expect((await patch(child.id, { damId: child.id })).status).toBe(400);
    const loop = await patch(grand.id, { damId: child.id }); // child descends from grand
    expect(loop.status).toBe(400);
    expect(loop.body.error.details[0].message).toMatch(/ancestor/);
    expect((await patch(parent.id, { sex: 'female' })).body.error.code).toBe('SEX_CONFLICT');
    expect((await patch(grand.id, { sex: 'male' })).body.error.code).toBe('SEX_CONFLICT');
    expect((await patch(child.id, { sireId: null })).body.animal.sire).toBeUndefined();
  });
});

describe('listing: pagination, search, filters, sorting', () => {
  let fid: string;
  let o: Session;
  beforeAll(async () => {
    ({ o, fid } = await newFarmWithOwner());
    const rows = [
      ['A-1', buffalo, 'female', 'swamp', 'Bua', 'active', '2020-01-01'],
      ['A-2', buffalo, 'male', 'murrah', 'Khem', 'for_sale', '2021-06-01'],
      ['A-10', buffalo, 'female', 'swamp', 'Dao', 'sold', '2019-03-03'],
      ['B-1', cattle, 'male', 'brahman', 'Daeng', 'active', '2022-02-02'],
      ['B-2', cattle, 'female', undefined, undefined, 'deceased', undefined],
    ] as const;
    for (const [animalCode, animalTypeId, sex, breed, name, currentStatus, birthDate] of rows) {
      await create(
        {
          animalCode,
          animalTypeId,
          sex,
          currentStatus,
          ...(breed ? { breed } : {}),
          ...(name ? { name } : {}),
          ...(birthDate ? { birthDate } : {}),
        },
        o,
        fid,
      ).expect(201);
    }
    const gone = (await create({ animalCode: 'Z-9', animalTypeId: buffalo, sex: 'male' }, o, fid))
      .body.animal;
    await api()
      .post(V(`${animals(fid)}/${gone.id}/archive`))
      .set(o.auth)
      .send({ reason: 'Sold to neighbour' })
      .expect(200);
  });
  const list = async (qs = '') =>
    (
      await api()
        .get(V(`${animals(fid)}?${qs}`))
        .set(o.auth)
    ).body;
  const codes = (r: { items: { animalCode: string }[] }) => r.items.map((i) => i.animalCode);

  it('paginates with totals and hides archived animals by default', async () => {
    const p1 = await list('pageSize=2&page=1&sortBy=animalCode&order=asc');
    expect(p1).toMatchObject({ total: 5, page: 1, pageSize: 2 });
    expect(codes(p1)).toEqual(['A-1', 'A-2']);
    expect(codes(await list('pageSize=2&page=3&sortBy=animalCode&order=asc'))).toEqual(['B-2']);
    expect((await list('pageSize=2&page=9')).items).toEqual([]);
    expect(codes(await list('archived=true'))).toEqual(['Z-9']);
    expect((await list('archived=all')).total).toBe(6);
    for (const bad of [
      'pageSize=0',
      'pageSize=101',
      'page=0',
      'page=abc',
      'sortBy=password',
      'order=sideways',
      'archived=maybe',
    ]) {
      expect(
        (
          await api()
            .get(V(`${animals(fid)}?${bad}`))
            .set(o.auth)
        ).status,
        bad,
      ).toBe(400);
    }
  });

  it('sorts codes naturally (A-2 before A-10) and case-insensitively', async () => {
    expect(codes(await list('sortBy=animalCode&order=asc'))).toEqual([
      'A-1',
      'A-2',
      'A-10',
      'B-1',
      'B-2',
    ]);
    expect(codes(await list('sortBy=animalCode&order=desc')).slice(0, 2)).toEqual(['B-2', 'B-1']);
  });

  it('filters by type, breed, sex and status, alone and combined', async () => {
    const ids = (await api().get(V('/animal-types')).set(o.auth)).body.animalTypes;
    expect(codes(await list(`animalTypeId=${cattle}&sortBy=animalCode&order=asc`))).toEqual([
      'B-1',
      'B-2',
    ]);
    expect(codes(await list('breed=swamp&sortBy=animalCode&order=asc'))).toEqual(['A-1', 'A-10']);
    expect(codes(await list('sex=male&sortBy=animalCode&order=asc'))).toEqual(['A-2', 'B-1']);
    expect(codes(await list('status=active&sortBy=animalCode&order=asc'))).toEqual(['A-1', 'B-1']);
    expect(codes(await list(`animalTypeId=${buffalo}&sex=female&breed=swamp&status=sold`))).toEqual(
      ['A-10'],
    );
    expect((await list('status=lost')).items).toEqual([]);
    expect(ids.length).toBeGreaterThan(1);
  });

  it('searches code and name (case-insensitive, regex-safe)', async () => {
    expect(codes(await list('q=da&sortBy=animalCode&order=asc'))).toEqual(['A-10', 'B-1']); // Dao, Daeng
    expect(codes(await list('q=b-'))).toEqual(expect.arrayContaining(['B-1', 'B-2']));
    expect((await list('q=.*')).items).toEqual([]); // not interpreted as a pattern
    expect((await list('q=' + encodeURIComponent('(['))).items).toEqual([]);
  });

  it('list rows are summaries with the type name resolved', async () => {
    const row = (await list('q=Bua')).items[0];
    expect(row).toMatchObject({
      animalCode: 'A-1',
      name: 'Bua',
      animalType: { key: 'buffalo', name: 'Buffalo' },
      sex: 'female',
      archived: false,
    });
    expect(row).not.toHaveProperty('notes');
  });
});

describe('who may do what with animals (farm roles)', () => {
  it('viewer reads; worker registers/edits; only manager and owner archive', async () => {
    const o = await createFarmer(h.app);
    const fid = await makeFarm(h.app, o);
    const [manager, worker, viewer] = [
      await createUser(h.app),
      await createUser(h.app),
      await createUser(h.app),
    ];
    await addFarmMember(h.app, o, fid, manager, 'manager');
    await addFarmMember(h.app, o, fid, worker, 'worker');
    await addFarmMember(h.app, o, fid, viewer, 'viewer');
    const a = (await create({ animalCode: 'ROLE-1', animalTypeId: buffalo, sex: 'male' }, o, fid))
      .body.animal;

    for (const who of [o, manager, worker, viewer]) {
      expect(
        (
          await api()
            .get(V(`${animals(fid)}/${a.id}`))
            .set(who.auth)
        ).status,
      ).toBe(200);
      expect(
        (
          await api()
            .get(V(animals(fid)))
            .set(who.auth)
        ).status,
      ).toBe(200);
    }
    const denied = await create({ animalTypeId: buffalo, sex: 'male' }, viewer, fid);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FARM_FORBIDDEN');
    expect(
      (
        await api()
          .patch(V(`${animals(fid)}/${a.id}`))
          .set(viewer.auth)
          .send({ name: 'x' })
      ).status,
    ).toBe(403);
    expect(
      (await create({ animalCode: 'ROLE-2', animalTypeId: buffalo, sex: 'male' }, worker, fid))
        .status,
    ).toBe(201);
    expect(
      (
        await api()
          .patch(V(`${animals(fid)}/${a.id}`))
          .set(worker.auth)
          .send({ name: 'Edited' })
      ).status,
    ).toBe(200);
    expect(
      (
        await api()
          .post(V(`${animals(fid)}/${a.id}/archive`))
          .set(worker.auth)
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await api()
          .post(V(`${animals(fid)}/${a.id}/archive`))
          .set(viewer.auth)
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await api()
          .post(V(`${animals(fid)}/${a.id}/archive`))
          .set(manager.auth)
          .send({ reason: 'Moved' })
      ).status,
    ).toBe(200);
    expect(
      (
        await api()
          .post(V(`${animals(fid)}/${a.id}/restore`))
          .set(worker.auth)
      ).status,
    ).toBe(403);
    expect(
      (
        await api()
          .post(V(`${animals(fid)}/${a.id}/restore`))
          .set(o.auth)
      ).status,
    ).toBe(200);
  });

  it('an animal id from one farm never works through another farm (IDOR)', async () => {
    const a = (
      await create({ animalCode: 'SECRET-1', animalTypeId: buffalo, sex: 'male', notes: 'private' })
    ).body.animal;
    const { o, fid } = await newFarmWithOwner();
    const base = V(`${animals(fid)}/${a.id}`);
    expect((await api().get(base).set(o.auth)).status).toBe(404);
    expect((await api().patch(base).set(o.auth).send({ name: 'Stolen' })).status).toBe(404);
    expect((await api().post(`${base}/archive`).set(o.auth).send({})).status).toBe(404);
    expect(
      (
        await api()
          .post(`${base}/media`)
          .set(o.auth)
          .send({ kind: 'photo', url: 'https://cdn.test/x.jpg' })
      ).status,
    ).toBe(404);
    // and the owner of the other farm cannot even reach the first farm's list
    expect(
      (
        await api()
          .get(V(animals(farmId)))
          .set(o.auth)
      ).status,
    ).toBe(404);
    expect((await Animal.findById(a.id))?.name).toBeNull();
  });

  it('GET /animals/:id (deep links) authorises through the animal’s farm', async () => {
    const a = (await create({ animalCode: 'DEEP-1', animalTypeId: buffalo, sex: 'male' })).body
      .animal;
    const ok = await api()
      .get(V(`/animals/${a.id}`))
      .set(owner.auth);
    expect(ok.status).toBe(200);
    expect(ok.body.animal.animalCode).toBe('DEEP-1');
    const { o } = await newFarmWithOwner();
    expect(
      (
        await api()
          .get(V(`/animals/${a.id}`))
          .set(o.auth)
      ).status,
    ).toBe(404);
    expect((await api().get(V('/animals/not-an-id')).set(owner.auth)).status).toBe(404);
    const viewer = await createUser(h.app);
    await addFarmMember(h.app, owner, farmId, viewer, 'viewer');
    expect(
      (
        await api()
          .get(V(`/animals/${a.id}`))
          .set(viewer.auth)
      ).status,
    ).toBe(200);
  });
});

describe('editing and archiving', () => {
  it('updates fields, clears optional ones with null, and audits what changed', async () => {
    const a = (
      await create({
        animalCode: 'EDIT-1',
        animalTypeId: buffalo,
        sex: 'female',
        name: 'Old',
        breed: 'swamp',
        birthDate: '2020-01-01',
      })
    ).body.animal;
    const res = await api()
      .patch(V(`${animals()}/${a.id}`))
      .set(owner.auth)
      .send({ name: 'New', breed: null, currentStatus: 'sold', notes: 'Sold at auction' });
    expect(res.status).toBe(200);
    expect(res.body.animal).toMatchObject({
      name: 'New',
      currentStatus: 'sold',
      notes: 'Sold at auction',
    });
    expect(res.body.animal.breed).toBeUndefined();
    const log = await AuditLog.findOne({ action: 'animal.updated', targetId: a.id });
    expect(log?.metadata).toMatchObject({
      animalCode: 'EDIT-1',
      status: { from: 'active', to: 'sold' },
    });
    expect([...(log?.metadata?.['fields'] as string[])].sort()).toEqual([
      'breed',
      'currentStatus',
      'name',
      'notes',
    ]);
    const bad: object[] = [
      {},
      { sex: 'robot' },
      { birthDate: '2999-01-01' },
      { breed: 'brahman' },
      { acquisitionDate: '2019-01-01' },
      { currentStatus: 'flying' },
    ];
    for (const body of bad)
      expect(
        (
          await api()
            .patch(V(`${animals()}/${a.id}`))
            .set(owner.auth)
            .send(body)
        ).status,
        JSON.stringify(body),
      ).toBe(400);
  });

  it('archived animals are read-only until restored; archive records who, when and why', async () => {
    const a = (await create({ animalCode: 'ARCH-1', animalTypeId: buffalo, sex: 'male' })).body
      .animal;
    const archived = await api()
      .post(V(`${animals()}/${a.id}/archive`))
      .set(owner.auth)
      .send({ reason: 'Moved to another farm' });
    expect(archived.status).toBe(200);
    expect(archived.body.animal).toMatchObject({
      archived: true,
      archiveReason: 'Moved to another farm',
    });
    expect(archived.body.animal.archivedAt).toBeTruthy();
    const doc = await Animal.findById(a.id);
    expect(String(doc?.archivedBy)).toBe(owner.id);

    const edit = await api()
      .patch(V(`${animals()}/${a.id}`))
      .set(owner.auth)
      .send({ name: 'x' });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('ANIMAL_ARCHIVED');
    expect(
      (
        await api()
          .post(V(`${animals()}/${a.id}/archive`))
          .set(owner.auth)
          .send({})
      ).status,
    ).toBe(409);
    expect(
      (
        await api()
          .get(V(`${animals()}/${a.id}`))
          .set(owner.auth)
      ).status,
    ).toBe(200); // still viewable
    expect(
      (
        await api()
          .post(V(`${animals()}/${a.id}/restore`))
          .set(owner.auth)
      ).body.animal,
    ).toMatchObject({ archived: false });
    expect(
      (
        await api()
          .post(V(`${animals()}/${a.id}/restore`))
          .set(owner.auth)
      ).status,
    ).toBe(409);
    expect(
      (
        await api()
          .patch(V(`${animals()}/${a.id}`))
          .set(owner.auth)
          .send({ name: 'Back' })
      ).status,
    ).toBe(200);
    expect(
      await AuditLog.countDocuments({
        targetId: a.id,
        action: { $in: ['animal.archived', 'animal.restored'] },
      }),
    ).toBe(2);
  });
});

describe('photos and documents (references to external storage)', () => {
  let animalId: string;
  const media = (body: object, who: Session = owner) =>
    api()
      .post(V(`${animals()}/${animalId}/media`))
      .set(who.auth)
      .send(body);
  beforeAll(async () => {
    animalId = (await create({ animalCode: 'MEDIA-1', animalTypeId: buffalo, sex: 'female' })).body
      .animal.id;
  });

  it('attaches photos and documents by https URL; the first photo becomes the list thumbnail', async () => {
    const photo = await media({
      kind: 'photo',
      url: 'https://cdn.example.test/animals/1.jpg',
      mimeType: 'image/jpeg',
      caption: 'Front view',
    });
    expect(photo.status).toBe(201);
    expect(photo.body.animal.media).toHaveLength(1);
    expect(photo.body.animal.media[0]).toMatchObject({
      kind: 'photo',
      mimeType: 'image/jpeg',
      caption: 'Front view',
    });
    const doc = await media({
      kind: 'document',
      url: 'https://cdn.example.test/docs/vaccine.pdf',
      mimeType: 'application/pdf',
    });
    expect(doc.body.animal.media).toHaveLength(2);
    const row = (
      await api()
        .get(V(`${animals()}?q=MEDIA-1`))
        .set(owner.auth)
    ).body.items[0];
    expect(row.primaryPhotoUrl).toBe('https://cdn.example.test/animals/1.jpg');
  });

  it('refuses insecure, malformed, duplicate and mistyped links', async () => {
    for (const [body, status] of [
      [{ kind: 'photo', url: 'http://cdn.example.test/x.jpg' }, 400],
      [{ kind: 'photo', url: 'javascript:alert(1)' }, 400],
      [{ kind: 'photo', url: 'not a url' }, 400],
      [{ kind: 'video', url: 'https://cdn.example.test/x.mp4' }, 400],
      [{ kind: 'photo', url: 'https://cdn.example.test/x.pdf', mimeType: 'application/pdf' }, 400],
      [{ kind: 'photo', url: 'https://cdn.example.test/animals/1.jpg' }, 409],
      [{ kind: 'photo', url: 'https://cdn.example.test/y.jpg', uploadedBy: 'x' }, 400],
    ] as [object, number][]) {
      expect((await media(body)).status, JSON.stringify(body)).toBe(status);
    }
  });

  it('enforces the per-animal limit and lets members remove files', async () => {
    const id = (await create({ animalCode: 'MEDIA-LIMIT', animalTypeId: buffalo, sex: 'male' }))
      .body.animal.id;
    let last;
    for (let i = 0; i < 20; i++)
      last = await api()
        .post(V(`${animals()}/${id}/media`))
        .set(owner.auth)
        .send({ kind: 'photo', url: `https://cdn.example.test/p${i}.jpg` });
    expect(last?.status).toBe(201);
    const over = await api()
      .post(V(`${animals()}/${id}/media`))
      .set(owner.auth)
      .send({ kind: 'photo', url: 'https://cdn.example.test/p-over.jpg' });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('MEDIA_LIMIT');
    const mediaId = last?.body.animal.media[0].id;
    const removed = await api()
      .delete(V(`${animals()}/${id}/media/${mediaId}`))
      .set(owner.auth);
    expect(removed.body.animal.media).toHaveLength(19);
    expect(
      (
        await api()
          .delete(V(`${animals()}/${id}/media/${mediaId}`))
          .set(owner.auth)
      ).status,
    ).toBe(404);
  });

  it('is limited to people who can write, and blocked on archived animals', async () => {
    const viewer = await createUser(h.app);
    await addFarmMember(h.app, owner, farmId, viewer, 'viewer');
    expect(
      (await media({ kind: 'photo', url: 'https://cdn.example.test/v.jpg' }, viewer)).status,
    ).toBe(403);
    const id = (await create({ animalCode: 'MEDIA-ARCH', animalTypeId: buffalo, sex: 'male' })).body
      .animal.id;
    await api()
      .post(V(`${animals()}/${id}/archive`))
      .set(owner.auth)
      .send({})
      .expect(200);
    expect(
      (
        await api()
          .post(V(`${animals()}/${id}/media`))
          .set(owner.auth)
          .send({ kind: 'photo', url: 'https://cdn.example.test/a.jpg' })
      ).status,
    ).toBe(409);
  });
});

describe('media host policy', () => {
  it('with MEDIA_ALLOWED_HOSTS set, only those hosts (and subdomains) are accepted', async () => {
    const strict = await startHarness({ MEDIA_ALLOWED_HOSTS: 'cdn.farmplus.test' });
    try {
      const a = (await create({ animalCode: 'HOST-1', animalTypeId: buffalo, sex: 'male' })).body
        .animal;
      const post = (url: string) =>
        request(strict.app)
          .post(V(`${animals()}/${a.id}/media`))
          .set(owner.auth)
          .send({ kind: 'photo', url });
      // `owner` has a session on the shared DB; the token is valid against the strict app too (same secret).
      expect((await post('https://cdn.farmplus.test/a.jpg')).status).toBe(201);
      expect((await post('https://img.cdn.farmplus.test/b.jpg')).status).toBe(201);
      for (const url of [
        'https://evil.test/c.jpg',
        'https://cdn.farmplus.test.evil.test/d.jpg',
        'https://notcdn.farmplus.test/e.jpg',
      ]) {
        expect((await post(url)).status, url).toBe(400);
      }
    } finally {
      await strict.stop();
    }
  });

  it('in production, media links are refused until hosts are configured', async () => {
    const prod = await startHarness({
      NODE_ENV: 'production',
      DEPLOY_ENV: 'staging',
      // production hardening (validated at startup): TLS database URI, real-looking secrets, trusted proxy, rate limits on
      MONGODB_URI: 'mongodb+srv://farmplus_app:Zq8vK2mPx9@cluster0.abcde.mongodb.net/farmplus',
      // (the signing secret stays the harness one so the sessions created above remain valid)
      MFA_ENCRYPTION_KEY: Buffer.from('0123456789abcdef0123456789ABCDEF').toString('base64'),
      TRUST_PROXY: '1',
      RATE_LIMIT_ENABLED: 'true',
      CORS_ORIGINS: 'https://farmplus.test',
      SHIPPING_PROVIDER: 'none',
      PAYMENT_PROVIDER: 'none',
      AI_PROVIDER: 'none',
      VIDEO_PROVIDER: 'cloudflare',
      CLOUDFLARE_ACCOUNT_ID: 'acc',
      CLOUDFLARE_STREAM_API_TOKEN: 'token',
      CLOUDFLARE_STREAM_CUSTOMER_CODE: 'code',
    });
    try {
      const a = (await create({ animalCode: 'PROD-1', animalTypeId: buffalo, sex: 'male' })).body
        .animal;
      const res = await request(prod.app)
        .post(V(`${animals()}/${a.id}/media`))
        .set(owner.auth)
        .set('x-forwarded-proto', 'https') // production only accepts requests that arrived over TLS
        .send({ kind: 'photo', url: 'https://cdn.example.test/a.jpg' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MEDIA_NOT_CONFIGURED');
    } finally {
      await prod.stop();
    }
  });
});

describe('audit trail and data exposure', () => {
  it('records animal lifecycle events without leaking secrets', async () => {
    const actions = new Set(
      (await AuditLog.find({ action: /^animal\./ }).distinct('action')) as string[],
    );
    for (const a of [
      'animal.created',
      'animal.updated',
      'animal.archived',
      'animal.restored',
      'animal.media_added',
      'animal.media_removed',
    ])
      expect(actions.has(a), a).toBe(true);
    expect(JSON.stringify(await AuditLog.find({ action: /^(animal|farm)/ }).lean())).not.toMatch(
      /passwordHash|accessToken|refreshToken/,
    );
  });
});

describe('photos uploaded from a device', () => {
  // Smallest valid PNG header + body is not needed: the type is sniffed from the first bytes only.
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 1)]);
  const upload = (id: string, body: Buffer, who: Session = owner, type = 'image/png') =>
    api()
      .post(V(`${animals()}/${id}/photos`))
      .set(who.auth)
      .set('content-type', type)
      .send(body);

  it('stores the photo, attaches it to the animal and serves it by its key', async () => {
    const a = (await create({ animalCode: 'PHOTO-1', animalTypeId: buffalo, sex: 'female' })).body
      .animal;
    const res = await upload(a.id, png);
    expect(res.status).toBe(201);
    const media = res.body.animal.media[0];
    expect(media).toMatchObject({ kind: 'photo', mimeType: 'image/png' });
    expect(media.url).toMatch(/^\/api\/v1\/animal-photos\/[0-9a-f]{48}$/);

    const served = await api().get(media.url).buffer(true);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(served.body as Buffer, png)).toBe(0);

    // The list shows it as the primary photo.
    const list = await api().get(V(animals())).query({ q: 'PHOTO-1' }).set(owner.auth);
    expect(list.body.items[0].primaryPhotoUrl).toBe(media.url);

    // Removing the media entry deletes the stored bytes too.
    const removed = await api()
      .delete(V(`${animals()}/${a.id}/media/${media.id}`))
      .set(owner.auth);
    expect(removed.status).toBe(200);
    expect(await AnimalPhoto.countDocuments({ animalId: a.id })).toBe(0);
    expect((await api().get(media.url)).status).toBe(404);
  });

  it('refuses non-images, empty bodies and callers without animals.write', async () => {
    const a = (await create({ animalCode: 'PHOTO-2', animalTypeId: buffalo, sex: 'male' })).body
      .animal;
    expect(
      (await upload(a.id, Buffer.from('<svg onload=alert(1)>'), owner, 'image/svg+xml')).status,
    ).toBe(415);
    expect((await upload(a.id, Buffer.alloc(0))).status).toBe(400);
    const viewer = await createUser(h.app);
    await addFarmMember(h.app, owner, farmId, viewer, 'viewer');
    expect((await upload(a.id, png, viewer)).status).toBe(403);
    const { o } = await newFarmWithOwner();
    expect((await upload(a.id, png, o)).status).toBe(404);
    expect(await AnimalPhoto.countDocuments({ animalId: a.id })).toBe(0);
  });

  it('unknown or malformed keys are 404', async () => {
    expect((await api().get(V(`/animal-photos/${'a'.repeat(48)}`))).status).toBe(404);
    expect((await api().get(V('/animal-photos/not-a-key'))).status).toBe(404);
  });

  it('animal summaries carry the Thai type name when one is configured', async () => {
    await AnimalType.updateOne({ _id: buffalo }, { nameTh: 'ควาย' });
    const a = (await create({ animalCode: 'TH-1', animalTypeId: buffalo, sex: 'male' })).body
      .animal;
    expect(a.animalType).toMatchObject({ name: expect.any(String), nameTh: 'ควาย' });
  });
});
