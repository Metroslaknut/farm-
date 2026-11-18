import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Animal,
  AnimalType,
  Farm,
  Listing,
  Product,
  ProductCategory,
  User,
  WeightRecord,
} from '../src/models';
import { assertContentAllowed } from '../src/modules/products/compliance';
import { FARMS, SHOPS } from '../src/scripts/mockup/catalog';
import {
  cleanMockup,
  cleanMockupForUser,
  mockupEmail,
  planFarmAnimals,
  seedMockup,
  seedMockupForUser,
  verifyMockup,
} from '../src/scripts/mockup/seed';
import { PASSWORD, createFarmer, login, makeFarm, startHarness, type TestHarness } from './helpers';

let h: TestHarness;
let realFarmId: string;
let realOwnerEmail: string;

beforeAll(async () => {
  h = await startHarness();
  // Real data that must survive both seeding and cleaning.
  const farmer = await createFarmer(h.app);
  realOwnerEmail = farmer.email;
  realFarmId = await makeFarm(h.app, farmer, 'Real Farm');
  await seedMockup({ password: PASSWORD });
}, 300_000); // ~2,000 documents written one by one
afterAll(() => h.stop());

describe('mockup seed', () => {
  it('creates 10 shops with 8–15 products and 10 farms with 20 animals each, all consistent', async () => {
    const report = await verifyMockup();
    expect(report.problems).toEqual([]);
    expect(report.counts).toMatchObject({
      users: 20,
      shops: 10,
      farms: 10,
      animals: 200,
      listingsActive: 30,
    });
    expect(report.productsPerShop.min).toBeGreaterThanOrEqual(8);
    expect(report.productsPerShop.max).toBeLessThanOrEqual(15);
    expect(report.animalsPerFarm).toEqual({ min: 20, max: 20 });
    expect(report.counts['productsOutOfStock']).toBe(10);
    expect(report.counts['productsPaused']).toBe(10);
    expect(report.counts['animalsWithParents']).toBeGreaterThan(0);
  });

  it(
    'is idempotent: a second run inserts nothing and changes nothing',
    { timeout: 300_000 },
    async () => {
      const before = await Promise.all([
        Animal.countDocuments(),
        Product.countDocuments(),
        WeightRecord.countDocuments(),
      ]);
      const report = await seedMockup({ password: PASSWORD });
      expect(report.created).toEqual({});
      expect(
        await Promise.all([
          Animal.countDocuments(),
          Product.countDocuments(),
          WeightRecord.countDocuments(),
        ]),
      ).toEqual(before);
    },
  );

  it('plans unique animal codes and names per farm', () => {
    for (const farm of FARMS) {
      const plans = planFarmAnimals(farm);
      expect(new Set(plans.map((p) => p.code)).size).toBe(20);
      expect(new Set(plans.map((p) => p.name)).size).toBe(20);
    }
  });

  it('passes the platform content rules (no prohibited terms or treatment claims)', async () => {
    const cats = new Map((await ProductCategory.find()).map((c) => [c.key, c]));
    for (const p of await Product.find({ sku: /^MOCK-/ })) {
      await expect(
        assertContentAllowed(
          cats.get(p.categoryKey)!,
          { title: p.title, description: p.description, brand: p.brand, specs: p.specs },
          p.regulatory,
        ),
      ).resolves.toBeUndefined();
    }
  });

  it('works through the real API: login, farm detail, animals, shop and marketplace', async () => {
    const farmOwner = await login(h.app, mockupEmail('F01'));
    const farm = await Farm.findOne({ name: FARMS[0]!.name }).orFail();
    const detail = await request(h.app)
      .get(`/api/v1/farms/${String(farm._id)}`)
      .set(farmOwner.auth);
    expect(detail.status).toBe(200);
    expect(detail.body.farm.stats.animalsTotal).toBe(20);
    const animals = await request(h.app)
      .get(`/api/v1/farms/${String(farm._id)}/animals?pageSize=50`)
      .set(farmOwner.auth);
    expect(animals.status).toBe(200);
    expect(animals.body.total).toBe(20);
    const dashboard = await request(h.app)
      .get(`/api/v1/farms/${String(farm._id)}/dashboard`)
      .set(farmOwner.auth);
    expect(dashboard.status).toBe(200);

    const shopOwner = await login(h.app, mockupEmail('S01'));
    const shop = await Farm.findOne({ name: SHOPS[0]!.name }).orFail();
    const products = await request(h.app)
      .get(`/api/v1/shop/products?farmId=${String(shop._id)}&pageSize=48`)
      .set(shopOwner.auth);
    expect(products.status).toBe(200);
    expect(products.body.total).toBe(
      await Product.countDocuments({
        farmId: shop._id,
        status: 'ACTIVE',
        categoryKey: { $ne: 'medicines' },
      }),
    );

    const listings = await request(h.app)
      .get('/api/v1/marketplace/listings?limit=50')
      .set(shopOwner.auth);
    expect(listings.status).toBe(200);
    // Every seeded listing is publicly visible (a buyer sees its own listings too).
    expect(listings.body.items).toHaveLength(await Listing.countDocuments({ status: 'ACTIVE' }));
    expect(listings.body.items).toHaveLength(30);
  });

  it('cleans only mockup data and leaves real data alone', async () => {
    const { deleted } = await cleanMockup();
    expect(deleted['users']).toBe(20);
    expect(deleted['animals']).toBe(200);
    expect(await User.countDocuments({ email: /@mockup\.farmplus\.test$/ })).toBe(0);
    expect(await Farm.exists({ _id: realFarmId })).toBeTruthy();
    expect(await Product.countDocuments({ sku: /^MOCK-/ })).toBe(0);
  });

  it("fills a real user's farm and cleans only what it added", { timeout: 120_000 }, async () => {
    const own = await Animal.create({
      farmId: realFarmId,
      animalTypeId: (await AnimalType.findOne({ key: 'buffalo' }))!._id,
      breed: 'swamp',
      animalCode: 'A-00001',
      sex: 'female',
      createdBy: (await User.findOne({ email: realOwnerEmail }))!._id,
    });
    const report = await seedMockupForUser({ email: realOwnerEmail });
    expect(report.farmName).toBe('Real Farm');
    expect(report.created['animals']).toBe(20);
    expect(await Product.countDocuments({ farmId: realFarmId, sku: /^MOCK-US03-/ })).toBe(12);
    const listings = await Listing.find({ farmId: realFarmId });
    expect(listings).toHaveLength(3);
    expect(listings.every((l) => l.farmName === 'Real Farm')).toBe(true);
    expect((await seedMockupForUser({ email: realOwnerEmail })).created).toEqual({});

    const { deleted } = await cleanMockupForUser(realOwnerEmail);
    expect(deleted).toMatchObject({ animals: 20, products: 12, listings: 3 });
    expect(await Animal.find({ farmId: realFarmId }).distinct('_id')).toEqual([own._id]);
    expect(await Product.countDocuments({ farmId: realFarmId })).toBe(0);
    expect(await Farm.exists({ _id: realFarmId })).toBeTruthy();
  });
});
