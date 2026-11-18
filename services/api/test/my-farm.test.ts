import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Farm } from '../src/models';
import {
  addFarmMember,
  createFarmer,
  createUser,
  daysAgo,
  makeFarm,
  mkAnimal,
  startHarness,
  typeIdOf,
  type TestHarness,
} from './helpers';

let h: TestHarness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.stop());

const api = () => request(h.app);
const V = (p: string) => `/api/v1${p}`;

describe('GET /farms/me (onboarding state)', () => {
  it('requires authentication', async () => {
    expect((await api().get(V('/farms/me'))).status).toBe(401);
  });

  it('is farm_setup_required for a farm owner without a farm, then farm_setup_completed', async () => {
    const owner = await createFarmer(h.app);
    const before = await api().get(V('/farms/me')).set(owner.auth);
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({
      status: 'farm_setup_required',
      canCreateFarm: true,
      farms: [],
    });
    const farmId = await makeFarm(h.app, owner, 'Onboarded Farm');
    const after = await api().get(V('/farms/me')).set(owner.auth);
    expect(after.body.status).toBe('farm_setup_completed');
    expect(after.body.farms.map((f: { id: string }) => f.id)).toEqual([farmId]);
  });

  it('is not_applicable for a user who may not create farms (never forced into setup)', async () => {
    const buyer = await createUser(h.app);
    const res = await api().get(V('/farms/me')).set(buyer.auth);
    expect(res.body).toMatchObject({ status: 'not_applicable', canCreateFarm: false, farms: [] });
  });

  it('is farm_setup_completed for a member of someone else’s farm', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner, 'Shared Farm');
    const worker = await createUser(h.app);
    await addFarmMember(h.app, owner, farmId, worker, 'worker');
    const res = await api().get(V('/farms/me')).set(worker.auth);
    expect(res.body.status).toBe('farm_setup_completed');
    expect(res.body.farms[0]).toMatchObject({ id: farmId, myRole: 'worker' });
  });
});

describe('farm animal types (what the farm raises)', () => {
  it('stores declared types on create and update, and rejects unknown ones', async () => {
    const owner = await createFarmer(h.app);
    const [buffalo, goat] = [await typeIdOf(h.app, owner), await typeIdOf(h.app, owner, 'goat')];
    const res = await api()
      .post(V('/farms'))
      .set(owner.auth)
      .send({ name: 'Typed Farm', animalTypeIds: [buffalo] });
    expect(res.status).toBe(201);
    expect(res.body.farm.animalTypeIds).toEqual([buffalo]);

    const upd = await api()
      .patch(V(`/farms/${res.body.farm.id}`))
      .set(owner.auth)
      .send({ animalTypeIds: [buffalo, goat] });
    expect(upd.status).toBe(200);
    expect(upd.body.farm.animalTypeIds).toEqual([buffalo, goat]);

    const unknown = await api()
      .patch(V(`/farms/${res.body.farm.id}`))
      .set(owner.auth)
      .send({ animalTypeIds: ['0123456789abcdef01234567'] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.details[0].path).toBe('animalTypeIds.0');

    const dup = await api()
      .patch(V(`/farms/${res.body.farm.id}`))
      .set(owner.auth)
      .send({ animalTypeIds: [buffalo, buffalo] });
    expect(dup.status).toBe(400);
  });

  it('cannot be changed by a worker (no farm.update) or by a stranger (404)', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner, 'Guarded Farm');
    const buffalo = await typeIdOf(h.app, owner);
    const worker = await createUser(h.app);
    await addFarmMember(h.app, owner, farmId, worker, 'worker');
    const stranger = await createFarmer(h.app);
    const body = { animalTypeIds: [buffalo] };
    expect(
      (
        await api()
          .patch(V(`/farms/${farmId}`))
          .set(worker.auth)
          .send(body)
      ).status,
    ).toBe(403);
    expect(
      (
        await api()
          .patch(V(`/farms/${farmId}`))
          .set(stranger.auth)
          .send(body)
      ).status,
    ).toBe(404);
    expect((await Farm.findById(farmId))!.animalTypeIds).toEqual([]);
  });
});

describe('GET /farms/:farmId/summary (My farm cards)', () => {
  it('counts animals per type from the database, incl. growth checks and trade figures', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner, 'Counting Farm');
    const [buffalo, goat, cattle] = [
      await typeIdOf(h.app, owner),
      await typeIdOf(h.app, owner, 'goat'),
      await typeIdOf(h.app, owner, 'cattle'),
    ];
    await api()
      .patch(V(`/farms/${farmId}`))
      .set(owner.auth)
      .send({ animalTypeIds: [cattle] });
    const b1 = await mkAnimal(h.app, owner, farmId, { animalTypeId: buffalo, sex: 'male' });
    await mkAnimal(h.app, owner, farmId, { animalTypeId: buffalo, sex: 'female' });
    const b3 = await mkAnimal(h.app, owner, farmId, { animalTypeId: buffalo, sex: 'female' });
    await mkAnimal(h.app, owner, farmId, { animalTypeId: goat, sex: 'female' });
    await api()
      .patch(V(`/farms/${farmId}/animals/${b3.id}`))
      .set(owner.auth)
      .send({ currentStatus: 'for_sale' })
      .expect(200);
    // b1 was weighed recently → no growth check needed for it.
    await api()
      .post(V(`/farms/${farmId}/weights`))
      .set(owner.auth)
      .send({ animalId: b1.id, weighedOn: daysAgo(2), weightKg: 300 })
      .expect(201);
    // An archived animal is not counted.
    const gone = await mkAnimal(h.app, owner, farmId, { animalTypeId: goat, sex: 'male' });
    await api()
      .post(V(`/farms/${farmId}/animals/${gone.id}/archive`))
      .set(owner.auth)
      .send({ reason: 'test' })
      .expect(200);

    const res = await api()
      .get(V(`/farms/${farmId}/summary`))
      .set(owner.auth);
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({
      total: 4,
      onFarm: 4,
      forSale: 1,
      sold: 0,
      needsGrowthCheck: 3,
      outsideStandard: 0, // no criteria configured for these types
    });
    const card = (id: string) =>
      res.body.byType.find((c: { animalTypeId: string }) => c.animalTypeId === id);
    expect(card(buffalo)).toMatchObject({
      key: 'buffalo',
      total: 3,
      forSale: 1,
      needsGrowthCheck: 2,
    });
    expect(card(goat)).toMatchObject({ total: 1, needsGrowthCheck: 1 });
    // Declared but empty types still get a card.
    expect(card(cattle)).toMatchObject({ total: 0, onFarm: 0 });
    expect(res.body.growthCheckDays).toBe(30);
    expect(res.body.trade).toEqual({ listingsByStatus: {}, listingsTotal: 0, animalOrders: 0 });
  });

  it('hides trade figures from workers and is 404 for strangers', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner, 'Private Farm');
    const worker = await createUser(h.app);
    await addFarmMember(h.app, owner, farmId, worker, 'worker');
    const res = await api()
      .get(V(`/farms/${farmId}/summary`))
      .set(worker.auth);
    expect(res.status).toBe(200);
    expect(res.body.trade).toBeUndefined();
    const stranger = await createFarmer(h.app);
    expect(
      (
        await api()
          .get(V(`/farms/${farmId}/summary`))
          .set(stranger.auth)
      ).status,
    ).toBe(404);
  });
});

describe('animal colour / markings', () => {
  it('is stored, shown, editable, clearable with null and length-checked', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner, 'Colour Farm');
    const buffalo = await typeIdOf(h.app, owner);
    const created = await api()
      .post(V(`/farms/${farmId}/animals`))
      .set(owner.auth)
      .send({ animalTypeId: buffalo, sex: 'female', color: ' Grey, white blaze ' });
    expect(created.status).toBe(201);
    expect(created.body.animal.color).toBe('Grey, white blaze');
    const url = V(`/farms/${farmId}/animals/${created.body.animal.id}`);
    expect(
      (await api().patch(url).set(owner.auth).send({ color: 'Black' })).body.animal.color,
    ).toBe('Black');
    const cleared = await api().patch(url).set(owner.auth).send({ color: null });
    expect(cleared.body.animal.color).toBeUndefined();
    expect(
      (
        await api()
          .patch(url)
          .set(owner.auth)
          .send({ color: 'x'.repeat(121) })
      ).status,
    ).toBe(400);
    expect((await api().patch(url).set(owner.auth).send({ color: '' })).status).toBe(400);
  });
});
