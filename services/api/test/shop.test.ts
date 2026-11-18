/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PRODUCT_TRANSITIONS } from '@farmplus/shared-types';
import { effectivePrice, findTerms, parseTerms } from '@farmplus/shared-utils';
import {
  Cart,
  CommissionRule,
  InventoryMovement,
  Order,
  Product,
  ProductCategory,
  Setting,
} from '../src/models';
import { createStaff, createUser, startHarness, type TestHarness } from './helpers';
import { API } from './orders-helpers';
import { PRODUCT, createShopWorld, sku, type ShopWorld } from './shop-fixtures';

let h: TestHarness;
let w: ShopWorld;

beforeAll(async () => {
  h = await startHarness();
  w = await createShopWorld(h);
});
afterAll(async () => {
  await h.stop();
});
afterEach(async () => {
  await Setting.deleteMany({ key: { $regex: '^products\\.' } });
  await ProductCategory.updateOne(
    { key: 'medicines' },
    { $set: { salesEnabled: false, regulation: 'regulated', complianceReference: null } },
  );
  await ProductCategory.deleteMany({ key: { $in: ['bans', 'tools'] } });
});

// ---------------------------------------------------------------------------
describe('pure helpers', () => {
  it('effectivePrice uses the promotion only inside its window and only if it is really lower', () => {
    const promo = {
      priceMinor: 800,
      startsAt: new Date('2026-01-01T00:00:00Z'),
      endsAt: new Date('2026-02-01T00:00:00Z'),
    };
    expect(effectivePrice(1000, promo, new Date('2026-01-15T00:00:00Z'))).toEqual({
      priceMinor: 800,
      onSale: true,
    });
    expect(effectivePrice(1000, promo, new Date('2025-12-31T23:59:59Z'))).toEqual({
      priceMinor: 1000,
      onSale: false,
    });
    expect(effectivePrice(1000, promo, new Date('2026-02-01T00:00:00Z')).onSale).toBe(false); // end is exclusive
    expect(effectivePrice(1000, promo, promo.startsAt).onSale).toBe(true); // start is inclusive
    expect(effectivePrice(700, promo, new Date('2026-01-15T00:00:00Z'))).toEqual({
      priceMinor: 700,
      onSale: false,
    });
    expect(effectivePrice(1000, null)).toEqual({ priceMinor: 1000, onSale: false });
  });
  it('term matching is whole-word for Latin text and substring for Thai; case and spacing are ignored', () => {
    expect(findTerms(['This feed is SECURE'], ['cure'])).toEqual([]);
    expect(findTerms(['it will cure mastitis'], ['cure'])).toEqual(['cure']);
    expect(findTerms(['Cures   everything'], ['cures'])).toEqual(['cures']);
    expect(findTerms(['ยารักษาโรคปากเท้าเปื่อย'], ['รักษา'])).toEqual(['รักษา']);
    expect(findTerms(['100% effective formula'], ['100% effective'])).toEqual(['100% effective']);
    expect(findTerms(['plain text', null, undefined], ['clenbuterol'])).toEqual([]);
    expect(parseTerms(' Cure, heal ;\nMIRACLE,, a ')).toEqual(['cure', 'heal', 'miracle']);
    expect(findTerms(['text'], ['a.b(c'])).toEqual([]); // regex metacharacters are inert
  });
  it('product status transitions are exactly the documented ones', () => {
    const edges = Object.entries(PRODUCT_TRANSITIONS)
      .flatMap(([from, tos]) => Object.keys(tos).map((to) => `${from}>${to}`))
      .sort();
    expect(edges).toEqual(
      [
        'DRAFT>PENDING_REVIEW',
        'DRAFT>ARCHIVED',
        'PENDING_REVIEW>ACTIVE',
        'PENDING_REVIEW>REJECTED',
        'PENDING_REVIEW>DRAFT',
        'ACTIVE>PAUSED',
        'ACTIVE>SUSPENDED',
        'ACTIVE>PENDING_REVIEW',
        'ACTIVE>ARCHIVED',
        'PAUSED>ACTIVE',
        'PAUSED>SUSPENDED',
        'PAUSED>PENDING_REVIEW',
        'PAUSED>ARCHIVED',
        'REJECTED>DRAFT',
        'REJECTED>ARCHIVED',
        'SUSPENDED>ACTIVE',
        'SUSPENDED>ARCHIVED',
      ].sort(),
    );
    expect(PRODUCT_TRANSITIONS.ARCHIVED).toEqual({});
    expect(PRODUCT_TRANSITIONS.PENDING_REVIEW.ACTIVE).toEqual(['moderator']); // sellers can never approve themselves
    expect(PRODUCT_TRANSITIONS.SUSPENDED.ACTIVE).toEqual(['moderator']);
  });
});

// ---------------------------------------------------------------------------
describe('categories and the compliance gate', () => {
  it('are seeded: ordinary goods open, regulated goods (medicines) closed', async () => {
    const buyer = await w.buyer();
    const cats = (await w.call('get', buyer, '/shop/categories')).body.categories as any[];
    const by = Object.fromEntries(cats.map((c) => [c.key, c]));
    expect(by.feed).toMatchObject({ regulation: 'none', salesEnabled: true });
    expect(by.supplements.salesEnabled && by.equipment.salesEnabled).toBe(true);
    expect(by.medicines).toMatchObject({
      regulation: 'regulated',
      salesEnabled: false,
      requiresRegistration: true,
    });
    expect(by.medicated_feed.salesEnabled).toBe(false);
    expect((await request(h.app).get(`${API}/shop/categories`)).status).toBe(401);
  });

  it('a product cannot be created in a category that is not open for sale, and an unknown category is refused', async () => {
    const s = await w.seller();
    const r = await w.call('post', s.user, `/farms/${s.farmId}/products`, {
      ...PRODUCT,
      categoryKey: 'medicines',
      sku: sku(),
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('CATEGORY_DISABLED');
    const u = await w.call('post', s.user, `/farms/${s.farmId}/products`, {
      ...PRODUCT,
      categoryKey: 'nonsense',
      sku: sku(),
    });
    expect(u.status).toBe(400);
    expect(await Product.countDocuments({ farmId: s.farmId })).toBe(0);
  });

  it('only settings.manage can change categories; enabling needs the typed phrase, a reason and (regulated) a compliance reference; prohibited can never open', async () => {
    const mod = w.mod;
    const act = (path: string, body: object, who = w.admin) =>
      request(h.app).post(`${API}/shop/admin/categories/${path}`).set(who.auth).send(body);
    const enable = {
      enabled: true,
      reason: 'Reviewed with counsel',
      confirmation: 'ENABLE medicines',
    };
    for (const who of [mod, await w.buyer(), (await w.seller()).user])
      expect(
        (await act('medicines/sales', { ...enable, complianceReference: 'LEGAL-1' }, who as never))
          .status,
      ).toBe(403);
    expect(
      (await request(h.app).post(`${API}/shop/admin/categories/medicines/sales`).send(enable))
        .status,
    ).toBe(401);
    expect((await act('medicines/sales', { ...enable, confirmation: 'yes' })).body.error.code).toBe(
      'CONFIRMATION_MISMATCH',
    );
    expect((await act('medicines/sales', enable)).body.error.code).toBe(
      'COMPLIANCE_REVIEW_REQUIRED',
    );
    expect((await ProductCategory.findOne({ key: 'medicines' }))?.salesEnabled).toBe(false);
    const ok = await act('medicines/sales', { ...enable, complianceReference: 'LEGAL-2026-014' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.category).toMatchObject({
      salesEnabled: true,
      complianceReference: 'LEGAL-2026-014',
    });
    expect(ok.body.category.complianceReviewedAt).toBeTruthy();
    // a prohibited category can never be opened
    const put = await request(h.app)
      .put(`${API}/shop/admin/categories/bans`)
      .set(w.admin.auth)
      .send({ name: 'Banned goods', regulation: 'prohibited', reason: 'Not allowed' });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.category.salesEnabled).toBe(false);
    const no = await act('bans/sales', {
      enabled: true,
      reason: 'try',
      confirmation: 'ENABLE bans',
      complianceReference: 'X-1',
    });
    expect(no.status).toBe(409);
    expect(no.body.error.code).toBe('PROHIBITED_CATEGORY');
  });

  it('once medicines are enabled, products need a registration number; making a category stricter switches its sales off again', async () => {
    await ProductCategory.updateOne({ key: 'medicines' }, { $set: { salesEnabled: true } });
    const s = await w.seller();
    const bad = await w.call('post', s.user, `/farms/${s.farmId}/products`, {
      ...PRODUCT,
      categoryKey: 'medicines',
      title: 'Mastitis tube',
      sku: sku(),
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('REGISTRATION_REQUIRED');
    const good = await w.create(s, {
      categoryKey: 'medicines',
      title: 'Intramammary tube 10 ml',
      regulatory: { registrationNumber: 'Vet-Reg 1A 123/2566' },
    });
    expect(good.regulatory.registrationNumber).toBe('Vet-Reg 1A 123/2566');
    // an admin tightens the classification of "feed": sales stop until it is reviewed again
    const up = await request(h.app)
      .put(`${API}/shop/admin/categories/feed`)
      .set(w.admin.auth)
      .send({ name: 'Animal feed', regulation: 'regulated', reason: 'Now regulated' });
    expect(up.body.category).toMatchObject({ regulation: 'regulated', salesEnabled: false });
    const again = await w.call('post', s.user, `/farms/${s.farmId}/products`, {
      ...PRODUCT,
      sku: sku(),
    });
    expect(again.body.error.code).toBe('CATEGORY_DISABLED');
    await ProductCategory.updateOne(
      { key: 'feed' },
      { $set: { regulation: 'none', salesEnabled: true, complianceReference: null } },
    );
  });
});

// ---------------------------------------------------------------------------
describe('prohibited products and unsupported claims', () => {
  it('prohibited terms are refused anywhere in the text (title, description, brand, specifications)', async () => {
    const s = await w.seller();
    const bad = async (over: Record<string, unknown>) => {
      const r = await w.call('post', s.user, `/farms/${s.farmId}/products`, {
        ...PRODUCT,
        sku: sku(),
        ...over,
      });
      expect(r.status, JSON.stringify(over)).toBe(422);
      expect(r.body.error.code).toBe('PROHIBITED_PRODUCT');
    };
    await bad({ title: 'Clenbuterol growth booster' });
    await bad({ description: 'Contains RACTOPAMINE for lean gain' });
    await bad({ brand: 'Malachite  Green Co' });
    await bad({ specs: [{ name: 'Active', value: 'chloramphenicol 5%' }] });
    expect(await Product.countDocuments({ farmId: s.farmId })).toBe(0);
  });

  it('the block-list is configurable: a new term is enforced on create, edit, approval and by a rescan that suspends live products', async () => {
    const s = await w.seller();
    const p = await w.live(s, { title: 'Special tonic' });
    await Setting.updateOne(
      { key: 'products.prohibitedTerms' },
      { $set: { value: 'tonic' } },
      { upsert: true },
    );
    expect(
      (
        await w.call('post', s.user, `/farms/${s.farmId}/products`, {
          ...PRODUCT,
          sku: sku(),
          title: 'Another tonic',
        })
      ).body.error.code,
    ).toBe('PROHIBITED_PRODUCT');
    expect(
      (
        await w.call('patch', s.user, `/farms/${s.farmId}/products/${p.id}`, {
          title: 'Tonic plus',
        })
      ).status,
    ).toBe(422);
    expect((await Product.findById(p.id))?.status).toBe('ACTIVE'); // still live until rescanned
    const scan = await w.call('post', w.mod, '/shop/moderation/rescan', {});
    expect(scan.status, JSON.stringify(scan.body)).toBe(200);
    expect(scan.body.suspended.map((x: any) => x.id)).toContain(p.id);
    const after = (await Product.findById(p.id))!;
    expect(after.status).toBe('SUSPENDED');
    expect(after.review.moderatorHold).toBe(true);
    expect((await w.call('post', await w.buyer(), '/shop/moderation/rescan', {})).status).toBe(403);
    // the seller cannot bring it back; the moderator cannot either while the term is still blocked
    expect(
      (await w.call('post', s.user, `/farms/${s.farmId}/products/${p.id}/resume`)).status,
    ).toBe(409);
    expect(
      (await w.call('post', w.mod, `/shop/moderation/products/${p.id}/restore`)).body.error.code,
    ).toBe('PROHIBITED_PRODUCT');
  });

  it('treatment and health claims are refused for ordinary goods, but "secure" or "procure" are not claims', async () => {
    const s = await w.seller();
    for (const description of [
      'This feed will cure mastitis in cows',
      'Guaranteed results in 7 days',
      'ป้องกันโรคได้ 100%',
      'A miracle supplement',
    ])
      expect(
        (
          await w.call('post', s.user, `/farms/${s.farmId}/products`, {
            ...PRODUCT,
            sku: sku(),
            description,
          })
        ).body.error.code,
        description,
      ).toBe('UNSUPPORTED_CLAIM');
    const ok = await w.call('post', s.user, `/farms/${s.farmId}/products`, {
      ...PRODUCT,
      sku: sku(),
      description: 'Secure resealable bag. Contains 18% protein and added minerals.',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    await Setting.updateOne(
      { key: 'products.claimTerms' },
      { $set: { value: 'strengthens' } },
      { upsert: true },
    );
    expect(
      (
        await w.call('post', s.user, `/farms/${s.farmId}/products`, {
          ...PRODUCT,
          sku: sku(),
          description: 'Strengthens bones',
        })
      ).body.error.code,
    ).toBe('UNSUPPORTED_CLAIM');
  });
});

// ---------------------------------------------------------------------------
describe('seller product management and ownership', () => {
  it('creates a draft with an opening stock movement; validates input strictly', async () => {
    const s = await w.seller();
    const p = await w.create(s, { stock: 25 });
    expect(p).toMatchObject({
      status: 'DRAFT',
      priceMinor: 120_000,
      effectivePriceMinor: 120_000,
      onSale: false,
      available: 25,
      inventory: { stock: 25, reserved: 0 },
    });
    const moves = await InventoryMovement.find({ productId: p.id });
    expect(moves.map((m) => [m.type, m.deltaStock, m.deltaReserved])).toEqual([['initial', 25, 0]]);
    const bad = async (over: Record<string, unknown>, path: string) => {
      const r = await w.call('post', s.user, `/farms/${s.farmId}/products`, {
        ...PRODUCT,
        sku: sku(),
        ...over,
      });
      expect(r.status, JSON.stringify(over)).toBe(400);
      expect(JSON.stringify(r.body.error.details)).toContain(path);
    };
    await bad({ priceMinor: 0 }, 'priceMinor');
    await bad({ priceMinor: 12.5 }, 'priceMinor');
    await bad({ stock: -1 }, 'stock');
    await bad({ title: 'x' }, 'title');
    await bad({ photos: [{ url: 'http://insecure.test/a.jpg' }] }, 'photos');
    await bad(
      { specs: Array.from({ length: 21 }, (_, i) => ({ name: `n${i}`, value: 'v' })) },
      'specs',
    );
    await bad(
      {
        promotion: {
          priceMinor: 130_000,
          startsAt: '2026-01-01T00:00:00Z',
          endsAt: '2026-02-01T00:00:00Z',
        },
      },
      'promotion',
    );
    await bad(
      {
        promotion: {
          priceMinor: 1000,
          startsAt: '2026-02-01T00:00:00Z',
          endsAt: '2026-01-01T00:00:00Z',
        },
      },
      'endsAt',
    );
    await bad({ minOrderQty: 5, maxOrderQty: 2 }, 'maxOrderQty');
    await bad(
      { shipping: { ...PRODUCT.shipping, requirements: ['livestock_vehicle'] } },
      'requirements',
    );
    await bad({ owner: 'me' }, 'owner');
    expect(
      (await w.call('post', s.user, `/farms/${s.farmId}/products`, { ...PRODUCT, sku: p.sku })).body
        .error.code,
    ).toBe('SKU_TAKEN');
  });

  it('a seller can only reach their own farm’s products: other farms and strangers get 404, viewers and workers are refused', async () => {
    const a = await w.seller('Farm A');
    const b = await w.seller('Farm B');
    const mine = await w.create(a);
    const theirs = await w.create(b);
    // B tries to use A's farm path, and A's product through B's farm path
    expect((await w.call('get', b.user, `/farms/${a.farmId}/products`)).status).toBe(404);
    expect(
      (await w.call('post', b.user, `/farms/${a.farmId}/products`, { ...PRODUCT, sku: sku() }))
        .status,
    ).toBe(404);
    expect((await w.call('get', b.user, `/farms/${b.farmId}/products/${mine.id}`)).status).toBe(
      404,
    );
    for (const [m, path, body] of [
      ['patch', `/farms/${b.farmId}/products/${mine.id}`, { title: 'Hijacked' }],
      ['post', `/farms/${b.farmId}/products/${mine.id}/submit`, {}],
      ['post', `/farms/${b.farmId}/products/${mine.id}/stock`, { delta: 5, reason: 'steal' }],
      ['get', `/farms/${b.farmId}/products/${mine.id}/movements`, undefined],
    ] as const)
      expect((await w.call(m, b.user, path, body)).status, `${m} ${path}`).toBe(404);
    expect((await Product.findById(mine.id))?.title).toBe(PRODUCT.title);
    expect((await Product.findById(theirs.id))?.farmId.toString()).toBe(b.farmId);
    // roles inside the farm
    const manager = await w.sellerUser(['seller']);
    await w.addFarmMember(h.app, a.user, a.farmId, manager, 'manager');
    expect(
      (await w.call('post', manager, `/farms/${a.farmId}/products`, { ...PRODUCT, sku: sku() }))
        .status,
    ).toBe(201);
    for (const role of ['worker', 'viewer'] as const) {
      const member = await w.sellerUser(['seller']);
      await w.addFarmMember(h.app, a.user, a.farmId, member, role);
      expect(
        (await w.call('post', member, `/farms/${a.farmId}/products`, { ...PRODUCT, sku: sku() }))
          .status,
        role,
      ).toBe(403);
      expect((await w.call('get', member, `/farms/${a.farmId}/products`)).status, role).toBe(403);
    }
    // a user without the seller role cannot create products
    const plain = await createUser(h.app);
    const farm = await w.seller('Other');
    await w.addFarmMember(h.app, farm.user, farm.farmId, plain, 'manager');
    expect(
      (await w.call('post', plain, `/farms/${farm.farmId}/products`, { ...PRODUCT, sku: sku() }))
        .body.error.code,
    ).toBe('SELLER_REQUIRED');
    expect((await request(h.app).get(`${API}/farms/${a.farmId}/products`)).status).toBe(401);
  });

  it('platform staff (even super admins) cannot sell on a farm’s behalf', async () => {
    const s = await w.seller();
    expect(
      (await w.call('post', w.admin, `/farms/${s.farmId}/products`, { ...PRODUCT, sku: sku() }))
        .status,
    ).toBe(403);
    expect(
      (await w.call('post', w.mod, `/farms/${s.farmId}/products`, { ...PRODUCT, sku: sku() }))
        .status,
    ).toBe(403);
  });

  it('follows the status machine: submit needs a photo and delivery rates; only a moderator approves; reasons are required; self-moderation is refused', async () => {
    const s = await w.seller();
    const nophoto = await w.create(s, { photos: [] });
    expect(
      (await w.call('post', s.user, `/farms/${s.farmId}/products/${nophoto.id}/submit`)).body.error
        .details[0].path,
    ).toBe('photos');
    const noship = await w.create(s, { shipping: undefined });
    expect(
      (await w.call('post', s.user, `/farms/${s.farmId}/products/${noship.id}/submit`)).body.error
        .details[0].path,
    ).toBe('shipping');
    const p = await w.create(s);
    const sub = await w.call('post', s.user, `/farms/${s.farmId}/products/${p.id}/submit`);
    expect(sub.body.product.status).toBe('PENDING_REVIEW');
    expect(
      (await w.call('post', s.user, `/farms/${s.farmId}/products/${p.id}/submit`)).status,
    ).toBe(409);
    for (const who of [s.user, await w.buyer()])
      expect((await w.call('post', who, `/shop/moderation/products/${p.id}/approve`)).status).toBe(
        403,
      );
    expect(
      (await w.call('post', w.mod, `/shop/moderation/products/${p.id}/reject`, {})).status,
    ).toBe(400);
    const rej = await w.call('post', w.mod, `/shop/moderation/products/${p.id}/reject`, {
      reason: 'Photos do not show the product',
    });
    expect(rej.body.product).toMatchObject({
      status: 'REJECTED',
      review: { rejectedReason: 'Photos do not show the product' },
    });
    const fix = await w.call('patch', s.user, `/farms/${s.farmId}/products/${p.id}`, {
      title: 'Premium dairy feed 25 kg (bag)',
    });
    expect(fix.body.product.status).toBe('DRAFT');
    await w.call('post', s.user, `/farms/${s.farmId}/products/${p.id}/submit`);
    expect(
      (await w.call('post', w.mod, `/shop/moderation/products/${p.id}/approve`)).body.product
        .status,
    ).toBe('ACTIVE');
    const events = (
      await w.call('get', s.user, `/farms/${s.farmId}/products/${p.id}`)
    ).body.events.map((e: any) => e.type);
    expect(events).toEqual(
      expect.arrayContaining([
        'created',
        'status.pending_review',
        'status.rejected',
        'withdrawn_for_edit',
        'status.active',
      ]),
    );
    // a moderator who sells on the farm cannot moderate its products
    const dual = await createStaff(h.app, ['moderator', 'seller', 'farm_owner']);
    const own = await w.seller();
    await w.addFarmMember(h.app, own.user, own.farmId, dual, 'manager');
    const q = await w.create(own);
    await w.call('post', own.user, `/farms/${own.farmId}/products/${q.id}/submit`);
    const self = await w.call('post', dual, `/shop/moderation/products/${q.id}/approve`);
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('SELF_MODERATION');
  });

  it('editing what a product IS sends a live product back to review; price, delivery and stock edits do not', async () => {
    const s = await w.seller();
    const p = await w.live(s);
    const price = await w.call('patch', s.user, `/farms/${s.farmId}/products/${p.id}`, {
      priceMinor: 110_000,
      minOrderQty: 2,
      maxOrderQty: 5,
    });
    expect(price.body.product).toMatchObject({
      status: 'ACTIVE',
      priceMinor: 110_000,
      minOrderQty: 2,
      maxOrderQty: 5,
    });
    // a partial update never resets what it did not mention
    expect(price.body.product.photos).toHaveLength(1);
    expect(price.body.product.specs).toHaveLength(2);
    expect(price.body.product.deliveryOptions).toEqual(['pickup', 'delivery']);
    expect(price.body.product.shipping.provinces).toHaveLength(2);
    const text = await w.call('patch', s.user, `/farms/${s.farmId}/products/${p.id}`, {
      description: 'New description of the product.',
    });
    expect(text.body.product.status).toBe('PENDING_REVIEW');
    const buyer = await w.buyer();
    expect((await w.call('get', buyer, `/shop/products/${p.id}`)).status).toBe(404); // hidden until re-approved
    await w.call('post', w.mod, `/shop/moderation/products/${p.id}/approve`);
    expect((await w.call('get', buyer, `/shop/products/${p.id}`)).status).toBe(200);
    const history = (await w.call('get', s.user, `/farms/${s.farmId}/products/${p.id}`)).body
      .events;
    expect(history.some((e: any) => e.type === 'material_edit')).toBe(true);
  });

  it('pause / resume / archive; a moderator suspension cannot be undone by the seller; archived products are frozen', async () => {
    const s = await w.seller();
    const p = await w.live(s);
    const buyer = await w.buyer();
    expect(
      (await w.call('post', s.user, `/farms/${s.farmId}/products/${p.id}/pause`)).body.product
        .status,
    ).toBe('PAUSED');
    expect((await w.call('get', buyer, `/shop/products/${p.id}`)).status).toBe(404);
    expect(
      (await w.call('post', s.user, `/farms/${s.farmId}/products/${p.id}/resume`)).body.product
        .status,
    ).toBe('ACTIVE');
    expect(
      (
        await w.call('post', w.mod, `/shop/moderation/products/${p.id}/suspend`, {
          reason: 'Complaint under review',
        })
      ).body.product.status,
    ).toBe('SUSPENDED');
    expect(
      (await w.call('post', s.user, `/farms/${s.farmId}/products/${p.id}/resume`)).status,
    ).toBe(409);
    expect(
      (await w.call('patch', s.user, `/farms/${s.farmId}/products/${p.id}`, { priceMinor: 1000 }))
        .status,
    ).toBe(409);
    expect(
      (await w.call('post', w.mod, `/shop/moderation/products/${p.id}/restore`)).body.product
        .status,
    ).toBe('ACTIVE');
    expect(
      (await w.call('post', s.user, `/farms/${s.farmId}/products/${p.id}/archive`)).body.product
        .status,
    ).toBe('ARCHIVED');
    for (const path of ['pause', 'resume', 'submit', 'archive'])
      expect(
        (await w.call('post', s.user, `/farms/${s.farmId}/products/${p.id}/${path}`)).status,
        path,
      ).toBe(409);
    expect(
      (
        await w.call('patch', s.user, `/farms/${s.farmId}/products/${p.id}`, {
          title: 'Zombie product',
        })
      ).status,
    ).toBe(409);
  });
});

// ---------------------------------------------------------------------------
describe('search and browse', () => {
  it('shows only approved products in open categories; drafts, paused, suspended and closed-category products never appear', async () => {
    const s = await w.seller();
    const tag = `Zq${Date.now()}`;
    const live = await w.live(s, { title: `${tag} live feed` });
    const draft = await w.create(s, { title: `${tag} draft feed` });
    const paused = await w.live(s, { title: `${tag} paused feed` });
    await w.call('post', s.user, `/farms/${s.farmId}/products/${paused.id}/pause`);
    const buyer = await w.buyer();
    const found = (await w.call('get', buyer, `/shop/products?q=${tag}`)).body;
    expect(found.items.map((x: any) => x.id)).toEqual([live.id]);
    expect(found.total).toBe(1);
    // switching the category off hides it everywhere, even though the product itself is still ACTIVE
    await ProductCategory.updateOne({ key: 'feed' }, { $set: { salesEnabled: false } });
    expect((await w.call('get', buyer, `/shop/products?q=${tag}`)).body.items).toHaveLength(0);
    expect((await w.call('get', buyer, `/shop/products/${live.id}`)).status).toBe(404);
    expect((await w.call('get', s.user, `/shop/products/${live.id}`)).status).toBe(200); // the seller still sees their own
    await ProductCategory.updateOne({ key: 'feed' }, { $set: { salesEnabled: true } });
    expect((await w.call('get', buyer, `/shop/products/${draft.id}`)).status).toBe(404);
    expect((await w.call('get', s.user, `/shop/products/${draft.id}`)).status).toBe(200);
    expect((await request(h.app).get(`${API}/shop/products`)).status).toBe(401);
  });

  it('filters by text, category, price (what the buyer pays now), stock and promotion; sorts and paginates deterministically', async () => {
    const s = await w.seller('Search Farm');
    const tag = `Sx${Date.now()}`;
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const cheap = await w.live(s, { title: `${tag} cheap`, priceMinor: 50_000, stock: 5 });
    const mid = await w.live(s, {
      title: `${tag} mid`,
      priceMinor: 200_000,
      stock: 5,
      brand: 'Zeta Brand',
    });
    const sale = await w.live(s, {
      title: `${tag} sale`,
      priceMinor: 500_000,
      stock: 5,
      promotion: {
        priceMinor: 100_000,
        startsAt: iso(now - 3_600_000),
        endsAt: iso(now + 3_600_000),
      },
    });
    const future = await w.live(s, {
      title: `${tag} future`,
      priceMinor: 90_000,
      stock: 5,
      promotion: {
        priceMinor: 10_000,
        startsAt: iso(now + 3_600_000),
        endsAt: iso(now + 7_200_000),
      },
    });
    const out = await w.live(s, { title: `${tag} soldout`, priceMinor: 70_000, stock: 0 });
    const tool = await w.live(s, {
      categoryKey: 'equipment',
      title: `${tag} feeder`,
      priceMinor: 300_000,
      stock: 3,
    });
    const buyer = await w.buyer();
    const q = async (qs: string) =>
      (await w.call('get', buyer, `/shop/products?q=${tag}&${qs}`)).body;
    const ids = (r: any) => r.items.map((x: any) => x.id);
    // price filters and sorting use what the buyer pays NOW: the promotion price while it runs, the list price otherwise
    expect(ids(await q('sort=price_asc'))).toEqual([
      cheap.id,
      out.id,
      future.id,
      sale.id,
      mid.id,
      tool.id,
    ]);
    expect(ids(await q('sort=price_desc'))).toEqual([
      tool.id,
      mid.id,
      sale.id,
      future.id,
      out.id,
      cheap.id,
    ]);
    expect(ids(await q('minPriceMinor=95000&maxPriceMinor=250000&sort=price_asc'))).toEqual([
      sale.id,
      mid.id,
    ]);
    expect(ids(await q('maxPriceMinor=60000'))).toEqual([cheap.id]);
    expect(ids(await q('onSale=true'))).toEqual([sale.id]); // a promotion that has not started is not a sale
    expect((await q('onSale=true')).items[0]).toMatchObject({
      priceMinor: 500_000,
      effectivePriceMinor: 100_000,
      onSale: true,
    });
    expect((await q('inStock=true')).items.map((x: any) => x.id)).not.toContain(out.id);
    expect((await q('inStock=true')).total).toBe(5);
    expect(ids(await q('category=equipment'))).toEqual([tool.id]);
    expect(ids(await q('category=feed&sort=price_asc'))).toHaveLength(5);
    expect(
      (await w.call('get', buyer, `/shop/products?q=Zeta`)).body.items.map((x: any) => x.id),
    ).toEqual([mid.id]); // brand is searched too
    expect(
      (await w.call('get', buyer, `/shop/products?q=${encodeURIComponent('.*')}`)).body.items,
    ).toHaveLength(0); // regex is inert
    expect((await q(`farmId=${s.farmId}`)).total).toBe(6);
    expect((await q(`farmId=${(await w.seller()).farmId}`)).total).toBe(0);
    // pagination: stable order, no duplicates, correct total
    const p1 = await q('sort=price_asc&pageSize=4&page=1');
    const p2 = await q('sort=price_asc&pageSize=4&page=2');
    expect(p1).toMatchObject({ total: 6, page: 1, pageSize: 4 });
    expect([...ids(p1), ...ids(p2)]).toEqual([
      cheap.id,
      out.id,
      future.id,
      sale.id,
      mid.id,
      tool.id,
    ]);
    expect(ids(await q('sort=newest'))[0]).toBe(tool.id);
    // validation of the query itself
    for (const bad of [
      'pageSize=500',
      'page=0',
      'sort=cheapest',
      'minPriceMinor=9&maxPriceMinor=1',
      'inStock=maybe',
      'unknown=1',
      'category=Bad Key',
    ])
      expect((await w.call('get', buyer, `/shop/products?${bad}`)).status, bad).toBe(400);
    // exact stock is a seller matter; buyers get availability and an in-stock flag
    const detail = (await w.call('get', buyer, `/shop/products/${cheap.id}`)).body.product;
    expect(detail).toMatchObject({ available: 5, inStock: true });
    expect(detail.inventory).toBeUndefined();
    expect(detail.review).toBeUndefined();
    expect(
      (await w.call('get', s.user, `/shop/products/${cheap.id}`)).body.product.inventory,
    ).toEqual({ stock: 5, reserved: 0, lowStockThreshold: null });
  });
});

// ---------------------------------------------------------------------------
const stockOf = async (id: string) => {
  const p = (await Product.findById(id))!;
  return { stock: p.stock, reserved: p.reserved, available: p.stock - p.reserved };
};
const moves = async (id: string) =>
  (await InventoryMovement.find({ productId: id }).sort({ createdAt: 1, _id: 1 })).map(
    (m) => `${m.type}:${m.deltaStock}/${m.deltaReserved}`,
  );

describe('inventory', () => {
  it('seller adjustments are recorded; you cannot go below what unpaid orders hold, or below zero; reasons are required', async () => {
    const s = await w.seller();
    const p = await w.live(s, { stock: 10 });
    const adj = (body: object) =>
      w.call('post', s.user, `/farms/${s.farmId}/products/${p.id}/stock`, body);
    expect(
      (await adj({ delta: 5, reason: 'Delivery from supplier' })).body.product.inventory,
    ).toMatchObject({ stock: 15 });
    expect((await adj({ set: 12, reason: 'Stock count' })).body.product.inventory).toMatchObject({
      stock: 12,
    });
    expect((await adj({ delta: -2, reason: 'Damaged bags' })).body.product.inventory.stock).toBe(
      10,
    );
    expect((await adj({ delta: -11, reason: 'Too many' })).body.error.code).toBe('NEGATIVE_STOCK');
    expect((await adj({ delta: 5 })).status).toBe(400); // a reason is required
    expect((await adj({ delta: 0, reason: 'nothing' })).status).toBe(400);
    expect((await adj({ delta: 1, set: 3, reason: 'both given' })).status).toBe(400);
    expect((await adj({ reason: 'neither given' })).status).toBe(400);
    expect((await adj({ delta: 1.5, reason: 'fraction' })).status).toBe(400);
    // 4 units are reserved by an unpaid order: the shelf total cannot go under 4
    const buyer = await w.buyer();
    await w.put(buyer, p.id, 4);
    await w.checkout(buyer);
    expect(await stockOf(p.id)).toEqual({ stock: 10, reserved: 4, available: 6 });
    const low = await adj({ set: 3, reason: 'Recount' });
    expect(low.status).toBe(409);
    expect(low.body.error.code).toBe('BELOW_RESERVED');
    expect((await adj({ set: 4, reason: 'Recount' })).body.product.inventory).toMatchObject({
      stock: 4,
      reserved: 4,
    });
    const log = (await w.call('get', s.user, `/farms/${s.farmId}/products/${p.id}/movements`)).body
      .items;
    expect(log.map((m: any) => m.type)).toEqual([
      'adjustment',
      'reserve',
      'adjustment',
      'adjustment',
      'adjustment',
      'initial',
    ]);
    expect(log.find((m: any) => m.type === 'adjustment').note).toBeTruthy();
    expect(
      (await w.call('get', buyer, `/farms/${s.farmId}/products/${p.id}/movements`)).status,
    ).toBe(404);
  });

  it('stock can NEVER go negative under concurrent orders: 25 buyers race for 7 units', async () => {
    const s = await w.seller();
    const p = await w.live(s, { stock: 7 });
    const buyers = await Promise.all(Array.from({ length: 25 }, () => w.buyer()));
    await Promise.all(buyers.map((b) => w.put(b, p.id, 1)));
    const results = await Promise.all(
      buyers.map(async (b) =>
        w.call('post', b, '/shop/cart/checkout', {
          fulfillment: 'pickup',
          expected: w.expectedOf(await w.cartOf(b)),
        }),
      ),
    );
    const ok = results.filter((r) => r.status === 201);
    const refused = results.filter((r) => r.status !== 201);
    expect(ok).toHaveLength(7);
    expect(
      refused.every(
        (r) =>
          r.status === 409 &&
          ['INSUFFICIENT_STOCK', 'CART_HAS_PROBLEMS'].includes(r.body.error.code),
      ),
    ).toBe(true);
    expect(await stockOf(p.id)).toEqual({ stock: 7, reserved: 7, available: 0 });
    expect(
      await Order.countDocuments({ 'items.productId': new Types.ObjectId(p.id), kind: 'product' }),
    ).toBe(7);
    // the ledger agrees with the projection
    const sums = await InventoryMovement.aggregate([
      { $match: { productId: (await Product.findById(p.id))!._id } },
      { $group: { _id: null, s: { $sum: '$deltaStock' }, r: { $sum: '$deltaReserved' } } },
    ]);
    expect([sums[0].s, sums[0].r]).toEqual([7, 7]);
  });

  it('larger quantities race correctly too, and one buyer’s multi-line cart is all-or-nothing', async () => {
    const s = await w.seller();
    const p = await w.live(s, { stock: 10 });
    const buyers = await Promise.all(Array.from({ length: 8 }, () => w.buyer()));
    await Promise.all(buyers.map((b) => w.put(b, p.id, 3)));
    const rs = await Promise.all(
      buyers.map(async (b) =>
        w.call('post', b, '/shop/cart/checkout', {
          fulfillment: 'pickup',
          expected: w.expectedOf(await w.cartOf(b)),
        }),
      ),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(3); // 3 × 3 = 9 ≤ 10 < 12
    expect(await stockOf(p.id)).toEqual({ stock: 10, reserved: 9, available: 1 });
    // two lines, the second cannot be filled: nothing is reserved for the first either
    const a = await w.live(s, { stock: 5 });
    const b = await w.live(s, { stock: 5 });
    const buyer = await w.buyer();
    await w.put(buyer, a.id, 2);
    await w.put(buyer, b.id, 2);
    const cart = await w.cartOf(buyer);
    await Product.updateOne({ _id: b.id }, { $set: { reserved: 4 } }); // someone else holds 4 of b's 5 (simulated)
    await InventoryMovement.create({
      productId: b.id,
      farmId: s.farmId,
      type: 'reserve',
      deltaStock: 0,
      deltaReserved: 4,
      orderId: null,
    });
    const fail = await w.call('post', buyer, '/shop/cart/checkout', {
      fulfillment: 'pickup',
      expected: w.expectedOf(cart),
    });
    expect(fail.status).toBe(409);
    expect(await stockOf(a.id)).toEqual({ stock: 5, reserved: 0, available: 5 });
    expect(await Order.countDocuments({ buyerId: buyer.id })).toBe(0);
    expect((await Cart.findOne({ userId: buyer.id }))?.items).toHaveLength(2); // the cart is untouched
  });

  it('payment turns the reservation into a sale; cancelling or expiring an unpaid order releases it; a refund puts sold units back — each exactly once', async () => {
    const s = await w.seller();
    const p = await w.live(s, { stock: 10 });
    const buyer = await w.buyer();
    await w.put(buyer, p.id, 3);
    const o = (await w.checkout(buyer)).body.orders[0];
    expect(await stockOf(p.id)).toEqual({ stock: 10, reserved: 3, available: 7 });
    expect((await w.pay(buyer, o)).result).toBe('succeeded');
    expect(await stockOf(p.id)).toEqual({ stock: 7, reserved: 0, available: 7 });
    expect(await moves(p.id)).toEqual(['initial:10/0', 'reserve:0/3', 'sale:-3/-3']);
    // replaying the commit (webhook redelivery, cleanup) changes nothing
    const { commitOrder, returnOrder } = await import('../src/modules/products/inventory.service');
    await commitOrder({ orderId: (await Order.findById(o.id))!._id, orderNo: o.orderNo });
    await commitOrder({ orderId: (await Order.findById(o.id))!._id, orderNo: o.orderNo });
    expect(await stockOf(p.id)).toEqual({ stock: 7, reserved: 0, available: 7 });
    // a second order whose commit was missed: five parallel commits (webhook redelivery racing the cleanup job) deduct once
    await w.put(buyer, p.id, 2);
    const racing = (await w.checkout(buyer)).body.orders[0];
    const rref = { orderId: (await Order.findById(racing.id))!._id, orderNo: racing.orderNo };
    await Promise.all(Array.from({ length: 5 }, () => commitOrder(rref)));
    expect(await stockOf(p.id)).toEqual({ stock: 5, reserved: 0, available: 5 });
    await Promise.all(Array.from({ length: 5 }, () => returnOrder(rref, 'test')));
    expect(await stockOf(p.id)).toEqual({ stock: 7, reserved: 0, available: 7 });
    // buyer cancels the paid order: units go back on the shelf once
    expect(
      (await w.call('post', buyer, `/orders/${o.id}/cancel`, { reason: 'Changed my mind' })).status,
    ).toBe(200);
    expect(await stockOf(p.id)).toEqual({ stock: 10, reserved: 0, available: 10 });
    expect(await moves(p.id)).toEqual([
      'initial:10/0',
      'reserve:0/3',
      'sale:-3/-3',
      'reserve:0/2',
      'sale:-2/-2',
      'restock:2/0',
      'restock:3/0',
    ]);
    // unpaid cancel
    await w.put(buyer, p.id, 2);
    const o2 = (await w.checkout(buyer)).body.orders[0];
    expect(await stockOf(p.id)).toEqual({ stock: 10, reserved: 2, available: 8 });
    await w.call('post', buyer, `/orders/${o2.id}/cancel`, { reason: 'Never mind' });
    expect(await stockOf(p.id)).toEqual({ stock: 10, reserved: 0, available: 10 });
    // expiry
    await w.put(buyer, p.id, 4);
    const o3 = (await w.checkout(buyer)).body.orders[0];
    await Order.updateOne({ _id: o3.id }, { $set: { paymentDueAt: new Date(Date.now() - 1000) } });
    const { runOrdersCleanup } = await import('../src/modules/orders/orders.service');
    await runOrdersCleanup();
    expect((await Order.findById(o3.id))?.status).toBe('CANCELLED');
    expect(await stockOf(p.id)).toEqual({ stock: 10, reserved: 0, available: 10 });
    await runOrdersCleanup();
    expect(await stockOf(p.id)).toEqual({ stock: 10, reserved: 0, available: 10 });
  });

  it('reconciliation finds and repairs stock that disagrees with the movement log; cleanup releases orphaned reservations and completes missed sales', async () => {
    const s = await w.seller();
    const p = await w.live(s, { stock: 10 });
    const inv = await import('../src/modules/products/inventory.service');
    await Product.updateOne({ _id: p.id }, { $inc: { stock: 3, reserved: 1 } });
    const dry = await inv.reconcileInventory({ repair: false });
    const drift = dry.drift.find((d) => d.productId === p.id)!;
    expect(drift).toMatchObject({ stock: [13, 10], reserved: [1, 0], repaired: false });
    expect(await stockOf(p.id)).toMatchObject({ stock: 13 }); // a dry run changes nothing
    await inv.reconcileInventory({ repair: true });
    expect(await stockOf(p.id)).toEqual({ stock: 10, reserved: 0, available: 10 });
    expect(
      (await inv.reconcileInventory({ repair: false })).drift.find((d) => d.productId === p.id),
    ).toBeUndefined();
    // a reservation whose order was never created (crash) is released after a grace period
    const ghost = (await Product.findById(p.id))!;
    const ghostOrder = {
      orderId: new (await import('mongoose')).Types.ObjectId(),
      orderNo: 'FP-GHOST',
    };
    await inv.reserve(ghost, 2, ghostOrder);
    expect(await stockOf(p.id)).toMatchObject({ reserved: 2 });
    expect((await inv.runInventoryCleanup()).orphanReservationsReleased).toBe(0); // too recent: it may still be being created
    await InventoryMovement.collection.updateMany(
      { orderNo: 'FP-GHOST' },
      { $set: { createdAt: new Date(Date.now() - 3_600_000) } },
    );
    expect((await inv.runInventoryCleanup()).orphanReservationsReleased).toBeGreaterThanOrEqual(1);
    expect(await stockOf(p.id)).toEqual({ stock: 10, reserved: 0, available: 10 });
    // a paid order whose stock deduction never ran (crash after payment) is completed
    const buyer = await w.buyer();
    await w.put(buyer, p.id, 2);
    const o = (await w.checkout(buyer)).body.orders[0];
    await Order.updateOne(
      { _id: o.id },
      { $set: { status: 'PAID', paidAt: new Date(), paymentRef: 'crash-ref' } },
    ); // payment recorded, commit missed
    await InventoryMovement.collection.updateMany(
      { orderNo: o.orderNo },
      { $set: { createdAt: new Date(Date.now() - 3_600_000) } },
    );
    expect((await inv.runInventoryCleanup()).salesCompleted).toBeGreaterThanOrEqual(1);
    expect(await stockOf(p.id)).toEqual({ stock: 8, reserved: 0, available: 8 });
  });
});

// ---------------------------------------------------------------------------
describe('cart', () => {
  it('stores ids and quantities per buyer; prices and availability are always read live', async () => {
    const s = await w.seller();
    const p = await w.live(s, { stock: 10, priceMinor: 100_000 });
    const buyer = await w.buyer();
    const add = await w.put(buyer, p.id, 2);
    expect(add.status, JSON.stringify(add.body)).toBe(200);
    expect(add.body.cart).toMatchObject({ itemCount: 2, itemsMinor: 200_000, hasProblems: false });
    const raw = (await Cart.findOne({ userId: buyer.id }).lean())!;
    expect(JSON.stringify(raw.items)).not.toContain('100000'); // no price is stored
    // the seller changes the price and a promotion: the cart follows
    await w.call('patch', s.user, `/farms/${s.farmId}/products/${p.id}`, { priceMinor: 150_000 });
    expect((await w.cartOf(buyer)).itemsMinor).toBe(300_000);
    await w.call('patch', s.user, `/farms/${s.farmId}/products/${p.id}`, {
      promotion: {
        priceMinor: 90_000,
        startsAt: new Date(Date.now() - 1000).toISOString(),
        endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });
    const live = (await w.cartOf(buyer)).groups[0].lines[0];
    expect(live).toMatchObject({
      unitPriceMinor: 90_000,
      regularPriceMinor: 150_000,
      onSale: true,
      lineTotalMinor: 180_000,
    });
    // a second session of the same user sees the same cart; another user sees nothing
    expect((await w.call('get', await w.buyer(), '/shop/cart')).body.cart.itemCount).toBe(0);
    // update quantity, remove, clear
    expect((await w.put(buyer, p.id, 5)).body.cart.itemCount).toBe(5);
    expect(await Cart.countDocuments({ userId: buyer.id })).toBe(1);
    expect((await w.call('delete', buyer, `/shop/cart/items/${p.id}`)).body.cart.itemCount).toBe(0);
    await w.put(buyer, p.id, 1);
    expect((await w.call('delete', buyer, '/shop/cart')).body.cart.itemCount).toBe(0);
  });

  it('rules: quantities within min/max, no own products, nothing unavailable, at most 50 lines; problems are flagged on the lines', async () => {
    const s = await w.seller();
    const p = await w.live(s, { stock: 4, minOrderQty: 2, maxOrderQty: 3 });
    const buyer = await w.buyer();
    expect((await w.put(buyer, p.id, 1)).status).toBe(400);
    expect((await w.put(buyer, p.id, 4)).status).toBe(400);
    expect((await w.call('put', buyer, `/shop/cart/items/${p.id}`, { quantity: 0 })).status).toBe(
      400,
    );
    expect((await w.call('put', buyer, `/shop/cart/items/${p.id}`, { quantity: 2.5 })).status).toBe(
      400,
    );
    expect(
      (await w.call('put', buyer, `/shop/cart/items/${p.id}`, { quantity: 2, price: 1 })).status,
    ).toBe(400);
    expect((await w.put(s.user, p.id, 2)).body.error.code).toBe('OWN_PRODUCT');
    expect((await w.put(buyer, '0'.repeat(24), 2)).status).toBe(404);
    expect((await w.put(buyer, 'not-an-id', 2)).status).toBe(404);
    const draft = await w.create(s);
    expect((await w.put(buyer, draft.id, 2)).status).toBe(404);
    expect((await w.put(buyer, p.id, 3)).status).toBe(200);
    // things change after adding: out of stock, paused
    await Product.updateOne({ _id: p.id }, { $set: { stock: 2 } });
    expect((await w.cartOf(buyer)).groups[0].lines[0].problems).toEqual(['insufficient_stock']);
    await Product.updateOne({ _id: p.id }, { $set: { stock: 0 } });
    expect((await w.cartOf(buyer)).groups[0].lines[0].problems).toEqual(['out_of_stock']);
    await Product.updateOne({ _id: p.id }, { $set: { stock: 4, status: 'PAUSED' } });
    const c = await w.cartOf(buyer);
    expect(c.groups[0].lines[0].problems).toEqual(['unavailable']);
    expect(c.hasProblems).toBe(true);
    // a deleted product
    await Product.deleteOne({ _id: p.id });
    expect((await w.cartOf(buyer)).groups[0].lines[0]).toMatchObject({
      title: 'No longer available',
      problems: ['unavailable'],
    });
    // line cap
    const many = await w.buyer();
    const items = await Promise.all(
      Array.from({ length: 51 }, () => w.live(s, { stock: 1, minOrderQty: 1 })),
    );
    for (const it of items.slice(0, 50)) expect((await w.put(many, it.id, 1)).status).toBe(200);
    expect((await w.put(many, items[50].id, 1)).body.error.code).toBe('CART_FULL');
    expect((await w.put(many, items[0].id, 1)).status).toBe(200); // updating an existing line is still fine
  }, 60_000);

  it('groups by seller farm and previews each farm’s own delivery rates for a province (summed per product; never invented)', async () => {
    const a = await w.seller('Farm A');
    const b = await w.seller('Farm B');
    const a1 = await w.live(a, { priceMinor: 100_000, stock: 9 });
    const a2 = await w.live(a, {
      priceMinor: 50_000,
      stock: 9,
      shipping: { mode: 'flat', flatPriceMinor: 8_000 },
    });
    const b1 = await w.live(b, {
      priceMinor: 70_000,
      stock: 9,
      deliveryOptions: ['pickup'],
      shipping: undefined,
    });
    const buyer = await w.buyer();
    await w.put(buyer, a1.id, 2);
    await w.put(buyer, a2.id, 1);
    await w.put(buyer, b1.id, 3);
    const bkk = await w.cartOf(buyer, 'Bangkok');
    expect(bkk.groups).toHaveLength(2);
    const ga = bkk.groups.find((g: any) => g.farmId === a.farmId);
    const gb = bkk.groups.find((g: any) => g.farmId === b.farmId);
    expect(ga).toMatchObject({ itemsMinor: 250_000, canPickup: true, canDeliver: true });
    expect(ga.shipping).toMatchObject({
      available: true,
      shippingMinor: 23_000,
      isEstimate: true,
      estimatedDays: { min: 1, max: 3 },
    }); // 15,000 + 8,000 (one rate per product line)
    expect(gb).toMatchObject({ itemsMinor: 210_000, canDeliver: false });
    expect(gb.shipping).toMatchObject({ available: false });
    expect(gb.shipping.reason).toContain('pickup only');
    const km = await w.cartOf(buyer, 'Khon Kaen'); // not served by farm A's by-province rates
    expect(km.groups.find((g: any) => g.farmId === a.farmId).shipping).toMatchObject({
      available: false,
    });
    expect((await w.cartOf(buyer)).groups[0].shipping).toBeUndefined(); // no destination: not computed
  });
});

// ---------------------------------------------------------------------------
describe('checkout reuses the order, payment and shipping modules', () => {
  it('creates one ordinary order per seller farm, with items, shipping and the platform fee kept apart', async () => {
    const a = await w.seller('Farm A');
    const b = await w.seller('Farm B');
    const a1 = await w.live(a, { priceMinor: 100_000, stock: 9, title: 'Feed A1' });
    const b1 = await w.live(b, {
      priceMinor: 70_000,
      stock: 9,
      title: 'Feed B1',
      shipping: { mode: 'flat', flatPriceMinor: 5_000 },
    });
    const buyer = await w.buyer();
    await w.put(buyer, a1.id, 2);
    await w.put(buyer, b1.id, 3);
    const res = await w.checkout(buyer, { delivery: true });
    const orders = res.body.orders as any[];
    expect(orders).toHaveLength(2);
    const oa = orders.find((o) => o.farmName === 'Farm A');
    const ob = orders.find((o) => o.farmName === 'Farm B');
    expect(oa).toMatchObject({
      kind: 'product',
      status: 'PENDING_PAYMENT',
      fulfillment: 'delivery',
      totals: {
        itemsMinor: 200_000,
        shippingMinor: 15_000,
        platformFeeMinor: 0,
        grandTotalMinor: 215_000,
      },
    });
    expect(ob.totals).toMatchObject({
      itemsMinor: 210_000,
      shippingMinor: 5_000,
      grandTotalMinor: 215_000,
    });
    expect(oa.items[0]).toMatchObject({
      type: 'product',
      title: 'Feed A1',
      quantity: 2,
      unitPriceMinor: 100_000,
      totalMinor: 200_000,
      priceSource: 'regular',
    });
    expect(oa.shipping).toMatchObject({
      label: 'Delivery arranged by the seller',
      isEstimate: true,
      estimatedDays: { min: 1, max: 3 },
    });
    expect(oa.address.recipientName).toBeTruthy(); // the buyer sees their own address
    // the cart is emptied of what was ordered
    expect((await w.cartOf(buyer)).itemCount).toBe(0);
    // each order is visible to its buyer and to ITS seller side only
    const stranger = await w.buyer();
    for (const o of orders) {
      expect((await w.get(buyer, `/orders/${o.id}`)).status).toBe(200);
      expect((await w.get(stranger, `/orders/${o.id}`)).status).toBe(404);
    }
    expect((await w.get(a.user, `/orders/${oa.id}`)).body.order.viewer.party).toBe('seller');
    expect((await w.get(a.user, `/orders/${ob.id}`)).status).toBe(404);
    expect(
      (await w.get(a.user, `/farms/${a.farmId}/orders`)).body.items.map((o: any) => o.id),
    ).toEqual([oa.id]);
    expect((await w.get(buyer, '/orders')).body.items.map((o: any) => o.kind)).toEqual([
      'product',
      'product',
    ]);
    // address stays encrypted at rest
    const raw = JSON.stringify(await Order.findById(oa.id).lean());
    expect(raw).not.toContain('Secret Street');
    // the seller gets the farm OWNER's earnings
    expect(String((await Order.findById(oa.id))!.sellerId)).toBe(a.user.id);
  });

  it('the fee comes from the commission rules by product category (per line, with the workings kept), and the order is paid through the normal payment flow', async () => {
    const fin = await createStaff(h.app, ['finance_admin']);
    const made = await request(h.app)
      .post(`${API}/admin/finance/commission-rules`)
      .set(fin.auth)
      .send({
        name: 'Feed 5%',
        feeBps: 500,
        categories: ['feed'],
        startsAt: '2020-01-01T00:00:00.000Z',
        priority: 40,
        reason: 'Shop launch',
      });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    try {
      const s = await w.seller();
      const feed = await w.live(s, { priceMinor: 100_000, stock: 9 });
      const tool = await w.live(s, { categoryKey: 'equipment', priceMinor: 50_000, stock: 9 });
      const buyer = await w.buyer();
      await w.put(buyer, feed.id, 2);
      await w.put(buyer, tool.id, 1);
      const o = (await w.checkout(buyer)).body.orders[0];
      expect(o.totals).toMatchObject({
        itemsMinor: 250_000,
        platformFeeMinor: 10_000,
        sellerPayoutMinor: 240_000,
        grandTotalMinor: 250_000,
      }); // 5% of the feed line only
      const doc = (await Order.findById(o.id))!;
      expect(doc.feeSnapshot).toMatchObject({
        source: 'lines',
        feeMinor: 10_000,
        baseMinor: 250_000,
      });
      expect(doc.feeSnapshot!.lines!.map((l) => [l.categoryKey, l.source, l.feeMinor])).toEqual([
        ['feed', 'rule', 10_000],
        ['equipment', 'default_setting', 0],
      ]);
      // paid by the Part 13 flow: no shop-specific payment code
      const paid = await w.pay(buyer, o);
      expect(paid.result).toBe('succeeded');
      expect((await Order.findById(o.id))?.status).toBe('PAID');
      const { WalletTransaction } = await import('../src/models');
      const capture = await WalletTransaction.find({
        journalKey: `capture:${paid.payment.id}`,
      }).sort({ lineNo: 1 });
      expect(capture.map((l) => [l.walletKind, l.amountMinor])).toEqual([
        ['provider', -250_000],
        ['seller', 240_000],
        ['platform', 10_000],
      ]);
      expect((await w.get(buyer, `/payments?orderId=${o.id}`)).body.payments).toHaveLength(1);
    } finally {
      await CommissionRule.updateMany({}, { $set: { active: false } });
    }
  });

  it('price snapshots are stable: later product edits, a new promotion, a rename or an archive never change an existing order', async () => {
    const s = await w.seller();
    const p = await w.live(s, {
      priceMinor: 100_000,
      stock: 9,
      title: 'Original feed',
      specs: [{ name: 'Protein', value: '18%' }],
      photos: [{ url: 'https://cdn.example.test/orig.jpg' }],
      brand: 'OldBrand',
    });
    const buyer = await w.buyer();
    await w.put(buyer, p.id, 2);
    const o = (await w.checkout(buyer)).body.orders[0];
    const before = (await w.get(buyer, `/orders/${o.id}`)).body.order;
    // the seller changes everything about the product, then archives it
    await w.call('patch', s.user, `/farms/${s.farmId}/products/${p.id}`, {
      priceMinor: 999_999,
      title: 'Completely different product',
      description: 'Edited description here.',
      brand: 'NewBrand',
      specs: [{ name: 'Protein', value: '30%' }],
      photos: [{ url: 'https://cdn.example.test/new.jpg' }],
      promotion: {
        priceMinor: 1,
        startsAt: new Date(Date.now() - 1000).toISOString(),
        endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });
    await w.call('post', w.mod, `/shop/moderation/products/${p.id}/approve`);
    await w.call('post', s.user, `/farms/${s.farmId}/products/${p.id}/archive`);
    await ProductCategory.updateOne({ key: 'feed' }, { $set: { name: 'Renamed category' } });
    try {
      const after = (await w.get(buyer, `/orders/${o.id}`)).body.order;
      expect(after.items).toEqual(before.items);
      expect(after.items[0]).toMatchObject({
        title: 'Original feed',
        brand: 'OldBrand',
        unitPriceMinor: 100_000,
        totalMinor: 200_000,
        categoryName: 'Animal feed',
        specs: [{ name: 'Protein', value: '18%' }],
        photoUrl: 'https://cdn.example.test/orig.jpg',
        priceSource: 'regular',
      });
      expect(after.totals).toEqual(before.totals);
      // payment is judged against the frozen total, not today's price
      expect((await w.pay(buyer, o)).result).toBe('succeeded');
      expect((await Order.findById(o.id))?.grandTotalMinor).toBe(200_000);
    } finally {
      await ProductCategory.updateOne({ key: 'feed' }, { $set: { name: 'Animal feed' } });
    }
  });

  it('a promotion running at checkout is frozen on the order with the list price beside it', async () => {
    const s = await w.seller();
    const p = await w.live(s, {
      priceMinor: 100_000,
      stock: 9,
      promotion: {
        priceMinor: 80_000,
        startsAt: new Date(Date.now() - 1000).toISOString(),
        endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });
    const buyer = await w.buyer();
    await w.put(buyer, p.id, 1);
    const o = (await w.checkout(buyer)).body.orders[0];
    expect(o.items[0]).toMatchObject({
      unitPriceMinor: 80_000,
      regularPriceMinor: 100_000,
      priceSource: 'promotion',
    });
    await Product.updateOne({ _id: p.id }, { $set: { promotion: null } });
    expect((await w.get(buyer, `/orders/${o.id}`)).body.order.items[0].unitPriceMinor).toBe(80_000);
  });

  it('the buyer confirms what they saw: changed prices, shipping, carts or missing sellers stop the checkout before anything is reserved', async () => {
    const s = await w.seller();
    const p = await w.live(s, { priceMinor: 100_000, stock: 9 });
    const buyer = await w.buyer();
    await w.put(buyer, p.id, 2);
    const cart = await w.cartOf(buyer, 'Bangkok');
    const g = cart.groups[0];
    const post = (body: object) => w.call('post', buyer, '/shop/cart/checkout', body);
    const base = {
      fulfillment: 'delivery',
      address: {
        recipientName: 'Somsak Jaidee',
        phone: '+66 81 234 5678',
        line1: '99/9 Moo 3 Secret Street',
        district: 'Bang Na',
        province: 'Bangkok',
        postalCode: '10260',
      },
    };
    await w.call('patch', s.user, `/farms/${s.farmId}/products/${p.id}`, { priceMinor: 110_000 });
    const priceMoved = await post({
      ...base,
      expected: [
        { farmId: g.farmId, itemsMinor: g.itemsMinor, shippingMinor: g.shipping.shippingMinor },
      ],
    });
    expect(priceMoved.status).toBe(409);
    expect(priceMoved.body.error.code).toBe('PRICE_CHANGED');
    await w.call('patch', s.user, `/farms/${s.farmId}/products/${p.id}`, {
      priceMinor: 100_000,
      shipping: { mode: 'flat', flatPriceMinor: 99_000 },
    });
    expect(
      (
        await post({
          ...base,
          expected: [
            { farmId: g.farmId, itemsMinor: g.itemsMinor, shippingMinor: g.shipping.shippingMinor },
          ],
        })
      ).body.error.code,
    ).toBe('SHIPPING_CHANGED');
    expect(
      (
        await post({
          ...base,
          expected: [{ farmId: '1'.repeat(24), itemsMinor: 1, shippingMinor: 0 }],
        })
      ).body.error.code,
    ).toBe('CART_CHANGED');
    expect(
      (
        await post({
          ...base,
          expected: [
            { farmId: g.farmId, itemsMinor: g.itemsMinor, shippingMinor: 99_000 },
            { farmId: g.farmId, itemsMinor: g.itemsMinor, shippingMinor: 99_000 },
          ],
        })
      ).body.error.code,
    ).toBe('CART_CHANGED');
    expect((await post({ ...base, expected: [] })).status).toBe(400);
    expect(await stockOf(p.id)).toMatchObject({ reserved: 0 });
    expect(await Order.countDocuments({ buyerId: buyer.id })).toBe(0);
    // empty cart
    await w.call('delete', buyer, '/shop/cart');
    expect(
      (
        await post({
          fulfillment: 'pickup',
          expected: [{ farmId: g.farmId, itemsMinor: 1, shippingMinor: 0 }],
        })
      ).body.error.code,
    ).toBe('CART_EMPTY');
  });

  it('validates fulfilment: delivery needs an address and rates for it; pickup takes no address; unavailable lines block the whole checkout', async () => {
    const s = await w.seller();
    const both = await w.live(s, { stock: 9 });
    const pickupOnly = await w.live(s, {
      stock: 9,
      deliveryOptions: ['pickup'],
      shipping: undefined,
    });
    const buyer = await w.buyer();
    await w.put(buyer, both.id, 1);
    const g = (await w.cartOf(buyer, 'Bangkok')).groups[0];
    const post = (body: object) => w.call('post', buyer, '/shop/cart/checkout', body);
    const exp = [
      { farmId: g.farmId, itemsMinor: g.itemsMinor, shippingMinor: g.shipping.shippingMinor },
    ];
    expect((await post({ fulfillment: 'delivery', expected: exp })).status).toBe(400); // no address
    expect(
      (await post({ fulfillment: 'pickup', expected: exp, address: { recipientName: 'x' } }))
        .status,
    ).toBe(400);
    const khon = {
      recipientName: 'Somsak Jaidee',
      phone: '+66 81 234 5678',
      line1: '99/9 Moo 3 Street',
      district: 'Muang',
      province: 'Khon Kaen',
      postalCode: '40000',
    };
    expect(
      (await post({ fulfillment: 'delivery', address: khon, expected: exp })).body.error.code,
    ).toBe('NO_DELIVERY'); // not served
    await w.put(buyer, pickupOnly.id, 1);
    const g2 = (await w.cartOf(buyer, 'Bangkok')).groups[0];
    const exp2 = [{ farmId: g2.farmId, itemsMinor: g2.itemsMinor, shippingMinor: 0 }];
    expect(
      (
        await post({
          fulfillment: 'delivery',
          address: { ...khon, province: 'Bangkok', postalCode: '10260' },
          expected: exp2,
        })
      ).body.error.code,
    ).toBe('NO_DELIVERY');
    await Product.updateOne({ _id: both.id }, { $set: { status: 'PAUSED' } });
    const blocked = await post({ fulfillment: 'pickup', expected: exp2 });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('CART_HAS_PROBLEMS');
    expect(await Order.countDocuments({ buyerId: buyer.id })).toBe(0);
  });

  it('a failure on a later seller cancels the earlier seller’s order too and gives its stock back (all or nothing)', async () => {
    const a = await w.seller('Farm A');
    const b = await w.seller('Farm B');
    const a1 = await w.live(a, { stock: 5 });
    const b1 = await w.live(b, { stock: 5 });
    const buyer = await w.buyer();
    await w.put(buyer, a1.id, 2);
    await w.put(buyer, b1.id, 2);
    const cart = await w.cartOf(buyer);
    // The cart looked fine, but when farm B's stock is taken someone else got there first (the atomic guard says no).
    const original = Product.findOneAndUpdate.bind(Product);
    const spy = vi
      .spyOn(Product, 'findOneAndUpdate')
      .mockImplementation(((filter: any, ...rest: unknown[]) =>
        String(filter?._id) === b1.id && filter?.$expr
          ? Promise.resolve(null)
          : (original as any)(filter, ...rest)) as never);
    let fail;
    try {
      fail = await w.call('post', buyer, '/shop/cart/checkout', {
        fulfillment: 'pickup',
        expected: w.expectedOf(cart),
      });
    } finally {
      spy.mockRestore();
    }
    expect(fail.status).toBe(409);
    expect(fail.body.error.code).toBe('INSUFFICIENT_STOCK');
    // farm A's order WAS created first, then cancelled by the system with its stock released
    const orders = await Order.find({ buyerId: buyer.id });
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ status: 'CANCELLED', cancelReason: 'checkout_failed' });
    expect(await stockOf(a1.id)).toEqual({ stock: 5, reserved: 0, available: 5 });
    expect(await stockOf(b1.id)).toEqual({ stock: 5, reserved: 0, available: 5 });
    expect(await moves(a1.id)).toEqual(['initial:5/0', 'reserve:0/2', 'release:0/-2']);
    expect((await Cart.findOne({ userId: buyer.id }))?.items).toHaveLength(2); // nothing was consumed
    const again = await w.call('post', buyer, '/shop/cart/checkout', {
      fulfillment: 'pickup',
      expected: w.expectedOf(cart),
    });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.orders).toHaveLength(2);
  });

  it('shop orders cannot be re-quoted; cancel and check out again instead', async () => {
    const s = await w.seller();
    const p = await w.live(s, { stock: 5 });
    const buyer = await w.buyer();
    await w.put(buyer, p.id, 1);
    const o = (await w.checkout(buyer, { delivery: true })).body.orders[0];
    expect(o.actions.canRequote).toBe(false);
    const rq = await w.call('post', buyer, `/orders/${o.id}/requote`, {
      quoteId: '1'.repeat(24),
      optionId: 'seller',
      address: {
        recipientName: 'Somsak Jaidee',
        phone: '+66 81 234 5678',
        line1: '1 New Road',
        district: 'Mueang',
        province: 'Chiang Mai',
        postalCode: '50000',
      },
    });
    expect(rq.status).toBe(409);
    expect(rq.body.error.code).toBe('CANNOT_REQUOTE');
  });

  it('the seller processes and ships a shop order like any other; delivery counts the sale and unlocks reviews', async () => {
    const s = await w.seller();
    const p = await w.live(s, { stock: 5 });
    const buyer = await w.buyer();
    await w.put(buyer, p.id, 2);
    const o = (await w.checkout(buyer, { delivery: true })).body.orders[0];
    await w.pay(buyer, o);
    expect((await w.call('post', s.user, `/orders/${o.id}/process`)).status).toBe(200);
    const shipped = await w.call('post', s.user, `/orders/${o.id}/ship`, {
      carrier: 'Own truck',
      trackingNumber: `T-${Date.now()}`,
    });
    expect(shipped.status, JSON.stringify(shipped.body)).toBe(200);
    expect(
      (await w.call('post', buyer, `/orders/${o.id}/confirm-delivery`)).body.order.status,
    ).toBe('DELIVERED');
    expect((await Product.findById(p.id))?.soldCount).toBe(2);
    expect(await stockOf(p.id)).toEqual({ stock: 3, reserved: 0, available: 3 });
  });
});

// ---------------------------------------------------------------------------
describe('reviews', () => {
  const delivered = async (stock = 5) => {
    const s = await w.seller();
    const p = await w.live(s, { stock });
    const buyer = await w.buyer();
    await w.put(buyer, p.id, 1);
    const o = (await w.checkout(buyer)).body.orders[0];
    await w.pay(buyer, o);
    await w.call('post', s.user, `/orders/${o.id}/process`);
    await w.call('post', buyer, `/orders/${o.id}/confirm-delivery`);
    return { s, p, buyer, o };
  };
  const rev = (b: any, id: string, body: object) =>
    w.call('post', b, `/shop/products/${id}/reviews`, body);

  it('only a buyer whose order was delivered can review, once, with a valid rating; the seller cannot review their own product', async () => {
    const { s, p, buyer } = await delivered();
    const stranger = await w.buyer();
    expect((await rev(stranger, p.id, { rating: 5, body: 'Great' })).body.error.code).toBe(
      'NOT_PURCHASED',
    );
    // ordered but not yet delivered
    const pending = await w.buyer();
    await w.put(pending, p.id, 1);
    const po = (await w.checkout(pending)).body.orders[0];
    expect((await rev(pending, p.id, { rating: 5, body: 'Great' })).body.error.code).toBe(
      'NOT_PURCHASED',
    );
    await w.pay(pending, po);
    expect((await rev(pending, p.id, { rating: 5, body: 'Great' })).status).toBe(403);
    expect((await rev(s.user, p.id, { rating: 5, body: 'My own is great' })).body.error.code).toBe(
      'OWN_PRODUCT',
    );
    for (const bad of [
      { rating: 0, body: 'abc' },
      { rating: 6, body: 'abc' },
      { rating: 4.5, body: 'abc' },
      { rating: 4, body: '' },
      { rating: 4, body: 'ok', verified: true },
    ])
      expect((await rev(buyer, p.id, bad)).status, JSON.stringify(bad)).toBe(400);
    const ok = await rev(buyer, p.id, { rating: 4, title: 'Good feed', body: 'Cows liked it.' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.review).toMatchObject({
      rating: 4,
      verifiedPurchase: true,
      mine: true,
      status: 'published',
    });
    expect((await rev(buyer, p.id, { rating: 5, body: 'Again' })).body.error.code).toBe(
      'ALREADY_REVIEWED',
    );
    const list = (await w.call('get', stranger, `/shop/products/${p.id}/reviews`)).body;
    expect(list.items).toHaveLength(1);
    expect(list.items[0].mine).toBe(false);
    expect(list.eligibility).toMatchObject({ eligible: false });
    expect(
      (await w.call('get', buyer, `/shop/products/${p.id}/reviews`)).body.eligibility,
    ).toMatchObject({ reviewed: true });
    expect((await w.call('get', buyer, `/shop/products/${p.id}`)).body.product.rating).toEqual({
      average: 4,
      count: 1,
    });
  });

  it('ratings are averaged; a moderator can hide a review (rating recomputed); owners can delete their own; others cannot', async () => {
    const { p, buyer } = await delivered(10);
    const r1 = (await rev(buyer, p.id, { rating: 5, body: 'Excellent' })).body.review;
    expect((await w.call('get', buyer, `/shop/products/${p.id}`)).body.product.rating).toEqual({
      average: 5,
      count: 1,
    });
    // moderator hides it
    expect(
      (await w.call('post', buyer, `/shop/moderation/reviews/${r1.id}/hide`, { reason: 'Spam' }))
        .status,
    ).toBe(403);
    expect((await w.call('post', w.mod, `/shop/moderation/reviews/${r1.id}/hide`, {})).status).toBe(
      400,
    );
    const hid = await w.call('post', w.mod, `/shop/moderation/reviews/${r1.id}/hide`, {
      reason: 'Contains an abusive remark',
    });
    expect(hid.body.review.status).toBe('hidden');
    expect((await w.call('get', buyer, `/shop/products/${p.id}/reviews`)).body.items).toHaveLength(
      0,
    );
    expect((await w.call('get', buyer, `/shop/products/${p.id}`)).body.product.rating).toEqual({
      average: null,
      count: 0,
    });
    expect(
      (
        await w.call('post', w.mod, `/shop/moderation/reviews/${r1.id}/hide`, {
          reason: 'again again',
        })
      ).status,
    ).toBe(200); // idempotent
    expect((await Product.findById(p.id))?.ratingCount).toBe(0);
    await w.call('post', w.mod, `/shop/moderation/reviews/${r1.id}/restore`, {});
    expect(await Product.findById(p.id)).toMatchObject({ ratingCount: 1, ratingSum: 5 });
    expect(
      (await w.call('delete', await w.buyer(), `/shop/products/${p.id}/reviews/mine`)).status,
    ).toBe(404);
    expect((await w.call('delete', buyer, `/shop/products/${p.id}/reviews/mine`)).status).toBe(204);
    expect(await Product.findById(p.id)).toMatchObject({ ratingCount: 0, ratingSum: 0 });
    // the same buyer can review again after deleting
    expect((await rev(buyer, p.id, { rating: 3, body: 'Second thoughts' })).status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
describe('access control', () => {
  it('every shop route needs a signed-in user; moderation and category routes need their permissions', async () => {
    const s = await w.seller();
    const p = await w.live(s);
    const anon = (m: 'get' | 'post' | 'put' | 'delete', path: string) =>
      request(h.app)[m](`${API}${path}`).send({});
    for (const [m, path] of [
      ['get', '/shop/products'],
      ['get', `/shop/products/${p.id}`],
      ['get', `/shop/products/${p.id}/reviews`],
      ['post', `/shop/products/${p.id}/reviews`],
      ['get', '/shop/cart'],
      ['put', `/shop/cart/items/${p.id}`],
      ['delete', '/shop/cart'],
      ['post', '/shop/cart/checkout'],
      ['get', '/shop/moderation/products'],
      ['post', `/shop/moderation/products/${p.id}/approve`],
      ['post', '/shop/moderation/rescan'],
      ['put', '/shop/admin/categories/feed'],
      ['get', `/farms/${s.farmId}/products`],
    ] as const)
      expect((await anon(m, path)).status, `${m} ${path}`).toBe(401);
    const buyer = await w.buyer();
    for (const [m, path] of [
      ['get', '/shop/moderation/products'],
      ['post', `/shop/moderation/products/${p.id}/suspend`],
      ['post', '/shop/moderation/rescan'],
      ['put', '/shop/admin/categories/feed'],
      ['post', '/shop/admin/categories/feed/sales'],
    ] as const)
      expect(
        (
          await w.call(m as 'get', buyer, path, {
            reason: 'abc',
            name: 'xx',
            enabled: true,
            confirmation: 'ENABLE feed',
          })
        ).status,
        `${m} ${path}`,
      ).toBe(403);
    // finance staff are not product moderators; moderators cannot change categories
    const fin = await createStaff(h.app, ['finance_admin']);
    expect((await w.call('get', fin, '/shop/moderation/products')).status).toBe(403);
    expect(
      (await w.call('put', w.mod, '/shop/admin/categories/feed', { name: 'Feed', reason: 'abc' }))
        .status,
    ).toBe(403);
  });
});
