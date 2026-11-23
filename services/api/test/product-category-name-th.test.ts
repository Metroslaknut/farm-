import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATEGORY_NAMES_TH_0003, MIGRATIONS } from '../src/db/migrations';
import { ProductCategory } from '../src/models';
import { SEED_CATEGORIES } from '../src/modules/products/compliance';
import { startHarness, type TestHarness } from './helpers';
import { API } from './orders-helpers';
import { createShopWorld, type ShopWorld } from './shop-fixtures';

/** `product_categories.nameTh`: seed, migration 0003, the admin API and what buyers receive. */
let h: TestHarness;
let w: ShopWorld;
beforeAll(async () => {
  h = await startHarness();
  w = await createShopWorld(h);
});
afterAll(async () => {
  await h.stop();
});

const put = (key: string, body: object) =>
  request(h.app).put(`${API}/shop/admin/categories/${key}`).set(w.admin.auth).send(body);

describe('product category Thai names', () => {
  it('new databases are seeded with Thai names; buyers receive them on categories and products', async () => {
    const buyer = await w.buyer();
    const cats = (await w.call('get', buyer, '/shop/categories')).body.categories as {
      key: string;
      nameTh?: string;
    }[];
    expect(cats.find((c) => c.key === 'feed')?.nameTh).toBe('อาหารสัตว์');
    const s = await w.seller('Thai Name Farm');
    const live = await w.live(s, { title: `Th${Date.now()} feed` });
    const product = (await w.call('get', buyer, `/shop/products/${live.id}`)).body.product;
    expect(product).toMatchObject({ categoryName: 'Animal feed', categoryNameTh: 'อาหารสัตว์' });
  });

  it('the migration copy of the Thai names matches the seed', () => {
    expect(SEED_CATEGORIES.map(({ key, name, nameTh }) => ({ key, name, nameTh }))).toEqual(
      CATEGORY_NAMES_TH_0003.map((c) => ({ ...c })),
    );
  });

  it('migration 0003 fills only empty built-in categories with their seeded English name, and is idempotent', async () => {
    const db = mongoose.connection.db!;
    const cats = db.collection('product_categories');
    const before = await cats.find({}).toArray();
    try {
      // An "old" database: no nameTh anywhere; one built-in renamed by an admin; one already translated by an admin;
      // one category an admin created.
      await cats.updateMany({}, { $unset: { nameTh: '' } });
      await cats.updateOne({ key: 'supplements' }, { $set: { name: 'Minerals (admin)' } });
      await cats.updateOne({ key: 'equipment' }, { $set: { nameTh: 'เครื่องมือ (แอดมิน)' } });
      await cats.updateOne({ key: 'medicines' }, { $set: { nameTh: null } });
      await cats.insertOne({ key: 'th_custom', name: 'Custom', regulation: 'none', sortOrder: 99 });

      const migration = MIGRATIONS.find((m) => m.id === '0003-product-category-name-th')!;
      const log: string[] = [];
      await migration.up({ db, log: (m) => log.push(m) });
      const byKey = async (key: string) => (await cats.findOne({ key }))?.['nameTh'];
      expect(await byKey('feed')).toBe('อาหารสัตว์');
      expect(await byKey('medicated_feed')).toBe('อาหารสัตว์ผสมยา');
      expect(await byKey('medicines')).toBe('ยาสัตว์'); // null counts as empty
      expect(await byKey('supplements')).toBeUndefined(); // renamed by an admin: left alone
      expect(await byKey('equipment')).toBe('เครื่องมือ (แอดมิน)'); // already set: kept
      expect(await byKey('th_custom')).toBeUndefined(); // not a built-in category
      expect(log).toEqual(['nameTh set on 3 built-in categories']);

      await migration.up({ db, log: (m) => log.push(m) });
      expect(log.at(-1)).toBe('nameTh set on 0 built-in categories');
      expect(await byKey('feed')).toBe('อาหารสัตว์');
    } finally {
      await cats.deleteMany({});
      await cats.insertMany(before);
    }
  });

  it('administrators set, change and clear the Thai name; it is validated', async () => {
    const created = await put('th_tools', {
      name: 'Hand tools',
      nameTh: 'เครื่องมือช่าง',
      reason: 'New category',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body.category).toMatchObject({ name: 'Hand tools', nameTh: 'เครื่องมือช่าง' });
    const changed = await put('th_tools', {
      name: 'Hand tools',
      nameTh: 'เครื่องมือ',
      reason: 'Shorter',
    });
    expect(changed.body.category.nameTh).toBe('เครื่องมือ');
    // Leaving it out keeps it; null clears it.
    expect(
      (await put('th_tools', { name: 'Hand tools 2', reason: 'Rename' })).body.category.nameTh,
    ).toBe('เครื่องมือ');
    const cleared = await put('th_tools', { name: 'Hand tools', nameTh: null, reason: 'Clear' });
    expect(cleared.body.category).not.toHaveProperty('nameTh');
    const bad = await put('th_tools', { name: 'Hand tools', nameTh: 'x', reason: 'Too short' });
    expect(bad.status).toBe(400);
    await ProductCategory.deleteOne({ key: 'th_tools' });
  });
});
