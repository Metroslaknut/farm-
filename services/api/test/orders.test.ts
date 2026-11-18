/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  SHIPMENT_STATUSES,
  SHIPMENT_TRANSITIONS,
} from '@farmplus/shared-types';
import {
  Animal,
  AuditLog,
  Listing,
  Negotiation,
  Order,
  Payment,
  Refund,
  Role,
  Shipment,
  ShippingQuote,
  UserRole,
} from '../src/models';
import { runMarketplaceCleanup } from '../src/modules/marketplace/cleanup.service';
import { runOrdersCleanup } from '../src/modules/orders/orders.service';
import {
  addFarmMember,
  createStaff,
  createUser,
  login,
  makeFarm,
  mkAnimal,
  register,
  startHarness,
  typeIdOf,
  type Session,
  type Staff,
  type TestHarness,
} from './helpers';
import { payOrder, providerEvent, send, startPayment } from './finance-helpers';
import { ADDRESS, API, call as rawCall, payWebhook, shipWebhook } from './orders-helpers';

let h: TestHarness;
let mod: Staff;
let root: Staff;
let buffalo: string;

beforeAll(async () => {
  h = await startHarness();
  mod = await createStaff(h.app, ['moderator']);
  root = await createStaff(h.app, ['super_admin']);
  buffalo = await typeIdOf(h.app, await createUser(h.app), 'buffalo');
});
afterAll(async () => {
  await h.stop();
});

const call = (m: 'get' | 'post' | 'patch' | 'delete', s: Session, path: string, body?: object) =>
  rawCall(h.app, m, s, path, body);
const get = (s: Session, p: string) => request(h.app).get(`${API}${p}`).set(s.auth);

async function sellerUser(roles = ['farm_owner', 'seller']): Promise<Session> {
  const { id, email } = await register(h.app);
  for (const key of roles)
    await UserRole.create({ userId: id, roleId: (await Role.findOne({ key }))!._id });
  return login(h.app, email);
}

const SHIPPING = {
  mode: 'by_province',
  provinces: [
    { province: 'Bangkok', priceMinor: 250_000 },
    { province: 'Chiang Mai', priceMinor: 400_000 },
  ],
  estimatedDays: { min: 2, max: 4 },
  requirements: ['livestock_vehicle'],
};

interface Deal {
  seller: Session;
  manager: Session;
  buyer: Session;
  farmId: string;
  listingId: string;
  negotiationId: string;
  animalId: string;
}
/** A listing that went through review, an offer at ฿40,000 (asking ฿50,000), and an accepted negotiation: ready for checkout. */
async function deal(
  opts: { delivery?: boolean; shipping?: object | null; price?: number } = {},
): Promise<Deal> {
  const seller = await sellerUser();
  const farmId = await makeFarm(h.app, seller, 'Order Farm');
  const manager = await sellerUser(['seller']);
  await addFarmMember(h.app, seller, farmId, manager, 'manager');
  const animal = await mkAnimal(h.app, seller, farmId, {
    animalTypeId: buffalo,
    sex: 'female',
    breed: 'swamp',
    birthDate: '2022-03-15',
  });
  const delivery = opts.delivery ?? true;
  const created = await call('post', seller, `/farms/${farmId}/listings`, {
    animalId: animal.id,
    title: 'Swamp buffalo cow',
    description: 'Original description',
    askingPriceMinor: 5_000_000,
    photos: [{ url: 'https://cdn.example.test/a.jpg' }],
    deliveryOptions: delivery ? ['pickup', 'delivery'] : ['pickup'],
    ...(delivery ? { shipping: opts.shipping === undefined ? SHIPPING : opts.shipping } : {}),
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const listingId = created.body.listing.id;
  expect((await call('post', seller, `/farms/${farmId}/listings/${listingId}/submit`)).status).toBe(
    200,
  );
  expect(
    (await call('post', mod, `/marketplace/moderation/listings/${listingId}/approve`)).status,
  ).toBe(200);
  const buyer = await createUser(h.app);
  const price = opts.price ?? 4_000_000;
  const neg = (
    await call('post', buyer, `/marketplace/listings/${listingId}/negotiations`, {
      amountMinor: price,
    })
  ).body.negotiation;
  const acc = await call('post', seller, `/marketplace/negotiations/${neg.id}/accept`, {
    expectedSeq: 1,
  });
  expect(acc.status, JSON.stringify(acc.body)).toBe(200);
  return { seller, manager, buyer, farmId, listingId, negotiationId: neg.id, animalId: animal.id };
}

const quote = async (buyer: Session, listingId: string, province = 'Bangkok') => {
  const res = await call('post', buyer, '/shipping/quotes', {
    listingId,
    destination: { province },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.quote as any;
};
async function checkout(d: Deal, over: Record<string, unknown> = {}, expectStatus = 201) {
  const q = await quote(d.buyer, d.listingId);
  const res = await call('post', d.buyer, '/orders', {
    negotiationId: d.negotiationId,
    fulfillment: 'delivery',
    quoteId: q.id,
    optionId: 'seller',
    address: ADDRESS,
    acknowledgeTransport: true,
    ...over,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(expectStatus);
  return res.body.order as any;
}
const pickup = async (d: Deal) => {
  const res = await call('post', d.buyer, '/orders', {
    negotiationId: d.negotiationId,
    fulfillment: 'pickup',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.order as any;
};
const paid = async (d: Deal, order: any) => {
  expect((await payOrder(h, d.buyer, order)).result).toBe('succeeded');
  return (await get(d.buyer, `/orders/${order.id}`)).body.order;
};
const statusOf = async (id: string) => (await Order.findById(id))!.status;

describe('the state machine (explicit transitions)', () => {
  it('permits exactly the documented transitions', () => {
    const edges = Object.entries(ORDER_TRANSITIONS).flatMap(([from, tos]) =>
      Object.keys(tos).map((to) => `${from}>${to}`),
    );
    expect(edges.sort()).toEqual(
      [
        'PENDING_PAYMENT>PAID',
        'PENDING_PAYMENT>CANCELLED',
        'PAID>PROCESSING',
        'PAID>REFUND_PENDING',
        'PROCESSING>SHIPPED',
        'PROCESSING>DELIVERED',
        'PROCESSING>REFUND_PENDING',
        'SHIPPED>DELIVERED',
        'SHIPPED>REFUND_PENDING',
        'REFUND_PENDING>REFUNDED',
      ].sort(),
    );
    for (const terminal of ['DELIVERED', 'CANCELLED', 'REFUNDED'])
      expect(ORDER_TRANSITIONS[terminal as 'DELIVERED']).toEqual({});
    // money moves only through the payment provider
    expect(ORDER_TRANSITIONS.PENDING_PAYMENT.PAID).toEqual(['payment']);
    expect(ORDER_TRANSITIONS.REFUND_PENDING.REFUNDED).toEqual(['payment']);
    expect(new Set(ORDER_STATUSES).size).toBe(8);
  });

  it('no state is a dead end by accident and every state is reachable from PENDING_PAYMENT', () => {
    const seen = new Set(['PENDING_PAYMENT']);
    const queue = ['PENDING_PAYMENT'];
    while (queue.length)
      for (const to of Object.keys(ORDER_TRANSITIONS[queue.shift() as 'PAID']))
        if (!seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
    expect([...seen].sort()).toEqual([...ORDER_STATUSES].sort());
  });

  it('shipment transitions cannot skip states or leave final ones', () => {
    for (const s of ['delivered', 'returned', 'cancelled'] as const)
      expect(SHIPMENT_TRANSITIONS[s]).toEqual([]);
    expect(SHIPMENT_TRANSITIONS.pending).not.toContain('delivered');
    expect(SHIPMENT_TRANSITIONS.failed).toEqual(['in_transit', 'returned']);
    expect(new Set(SHIPMENT_STATUSES).size).toBe(7);
  });

  it('the state machine itself checks WHO may trigger a transition (not only the routes)', async () => {
    const d = await deal();
    const o = await checkout(d);
    const { move } = await import('../src/modules/orders/orders.service');
    const doc = (await Order.findById(o.id))!;
    for (const [to, by] of [
      ['PAID', 'buyer'],
      ['PAID', 'seller'],
      ['PAID', 'system'],
      ['CANCELLED', 'payment'],
      ['CANCELLED', 'shipping'],
      ['PROCESSING', 'seller'],
      ['DELIVERED', 'buyer'],
    ] as const)
      await expect(move(doc, to, by, null), `${to} by ${by}`).rejects.toMatchObject({
        code: 'INVALID_TRANSITION',
      });
    expect(await statusOf(o.id)).toBe('PENDING_PAYMENT');
    await expect(move(doc, 'PAID', 'payment', null)).resolves.toMatchObject({ status: 'PAID' });
  });

  it('API refuses out-of-order actions with 409 INVALID_TRANSITION', async () => {
    const d = await deal();
    const o = await checkout(d);
    for (const [who, path, body] of [
      [d.seller, 'process', {}],
      [d.seller, 'ship', { carrier: 'Own truck' }],
      [d.buyer, 'confirm-delivery', {}],
    ] as const) {
      const r = await call('post', who, `/orders/${o.id}/${path}`, body);
      expect(r.status, path).toBe(409);
      expect(r.body.error.code, path).toBe('INVALID_TRANSITION');
    }
    expect(await statusOf(o.id)).toBe('PENDING_PAYMENT');
  });
});

describe('checkout from an accepted negotiation', () => {
  it('creates a pending order with a frozen snapshot, separate shipping and the right parties', async () => {
    const d = await deal();
    const o = await checkout(d);
    expect(o).toMatchObject({
      status: 'PENDING_PAYMENT',
      currency: 'THB',
      fulfillment: 'delivery',
      buyer: { id: d.buyer.id },
      seller: { id: d.seller.id },
      farmName: 'Order Farm',
      totals: {
        itemsMinor: 4_000_000,
        shippingMinor: 250_000,
        platformFeeMinor: 0,
        grandTotalMinor: 4_250_000,
        sellerPayoutMinor: 4_000_000,
      },
      shipping: {
        label: 'Delivery arranged by the seller',
        source: 'seller_rule',
        isEstimate: true,
        estimatedDays: { min: 2, max: 4 },
        requirements: ['livestock_vehicle'],
      },
      destination: { province: 'Bangkok', postalCode: '10260' },
      viewer: { party: 'buyer' },
    });
    expect(o.orderNo).toMatch(/^FP-\d{6}-[0-9A-F]{8}$/);
    expect(o.items).toHaveLength(1);
    expect(o.items[0]).toMatchObject({
      type: 'animal',
      listingId: d.listingId,
      animalId: d.animalId,
      title: 'Swamp buffalo cow',
      quantity: 1,
      unitPriceMinor: 4_000_000,
      totalMinor: 4_000_000,
      animal: { animalTypeKey: 'buffalo', sex: 'female' },
    });
    expect(o.paymentDueAt).toBeTruthy();
    expect(o.history).toEqual([
      expect.objectContaining({ to: 'PENDING_PAYMENT', by: 'buyer', from: null }),
    ]);
    const doc = (await Order.findById(o.id))!;
    expect(String(doc.buyerId)).toBe(d.buyer.id);
    expect(String(doc.sellerId)).toBe(d.seller.id);
    expect(String(doc.negotiationId)).toBe(d.negotiationId);
    expect((await Listing.findById(d.listingId))?.reservation?.orderId?.toString()).toBe(o.id);
  });

  it('the price comes from the accepted deal, never from the client; the body is strict', async () => {
    const d = await deal();
    const q = await quote(d.buyer, d.listingId);
    for (const extra of [
      { priceMinor: 1 },
      { itemsMinor: 1 },
      { shippingMinor: 1 },
      { totals: { grandTotalMinor: 1 } },
      { status: 'PAID' },
      { buyerId: d.seller.id },
      { sellerId: d.buyer.id },
    ]) {
      const r = await call('post', d.buyer, '/orders', {
        negotiationId: d.negotiationId,
        fulfillment: 'delivery',
        quoteId: q.id,
        optionId: 'seller',
        address: ADDRESS,
        acknowledgeTransport: true,
        ...extra,
      });
      expect(r.status, JSON.stringify(extra)).toBe(400);
    }
    expect(await Order.countDocuments({ negotiationId: d.negotiationId })).toBe(0);
  });

  it('only the buyer of an accepted negotiation can check out', async () => {
    const d = await deal();
    const stranger = await createUser(h.app);
    for (const who of [stranger, d.seller, d.manager])
      expect(
        (
          await call('post', who, '/orders', {
            negotiationId: d.negotiationId,
            fulfillment: 'pickup',
          })
        ).status,
      ).toBe(404);
    expect(
      (
        await call('post', d.buyer, '/orders', {
          negotiationId: 'a'.repeat(24),
          fulfillment: 'pickup',
        })
      ).status,
    ).toBe(404);
    // an open (not accepted) negotiation cannot be checked out
    const s2 = await sellerUser();
    const farm2 = await makeFarm(h.app, s2, 'F2');
    const a2 = await mkAnimal(h.app, s2, farm2, { animalTypeId: buffalo, sex: 'male' });
    const l2 = (
      await call('post', s2, `/farms/${farm2}/listings`, {
        animalId: a2.id,
        title: 'Young bull',
        askingPriceMinor: 3_000_000,
        photos: [{ url: 'https://cdn.example.test/b.jpg' }],
      })
    ).body.listing;
    await call('post', s2, `/farms/${farm2}/listings/${l2.id}/submit`);
    await call('post', mod, `/marketplace/moderation/listings/${l2.id}/approve`);
    const b2 = await createUser(h.app);
    const n2 = (
      await call('post', b2, `/marketplace/listings/${l2.id}/negotiations`, {
        amountMinor: 2_900_000,
      })
    ).body.negotiation;
    const r = await call('post', b2, '/orders', { negotiationId: n2.id, fulfillment: 'pickup' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('NOT_ACCEPTED');
  });

  it('one order per deal — also under parallel checkout', async () => {
    const d = await deal();
    const r = await Promise.all(
      Array.from({ length: 6 }, () =>
        call('post', d.buyer, '/orders', { negotiationId: d.negotiationId, fulfillment: 'pickup' }),
      ),
    );
    expect(r.filter((x) => x.status === 201)).toHaveLength(1);
    expect(
      r.filter((x) => x.status === 409).every((x) => x.body.error.code === 'ORDER_EXISTS'),
    ).toBe(true);
    expect(await Order.countDocuments({ negotiationId: d.negotiationId })).toBe(1);
  });

  it('pickup orders have no address or shipping; delivery orders need both a quote and an address', async () => {
    const d = await deal();
    const q = await quote(d.buyer, d.listingId);
    const base = { negotiationId: d.negotiationId };
    for (const body of [
      { ...base, fulfillment: 'pickup', address: ADDRESS },
      { ...base, fulfillment: 'pickup', quoteId: q.id },
      { ...base, fulfillment: 'delivery' },
      { ...base, fulfillment: 'delivery', quoteId: q.id, optionId: 'seller' },
      { ...base, fulfillment: 'delivery', address: ADDRESS },
      {
        ...base,
        fulfillment: 'delivery',
        quoteId: q.id,
        optionId: 'seller',
        address: { ...ADDRESS, postalCode: '12' },
      },
      {
        ...base,
        fulfillment: 'delivery',
        quoteId: q.id,
        optionId: 'seller',
        address: { ...ADDRESS, phone: 'abc' },
      },
      { ...base, fulfillment: 'courier' },
    ])
      expect((await call('post', d.buyer, '/orders', body)).status, JSON.stringify(body)).toBe(400);
    const p = await pickup(d);
    expect(p).toMatchObject({
      fulfillment: 'pickup',
      totals: { shippingMinor: 0, grandTotalMinor: 4_000_000 },
    });
    expect(p.destination).toBeUndefined();
  });

  it('delivery requires the buyer to acknowledge the animal transport requirements', async () => {
    const d = await deal();
    const q = await quote(d.buyer, d.listingId);
    const r = await call('post', d.buyer, '/orders', {
      negotiationId: d.negotiationId,
      fulfillment: 'delivery',
      quoteId: q.id,
      optionId: 'seller',
      address: ADDRESS,
    });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('acknowledgeTransport');
    expect(await Order.countDocuments({ negotiationId: d.negotiationId })).toBe(0);
    expect((await Listing.findById(d.listingId))?.reservation?.orderId ?? null).toBeNull(); // the failed attempt did not lock the deal
  });

  it('a seller who does not offer delivery gets pickup orders only', async () => {
    const d = await deal({ delivery: false });
    const q = await call('post', d.buyer, '/shipping/quotes', {
      listingId: d.listingId,
      destination: { province: 'Bangkok' },
    });
    expect(q.body.quote.options).toEqual([]);
    expect(q.body.quote.unavailableReason).toMatch(/pickup only/);
    expect(
      (
        await call('post', d.buyer, '/orders', {
          negotiationId: d.negotiationId,
          fulfillment: 'delivery',
          quoteId: q.body.quote.id,
          optionId: 'seller',
          address: ADDRESS,
          acknowledgeTransport: true,
        })
      ).status,
    ).toBe(400);
    expect((await pickup(d)).fulfillment).toBe('pickup');
  });

  it("a platform fee is a separate figure taken from the seller's payout, not added to the buyer's total", async () => {
    await call('patch', root, '/admin/settings', {
      values: { 'orders.platformFeeBps': 500 },
      reason: 'test fee',
    });
    const d = await deal();
    const o = await checkout(d);
    await call('patch', root, '/admin/settings', {
      values: { 'orders.platformFeeBps': 0 },
      reason: 'restore',
    });
    expect(o.totals).toEqual({
      itemsMinor: 4_000_000,
      shippingMinor: 250_000,
      platformFeeMinor: 200_000,
      grandTotalMinor: 4_250_000,
      sellerPayoutMinor: 3_800_000,
    });
  });
});

describe('shipping quotes: nothing is invented', () => {
  it("quotes come from the seller's own terms (flagged as estimates) plus a configured provider's clearly labelled rate", async () => {
    const d = await deal();
    const q = await quote(d.buyer, d.listingId, 'Bangkok');
    expect(q.options.map((o: any) => [o.id, o.source, o.priceMinor, o.isEstimate])).toEqual([
      ['seller', 'seller_rule', 250_000, true],
      ['provider:mock-courier', 'provider', 123_400, true],
    ]);
    expect(q.options[0].estimatedDays).toEqual({ min: 2, max: 4 });
    expect(q.options[1].label).toMatch(/test rate/);
    expect(new Date(q.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // no rate for a province the seller did not configure; the provider may still answer
    const other = await quote(d.buyer, d.listingId, 'Phuket');
    expect(other.options.map((o: any) => o.id)).toEqual(['provider:mock-courier']);
    const none = await quote(d.buyer, d.listingId, 'Nowhere');
    expect(none.options).toEqual([]);
    expect(none.unavailableReason).toMatch(/does not deliver to Nowhere/);
  });

  it('a flat rate without an estimate shows no delivery time at all (no invented estimate)', async () => {
    const d = await deal({ shipping: { mode: 'flat', flatPriceMinor: 99_900, requirements: [] } });
    const q = await quote(d.buyer, d.listingId, 'Chiang Rai');
    const own = q.options.find((o: any) => o.id === 'seller');
    expect(own).toMatchObject({ priceMinor: 99_900, isEstimate: false });
    expect(own.estimatedDays).toBeUndefined();
  });

  it('quotes are validated: province match, expiry, single use, ownership, and current seller terms', async () => {
    const d = await deal();
    const q = await quote(d.buyer, d.listingId, 'Bangkok');
    const body = (over: object = {}) => ({
      negotiationId: d.negotiationId,
      fulfillment: 'delivery',
      quoteId: q.id,
      optionId: 'seller',
      address: ADDRESS,
      acknowledgeTransport: true,
      ...over,
    });
    // another province than quoted
    expect(
      (
        await call(
          'post',
          d.buyer,
          '/orders',
          body({ address: { ...ADDRESS, province: 'Chiang Mai' } }),
        )
      ).body.error.code,
    ).toBe('QUOTE_STALE');
    // unknown option
    expect((await call('post', d.buyer, '/orders', body({ optionId: 'nope' }))).status).toBe(400);
    // someone else's quote
    const thief = await createUser(h.app);
    expect((await call('post', thief, '/orders', body())).status).toBe(404);
    // expired
    await ShippingQuote.updateOne(
      { _id: q.id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    expect((await call('post', d.buyer, '/orders', body())).body.error.code).toBe('QUOTE_STALE');
    // fresh quote works once, then it is used up
    const q2 = await quote(d.buyer, d.listingId);
    const ok = await call('post', d.buyer, '/orders', body({ quoteId: q2.id }));
    expect(ok.status).toBe(201);
    expect((await ShippingQuote.findById(q2.id))?.usedByOrderId?.toString()).toBe(ok.body.order.id);
  });

  it('the quote is stale when the seller changed the delivery terms after it was issued', async () => {
    const d = await deal();
    const q = await quote(d.buyer, d.listingId);
    await Listing.updateOne(
      { _id: d.listingId },
      { $set: { 'shipping.provinces.0.priceMinor': 900_000 } },
    );
    const r = await call('post', d.buyer, '/orders', {
      negotiationId: d.negotiationId,
      fulfillment: 'delivery',
      quoteId: q.id,
      optionId: 'seller',
      address: ADDRESS,
      acknowledgeTransport: true,
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('QUOTE_STALE');
    const fresh = await quote(d.buyer, d.listingId);
    expect(fresh.options[0].priceMinor).toBe(900_000);
  });

  it('sellers cannot quote their own listing; unknown/inactive listings are 404; bad destinations are 400', async () => {
    const d = await deal();
    expect(
      (
        await call('post', d.seller, '/shipping/quotes', {
          listingId: d.listingId,
          destination: { province: 'Bangkok' },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call('post', await createUser(h.app), '/shipping/quotes', {
          listingId: d.listingId,
          destination: { province: 'Bangkok' },
        })
      ).status,
    ).toBe(404); // reserved for another buyer
    expect(
      (
        await call('post', d.buyer, '/shipping/quotes', {
          listingId: 'a'.repeat(24),
          destination: { province: 'Bangkok' },
        })
      ).status,
    ).toBe(404);
    for (const destination of [
      {},
      { province: '' },
      { province: 'Bangkok', postalCode: 'ABCDE' },
      { province: 'Bangkok', extra: 1 },
    ])
      expect(
        (await call('post', d.buyer, '/shipping/quotes', { listingId: d.listingId, destination }))
          .status,
      ).toBe(400);
    expect((await request(h.app).post(`${API}/shipping/quotes`).send({})).status).toBe(401);
  });

  it('listing shipping terms are validated; delivery cannot be offered without them', async () => {
    const s = await sellerUser();
    const farmId = await makeFarm(h.app, s, 'Ship Farm');
    const a = await mkAnimal(h.app, s, farmId, { animalTypeId: buffalo, sex: 'male' });
    const base = {
      animalId: a.id,
      title: 'Bull for delivery',
      askingPriceMinor: 1_000_000,
      photos: [{ url: 'https://cdn.example.test/x.jpg' }],
      deliveryOptions: ['delivery'],
    };
    for (const shipping of [
      { mode: 'flat', requirements: [] },
      { mode: 'by_province', provinces: [], requirements: [] },
      {
        mode: 'by_province',
        provinces: [
          { province: 'Bangkok', priceMinor: 1 },
          { province: 'bangkok', priceMinor: 2 },
        ],
        requirements: [],
      },
      { mode: 'flat', flatPriceMinor: 10.5, requirements: [] },
      { mode: 'flat', flatPriceMinor: -1, requirements: [] },
      { mode: 'flat', flatPriceMinor: 100, estimatedDays: { min: 5, max: 2 }, requirements: [] },
      { mode: 'flat', flatPriceMinor: 100, requirements: ['teleport'] },
      { mode: 'flat', flatPriceMinor: 100, requirements: [], carrierRate: 1 },
    ])
      expect(
        (await call('post', s, `/farms/${farmId}/listings`, { ...base, shipping })).status,
        JSON.stringify(shipping),
      ).toBe(400);
    const created = (await call('post', s, `/farms/${farmId}/listings`, base)).body.listing;
    const sub = await call('post', s, `/farms/${farmId}/listings/${created.id}/submit`);
    expect(sub.status).toBe(400); // delivery offered without terms
    expect(JSON.stringify(sub.body)).toContain('shipping');
  });
});

describe('personal data and access', () => {
  it('the street address is encrypted at rest and never appears in list rows or to other users', async () => {
    const d = await deal();
    const o = await checkout(d);
    const raw = JSON.stringify(
      (await Order.collection.findOne({ _id: new Types.ObjectId(o.id) }))!,
    );
    for (const secret of ['Secret Street', 'Somsak', '81 234 5678', 'Call at the gate'])
      expect(raw).not.toContain(secret);
    expect((await Order.findById(o.id))?.addressEnc).toMatch(/^[A-Za-z0-9+/=]{40,}$/);
    const own = (await get(d.buyer, `/orders/${o.id}`)).body.order;
    expect(own.address).toMatchObject({
      recipientName: 'Somsak Jaidee',
      line1: '99/9 Moo 3 Secret Street',
      phone: '+66 81 234 5678',
    });
    const list = (await get(d.buyer, '/orders')).body.items.find((i: any) => i.id === o.id);
    expect(list.address).toBeUndefined();
    expect(JSON.stringify(list)).not.toContain('Secret Street');
    expect((await get(d.buyer, `/orders/${o.id}`)).headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(await AuditLog.find({ targetId: o.id }))).not.toContain('Secret Street');
  });

  it('the seller side sees only the region until the order is paid, and every look at the address is audited', async () => {
    const d = await deal();
    const o = await checkout(d);
    const before = (await get(d.seller, `/orders/${o.id}`)).body.order;
    expect(before.address).toBeUndefined();
    expect(before.destination).toMatchObject({ province: 'Bangkok' });
    await paid(d, o);
    const after = (await get(d.manager, `/orders/${o.id}`)).body.order;
    expect(after.address.line1).toBe('99/9 Moo 3 Secret Street');
    expect(
      await AuditLog.countDocuments({
        action: 'order.address_viewed',
        targetId: o.id,
        actorId: d.manager.id,
      }),
    ).toBe(1);
  });

  it("only the buyer and the farm's owners/managers can read or act on an order — everyone else gets 404", async () => {
    const d = await deal();
    const o = await checkout(d);
    const stranger = await createUser(h.app);
    const worker = await createUser(h.app);
    await addFarmMember(h.app, d.seller, d.farmId, worker, 'worker');
    const otherSeller = await sellerUser();
    const asMod = mod as unknown as Session;
    for (const who of [stranger, worker, otherSeller, asMod]) {
      expect((await get(who, `/orders/${o.id}`)).status).toBe(404);
      for (const [path, body] of [
        ['cancel', { reason: 'abc' }],
        ['process', {}],
        ['confirm-delivery', {}],
        ['ship', { carrier: 'X Y' }],
        ['requote', { quoteId: 'a'.repeat(24), optionId: 'seller', address: ADDRESS }],
      ] as const)
        expect((await call('post', who, `/orders/${o.id}/${path}`, body)).status, `${path}`).toBe(
          404,
        );
      expect((await get(who, '/orders')).body.items.map((i: any) => i.id)).not.toContain(o.id);
    }
    expect((await get(d.buyer, '/orders')).body.items.map((i: any) => i.id)).toContain(o.id);
    expect(
      (await get(d.seller, `/farms/${d.farmId}/orders`)).body.items.map((i: any) => i.id),
    ).toEqual([o.id]);
    expect((await get(d.manager, `/farms/${d.farmId}/orders`)).status).toBe(200);
    for (const who of [stranger, worker, d.buyer, otherSeller])
      expect((await get(who, `/farms/${d.farmId}/orders`)).status).toBe(404);
    expect((await get(d.buyer, '/orders/not-an-id')).status).toBe(404);
    expect((await request(h.app).get(`${API}/orders/${o.id}`)).status).toBe(401);
    expect((await get(d.seller, `/farms/${d.farmId}/orders?status=BOGUS`)).status).toBe(400);
  });

  it('role-limited actions: the buyer cannot process or ship; the seller cannot confirm delivery or re-quote', async () => {
    const d = await deal();
    const o = await checkout(d);
    await paid(d, o);
    expect((await call('post', d.buyer, `/orders/${o.id}/process`)).status).toBe(404);
    expect((await call('post', d.seller, `/orders/${o.id}/confirm-delivery`)).status).toBe(404);
    expect(
      (
        await call('post', d.seller, `/orders/${o.id}/requote`, {
          quoteId: 'a'.repeat(24),
          optionId: 'seller',
          address: ADDRESS,
        })
      ).status,
    ).toBe(404);
    expect(await statusOf(o.id)).toBe('PAID');
  });
});

describe('payment callbacks (signature and order effect; the finance rules live in finance.test.ts)', () => {
  it('are disabled (404) when no secret is configured', async () => {
    const { createApp } = await import('../src/app');
    const app = createApp(
      { ...h.env, PAYMENT_WEBHOOK_SECRET: undefined, SHIPPING_WEBHOOK_SECRET: undefined },
      { video: h.video },
    );
    expect((await payWebhook(app, { type: 'charge.succeeded' })).status).toBe(404);
    expect((await shipWebhook(app, { type: 'shipment.status' })).status).toBe(404);
  });

  it('reject unsigned, wrongly signed, tampered, replayed and user-token requests without changing anything', async () => {
    const d = await deal();
    const o = await checkout(d);
    const ev = providerEvent('charge.succeeded', 'chg_whatever', o.totals.grandTotalMinor);
    expect((await payWebhook(h.app, ev, { header: null })).status).toBe(401);
    expect((await payWebhook(h.app, ev, {}, 'a-different-secret-entirely')).status).toBe(401);
    expect((await payWebhook(h.app, ev, { tamper: true })).status).toBe(401);
    expect(
      (await payWebhook(h.app, ev, { time: Math.floor(Date.now() / 1000) - 3600 })).status,
    ).toBe(401);
    expect((await payWebhook(h.app, ev, { header: 'garbage' })).status).toBe(401);
    expect(
      (await request(h.app).post(`${API}/webhooks/payments`).set(d.buyer.auth).send(ev)).status,
    ).toBe(401);
    expect(await statusOf(o.id)).toBe('PENDING_PAYMENT');
    expect(await AuditLog.countDocuments({ action: 'webhook.rejected' })).toBeGreaterThan(0);
  });

  it('a captured payment of the exact total marks the order PAID once (duplicates are harmless)', async () => {
    const d = await deal();
    const o = await checkout(d);
    const first = await payOrder(h, d.buyer, o);
    expect(first.result).toBe('succeeded');
    const again = await payWebhook(
      h.app,
      providerEvent(
        'charge.succeeded',
        (await Order.findById(o.id))!.paymentRef!,
        o.totals.grandTotalMinor,
      ),
    );
    expect(again.body.result).toBe('duplicate');
    const doc = (await Order.findById(o.id))!;
    expect(doc.status).toBe('PAID');
    expect(doc.paymentRef).toBeTruthy();
    expect(doc.paidAt).toBeTruthy();
    expect(doc.history.map((x) => x.to)).toEqual(['PENDING_PAYMENT', 'PAID']);
    expect(doc.history[1]).toMatchObject({ by: 'payment' });
  });
});

describe('fulfilment: delivery', () => {
  it('PAID → PROCESSING → SHIPPED → carrier delivered → buyer confirms → DELIVERED, and the sale completes', async () => {
    const d = await deal();
    const o = await checkout(d);
    await paid(d, o);
    expect((await call('post', d.seller, `/orders/${o.id}/process`)).body.order.status).toBe(
      'PROCESSING',
    );
    const shipRes = await call('post', d.manager, `/orders/${o.id}/ship`, {
      carrier: 'Livestock Express',
      trackingNumber: 'LE-12345-TH',
      expectedDays: { min: 2, max: 3 },
    });
    expect(shipRes.status, JSON.stringify(shipRes.body)).toBe(200);
    const shipped = shipRes.body.order;
    expect(shipped.status).toBe('SHIPPED');
    expect(shipped.shipments[0]).toMatchObject({
      attempt: 1,
      status: 'in_transit',
      carrier: 'Livestock Express',
      trackingNumber: 'LE-12345-TH',
      isEstimate: true,
      expectedDays: { min: 2, max: 3 },
    });
    // carrier callbacks
    expect(
      (
        await shipWebhook(h.app, {
          type: 'shipment.status',
          carrier: 'Livestock Express',
          trackingNumber: 'LE-12345-TH',
          status: 'out_for_delivery',
          location: 'Bangkok hub',
        })
      ).body.result,
    ).toBe('applied');
    expect(
      (
        await shipWebhook(h.app, {
          type: 'shipment.status',
          carrier: 'Livestock Express',
          trackingNumber: 'LE-12345-TH',
          status: 'delivered',
        })
      ).body.result,
    ).toBe('applied');
    const mid = (await get(d.buyer, `/orders/${o.id}`)).body.order;
    expect(mid.status).toBe('SHIPPED'); // the buyer still has to confirm
    expect(mid.deliveredAt).toBeTruthy();
    expect(mid.shipments[0].events.map((e: any) => [e.status, e.source])).toEqual([
      ['in_transit', 'seller'],
      ['out_for_delivery', 'provider'],
      ['delivered', 'provider'],
    ]);
    const done = await call('post', d.buyer, `/orders/${o.id}/confirm-delivery`);
    expect(done.body.order.status).toBe('DELIVERED');
    expect((await Listing.findById(d.listingId))?.status).toBe('SOLD');
    expect((await Animal.findById(d.animalId))?.currentStatus).toBe('sold');
    expect((await Negotiation.findById(d.negotiationId))?.status).toBe('completed');
    expect(done.body.order.history.map((x: any) => x.to)).toEqual([
      'PENDING_PAYMENT',
      'PAID',
      'PROCESSING',
      'SHIPPED',
      'DELIVERED',
    ]);
    expect((await call('post', d.buyer, `/orders/${o.id}/confirm-delivery`)).status).toBe(409);
    expect(
      (await call('post', d.buyer, `/orders/${o.id}/cancel`, { reason: 'too late' })).body.error
        .code,
    ).toBe('CANCEL_NOT_ALLOWED');
  });

  it('shipment status transitions are validated; duplicate and stale callbacks are harmless', async () => {
    const d = await deal();
    const o = await checkout(d);
    await paid(d, o);
    await call('post', d.seller, `/orders/${o.id}/process`);
    const s = (
      await call('post', d.seller, `/orders/${o.id}/ship`, {
        carrier: 'Own truck',
        trackingNumber: 'OWN-0001',
      })
    ).body.order.shipments[0];
    const ev = (status: string) =>
      call('post', d.seller, `/orders/${o.id}/shipments/${s.id}/events`, { status });
    expect((await ev('pending')).body.error.code).toBe('INVALID_SHIPMENT_TRANSITION');
    expect((await ev('cancelled')).status).toBe(409);
    expect((await ev('bogus')).status).toBe(400);
    expect((await ev('out_for_delivery')).status).toBe(200);
    expect((await ev('out_for_delivery')).status).toBe(200); // repeat = no-op
    const cb = (status: string) =>
      shipWebhook(h.app, {
        type: 'shipment.status',
        carrier: 'Own truck',
        trackingNumber: 'OWN-0001',
        status,
      });
    expect((await cb('in_transit')).body.result).toBe('ignored'); // late, out-of-order
    expect((await cb('delivered')).body.result).toBe('applied');
    expect((await ev('in_transit')).status).toBe(409); // delivered is final
    const events = (await Shipment.findById(s.id))!.events.map((e) => e.status);
    expect(events).toEqual(['in_transit', 'out_for_delivery', 'delivered']);
    expect(
      (
        await shipWebhook(h.app, {
          type: 'shipment.status',
          carrier: 'Nobody',
          trackingNumber: 'XXXX-1',
          status: 'delivered',
        })
      ).body.result,
    ).toBe('unknown_shipment');
  });

  it('carrier callbacks are authenticated', async () => {
    const d = await deal();
    const o = await checkout(d);
    await paid(d, o);
    await call('post', d.seller, `/orders/${o.id}/process`);
    await call('post', d.seller, `/orders/${o.id}/ship`, {
      carrier: 'Livestock Express',
      trackingNumber: 'LE-9999-TH',
    });
    const ev = {
      type: 'shipment.status',
      carrier: 'Livestock Express',
      trackingNumber: 'LE-9999-TH',
      status: 'delivered',
    };
    expect((await shipWebhook(h.app, ev, { header: null })).status).toBe(401);
    expect((await shipWebhook(h.app, ev, {}, 'a-different-secret-entirely')).status).toBe(401);
    expect((await shipWebhook(h.app, ev, { time: 1 })).status).toBe(401);
    expect((await shipWebhook(h.app, ev, {}, 'test-payment-secret-1234567890')).status).toBe(401); // the payment secret is not the shipping secret
    expect(
      (await request(h.app).post(`${API}/webhooks/shipping`).set(d.buyer.auth).send(ev)).status,
    ).toBe(401);
    expect(await statusOf(o.id)).toBe('SHIPPED');
    expect((await Shipment.findOne({ trackingNumber: 'LE-9999-TH' }))?.status).toBe('in_transit');
  });

  it('shipping details are validated; a tracking number can be used once; pickup orders cannot be shipped', async () => {
    const d = await deal();
    const o = await checkout(d);
    await paid(d, o);
    await call('post', d.seller, `/orders/${o.id}/process`);
    for (const body of [
      {},
      { carrier: 'X' },
      { carrier: 'Own truck', trackingNumber: 'no spaces allowed' },
      { carrier: 'Own truck', expectedDays: { min: 5, max: 1 } },
      { carrier: 'Own truck', status: 'delivered' },
    ])
      expect(
        (await call('post', d.seller, `/orders/${o.id}/ship`, body)).status,
        JSON.stringify(body),
      ).toBe(400);
    expect(
      (
        await call('post', d.seller, `/orders/${o.id}/ship`, {
          carrier: 'Own truck',
          trackingNumber: 'DUP-0001',
        })
      ).status,
    ).toBe(200);
    const d2 = await deal();
    const o2 = await checkout(d2);
    await paid(d2, o2);
    await call('post', d2.seller, `/orders/${o2.id}/process`);
    expect(
      (
        await call('post', d2.seller, `/orders/${o2.id}/ship`, {
          carrier: 'Own truck',
          trackingNumber: 'DUP-0001',
        })
      ).body.error.code,
    ).toBe('SHIPMENT_EXISTS');
    expect(await statusOf(o2.id)).toBe('PROCESSING');
    const d3 = await deal();
    const p = await pickup(d3);
    await paid(d3, p);
    await call('post', d3.seller, `/orders/${p.id}/process`);
    expect(
      (await call('post', d3.seller, `/orders/${p.id}/ship`, { carrier: 'Own truck' })).body.error
        .code,
    ).toBe('PICKUP_ORDER');
  });

  it('a delivered shipment the buyer does not confirm completes automatically after the grace period', async () => {
    const d = await deal();
    const o = await checkout(d);
    await paid(d, o);
    await call('post', d.seller, `/orders/${o.id}/process`);
    await call('post', d.seller, `/orders/${o.id}/ship`, {
      carrier: 'Own truck',
      trackingNumber: 'AUTO-0001',
    });
    await shipWebhook(h.app, {
      type: 'shipment.status',
      carrier: 'Own truck',
      trackingNumber: 'AUTO-0001',
      status: 'delivered',
    });
    expect((await runOrdersCleanup()).autoConfirmed).toBe(0); // not yet
    const doc = (await Order.findById(o.id))!;
    expect(doc.autoConfirmAt!.getTime()).toBeGreaterThan(Date.now() + 2 * 86_400_000);
    const r = await runOrdersCleanup(new Date(Date.now() + 4 * 86_400_000));
    expect(r.autoConfirmed).toBeGreaterThanOrEqual(1);
    const after = (await Order.findById(o.id))!;
    expect(after.status).toBe('DELIVERED');
    expect(after.history.at(-1)).toMatchObject({ to: 'DELIVERED', by: 'system' });
    expect((await Listing.findById(d.listingId))?.status).toBe('SOLD');
    expect((await runOrdersCleanup(new Date(Date.now() + 5 * 86_400_000))).autoConfirmed).toBe(0);
  });
});

describe('fulfilment: pickup', () => {
  it('PAID → PROCESSING → buyer confirms receipt → DELIVERED (no shipment, no auto-confirm)', async () => {
    const d = await deal();
    const o = await pickup(d);
    await paid(d, o);
    expect((await call('post', d.buyer, `/orders/${o.id}/confirm-delivery`)).status).toBe(409); // not processing yet
    await call('post', d.seller, `/orders/${o.id}/process`);
    const done = await call('post', d.buyer, `/orders/${o.id}/confirm-delivery`);
    expect(done.body.order.status).toBe('DELIVERED');
    expect(done.body.order.shipments).toEqual([]);
    expect((await Listing.findById(d.listingId))?.status).toBe('SOLD');
  });
});

describe('failed, returned and refunded shipments', () => {
  const inTransit = async () => {
    const d = await deal();
    const o = await checkout(d);
    await paid(d, o);
    await call('post', d.seller, `/orders/${o.id}/process`);
    const sh = (
      await call('post', d.seller, `/orders/${o.id}/ship`, {
        carrier: 'Own truck',
        trackingNumber: `T-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      })
    ).body.order.shipments[0];
    return { d, o, sh };
  };
  const cb = (sh: any, status: string) =>
    shipWebhook(h.app, {
      type: 'shipment.status',
      carrier: sh.carrier,
      trackingNumber: sh.trackingNumber,
      status,
    });

  it('a failed delivery lets the seller cancel (refund) — but the buyer cannot — and a retry may still succeed', async () => {
    const { d, o, sh } = await inTransit();
    expect((await cb(sh, 'failed')).body.result).toBe('applied');
    expect(await statusOf(o.id)).toBe('SHIPPED');
    expect(
      (await call('post', d.buyer, `/orders/${o.id}/cancel`, { reason: 'where is it' })).body.error
        .code,
    ).toBe('CANCEL_NOT_ALLOWED');
    expect((await cb(sh, 'in_transit')).body.result).toBe('applied'); // carrier retries
    expect((await cb(sh, 'failed')).body.result).toBe('applied');
    const c = await call('post', d.seller, `/orders/${o.id}/cancel`, {
      reason: 'Delivery failed twice',
    });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body.order.status).toBe('REFUND_PENDING');
    expect((await Order.findById(o.id))?.refund).toMatchObject({
      amountMinor: 4_250_000,
      reason: 'Delivery failed twice',
    });
    expect((await Listing.findById(d.listingId))?.status).toBe('ACTIVE'); // the animal is back on sale
    expect((await Negotiation.findById(d.negotiationId))?.status).toBe('cancelled');
  });

  it('a returned shipment moves the order to REFUND_PENDING by itself; the refund callback completes it', async () => {
    const { d, o, sh } = await inTransit();
    await cb(sh, 'failed');
    expect((await cb(sh, 'returned')).body.result).toBe('applied');
    const doc = (await Order.findById(o.id))!;
    expect(doc.status).toBe('REFUND_PENDING');
    expect(doc.history.at(-1)).toMatchObject({ by: 'shipping', reason: 'shipment_returned' });
    expect((await Listing.findById(d.listingId))?.status).toBe('ACTIVE');
    // a refund is queued for finance to approve; the money side is covered in finance.test.ts
    const queued = await Refund.findOne({ orderId: o.id });
    expect(queued).toMatchObject({
      status: 'requested',
      amountMinor: 4_250_000,
      reason: 'shipment_returned',
    });
    expect(
      (await call('post', d.buyer, `/orders/${o.id}/cancel`, { reason: 'again' })).status,
    ).toBe(409);
  });

  it('a refund callback for an order with no refund pending changes nothing', async () => {
    const d = await deal();
    const o = await checkout(d);
    await paid(d, o);
    const r = await payWebhook(
      h.app,
      providerEvent('refund.succeeded', 'rfd_unknown', o.totals.grandTotalMinor),
    );
    expect(r.body.result).toBe('unknown_reference');
    expect(await statusOf(o.id)).toBe('PAID');
  });
});

describe('cancellation rules', () => {
  it('unpaid: buyer or seller can cancel; the animal and deal are released', async () => {
    for (const who of ['buyer', 'seller'] as const) {
      const d = await deal();
      const o = await checkout(d);
      const r = await call('post', d[who], `/orders/${o.id}/cancel`, {
        reason: 'No longer needed',
      });
      expect(r.body.order).toMatchObject({ status: 'CANCELLED', cancelReason: 'No longer needed' });
      expect(r.body.order.history.at(-1)).toMatchObject({ to: 'CANCELLED', by: who });
      expect(await Listing.findById(d.listingId)).toMatchObject({ status: 'ACTIVE' });
      expect((await Listing.findById(d.listingId))?.reservation ?? null).toBeNull();
      expect((await Negotiation.findById(d.negotiationId))?.status).toBe('cancelled');
      expect(
        (await call('post', d.buyer, `/orders/${o.id}/cancel`, { reason: 'twice' })).status,
      ).toBe(409);
    }
  });

  it('a reason is required (3+ characters) for every cancellation', async () => {
    const d = await deal();
    const o = await checkout(d);
    for (const body of [
      {},
      { reason: '' },
      { reason: 'ab' },
      { reason: 'x'.repeat(301) },
      { reason: 'ok reason', refund: true },
    ])
      expect(
        (await call('post', d.buyer, `/orders/${o.id}/cancel`, body)).status,
        JSON.stringify(body),
      ).toBe(400);
    expect(await statusOf(o.id)).toBe('PENDING_PAYMENT');
  });

  it('paid or processing: either party can cancel — it goes through REFUND_PENDING, never straight to CANCELLED', async () => {
    for (const [who, processed] of [
      ['buyer', false],
      ['seller', false],
      ['buyer', true],
      ['seller', true],
    ] as const) {
      const d = await deal();
      const o = await checkout(d);
      await paid(d, o);
      if (processed) await call('post', d.seller, `/orders/${o.id}/process`);
      const r = await call('post', d[who], `/orders/${o.id}/cancel`, {
        reason: 'Cancelling after payment',
      });
      expect(r.body.order.status, `${who}/${processed}`).toBe('REFUND_PENDING');
      expect((await Order.findById(o.id))?.refund).toMatchObject({
        amountMinor: o.totals.grandTotalMinor,
      });
      expect((await Listing.findById(d.listingId))?.status).toBe('ACTIVE');
    }
  });

  it('shipped and delivered orders cannot be cancelled by the buyer; the seller cannot cancel a shipment that is still on its way', async () => {
    const d = await deal();
    const o = await checkout(d);
    await paid(d, o);
    await call('post', d.seller, `/orders/${o.id}/process`);
    await call('post', d.seller, `/orders/${o.id}/ship`, {
      carrier: 'Own truck',
      trackingNumber: 'CAN-0001',
    });
    for (const who of [d.buyer, d.seller])
      expect(
        (await call('post', who, `/orders/${o.id}/cancel`, { reason: 'on its way' })).body.error
          .code,
      ).toBe('CANCEL_NOT_ALLOWED');
    expect(await statusOf(o.id)).toBe('SHIPPED');
  });

  it('unpaid orders expire after the payment window: cancelled by the system, animal released, idempotent', async () => {
    const d = await deal();
    const o = await checkout(d);
    const paidOne = await deal();
    const o2 = await checkout(paidOne);
    await paid(paidOne, o2);
    await Order.updateOne({ _id: o.id }, { $set: { paymentDueAt: new Date(Date.now() - 1000) } });
    const r = await runOrdersCleanup();
    expect(r.unpaidCancelled).toBeGreaterThanOrEqual(1);
    const doc = (await Order.findById(o.id))!;
    expect(doc.status).toBe('CANCELLED');
    expect(doc.history.at(-1)).toMatchObject({
      to: 'CANCELLED',
      by: 'system',
      reason: 'payment_window_expired',
    });
    expect((await Listing.findById(d.listingId))?.status).toBe('ACTIVE');
    expect(await statusOf(o2.id)).toBe('PAID'); // paid orders are never touched
    expect((await runOrdersCleanup()).unpaidCancelled).toBe(0);
    // an expired order can no longer be paid at all
    expect((await startPayment(h.app, d.buyer, o.id)).status).toBe(409);
  });
});

describe('re-quoting before payment', () => {
  it('moving the destination recalculates shipping and the total; the old total no longer matches', async () => {
    const d = await deal();
    const o = await checkout(d);
    const oldTry = (await startPayment(h.app, d.buyer, o.id)).body.payment; // opened for the OLD total
    const q = await quote(d.buyer, d.listingId, 'Chiang Mai');
    const body = {
      quoteId: q.id,
      optionId: 'seller',
      address: {
        ...ADDRESS,
        province: 'Chiang Mai',
        district: 'Mueang',
        postalCode: '50000',
        line1: '1 New Road',
      },
      acknowledgeTransport: true,
    };
    const r = await call('post', d.buyer, `/orders/${o.id}/requote`, body);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.order.totals).toMatchObject({
      itemsMinor: 4_000_000,
      shippingMinor: 400_000,
      grandTotalMinor: 4_400_000,
    });
    expect(r.body.order.destination.province).toBe('Chiang Mai');
    expect(r.body.order.address.line1).toBe('1 New Road');
    expect((await Order.findById(o.id))?.totalVersion).toBe(2);
    // the quote is single-use
    expect((await call('post', d.buyer, `/orders/${o.id}/requote`, body)).body.error.code).toBe(
      'QUOTE_STALE',
    );
    // a payment for the OLD total is refused; the new total is accepted
    expect((await Payment.findById(oldTry.id))?.status).toBe('cancelled'); // the old attempt was abandoned
    const late = h.payments!.settleCharge(oldTry.providerRef, 'succeeded');
    expect(
      (await send(h.app, providerEvent('charge.succeeded', late.ref, late.amountMinor))).body
        .result,
    ).toBe('unapplied');
    expect(await statusOf(o.id)).toBe('PENDING_PAYMENT'); // the stale money did not pay the new total
    const fresh = await payOrder(h, d.buyer, { id: o.id, totals: { grandTotalMinor: 4_400_000 } });
    expect(fresh.result).toBe('succeeded');
    expect(await statusOf(o.id)).toBe('PAID');
    // after payment the shipping can no longer change
    const q2 = await quote(d.buyer, d.listingId).catch(() => null);
    void q2;
    expect(
      (
        await call('post', d.buyer, `/orders/${o.id}/requote`, {
          ...body,
          quoteId: new Types.ObjectId().toString(),
        })
      ).status,
    ).toBe(409);
  });

  it('is refused for pickup orders and requires a valid quote for the new province', async () => {
    const d = await deal();
    const p = await pickup(d);
    expect(
      (
        await call('post', d.buyer, `/orders/${p.id}/requote`, {
          quoteId: 'a'.repeat(24),
          optionId: 'seller',
          address: ADDRESS,
        })
      ).body.error.code,
    ).toBe('CANNOT_REQUOTE');
    const d2 = await deal();
    const o = await checkout(d2);
    const q = await quote(d2.buyer, d2.listingId, 'Bangkok');
    const r = await call('post', d2.buyer, `/orders/${o.id}/requote`, {
      quoteId: q.id,
      optionId: 'seller',
      address: { ...ADDRESS, province: 'Chiang Mai' },
      acknowledgeTransport: true,
    });
    expect(r.body.error.code).toBe('QUOTE_STALE');
    expect((await Order.findById(o.id))?.totalVersion).toBe(1);
  });
});

describe('integration with the marketplace', () => {
  it('while an order exists the seller cannot mark the animal sold or cancel the reservation, and the reservation timer never releases it', async () => {
    const d = await deal();
    const o = await checkout(d);
    const r1 = await call('post', d.seller, `/farms/${d.farmId}/listings/${d.listingId}/sold`);
    expect(r1.status).toBe(409);
    expect(r1.body.error.code).toBe('ORDER_EXISTS');
    const r2 = await call(
      'post',
      d.buyer,
      `/marketplace/negotiations/${d.negotiationId}/cancel-reservation`,
      {},
    );
    expect(r2.body.error.code).toBe('ORDER_EXISTS');
    await Listing.updateOne(
      { _id: d.listingId },
      { $set: { 'reservation.expiresAt': new Date(Date.now() - 1000) } },
    );
    await runMarketplaceCleanup();
    expect((await Listing.findById(d.listingId))?.status).toBe('RESERVED');
    expect((await get(d.buyer, `/orders/${o.id}`)).body.order.status).toBe('PENDING_PAYMENT');
    expect(
      (await call('post', d.seller, `/farms/${d.farmId}/listings/${d.listingId}/cancel`)).body.error
        .code,
    ).toBe('RESERVED');
  });

  it('the listing shows the order id to the two parties only', async () => {
    const d = await deal();
    const o = await checkout(d);
    expect(
      (await get(d.buyer, `/marketplace/listings/${d.listingId}`)).body.listing.reservation.orderId,
    ).toBe(o.id);
    expect(
      (await get(await createUser(h.app), `/marketplace/listings/${d.listingId}`)).body.listing
        .reservation,
    ).toBeUndefined();
  });

  it('after a cancelled order the animal can be sold to someone else, with a fresh order', async () => {
    const d = await deal();
    const o = await checkout(d);
    await call('post', d.buyer, `/orders/${o.id}/cancel`, { reason: 'Changed my mind' });
    const buyer2 = await createUser(h.app);
    const neg = (
      await call('post', buyer2, `/marketplace/listings/${d.listingId}/negotiations`, {
        amountMinor: 4_500_000,
      })
    ).body.negotiation;
    expect(
      (
        await call('post', d.seller, `/marketplace/negotiations/${neg.id}/accept`, {
          expectedSeq: 1,
        })
      ).status,
    ).toBe(200);
    const res = await call('post', buyer2, '/orders', {
      negotiationId: neg.id,
      fulfillment: 'pickup',
    });
    expect(res.status).toBe(201);
    expect(res.body.order.totals.itemsMinor).toBe(4_500_000);
  });
});

describe('price snapshots stay stable after checkout', () => {
  it('later edits to the listing or the animal never change an existing order', async () => {
    const d = await deal();
    const o = await checkout(d);
    await Listing.updateOne(
      { _id: d.listingId },
      {
        $set: {
          title: 'COMPLETELY DIFFERENT',
          askingPriceMinor: 9_999_999,
          description: 'edited',
          'photos.0.url': 'https://cdn.example.test/new.jpg',
          'shipping.provinces.0.priceMinor': 1,
        },
      },
    );
    await Animal.updateOne({ _id: d.animalId }, { $set: { breed: 'murrah', sex: 'male' } });
    const after = (await get(d.buyer, `/orders/${o.id}`)).body.order;
    expect(after.items[0]).toMatchObject({
      title: 'Swamp buffalo cow',
      unitPriceMinor: 4_000_000,
      totalMinor: 4_000_000,
      photoUrl: 'https://cdn.example.test/a.jpg',
      animal: { breed: 'swamp', sex: 'female' },
    });
    expect(after.totals).toEqual(o.totals);
    expect(after.shipping.label).toBe(o.shipping.label);
    // payment is judged against the frozen total, not today's listing price
    expect((await payOrder(h, d.buyer, after)).result).toBe('succeeded');
    expect((await Order.findById(o.id))?.grandTotalMinor).toBe(4_250_000);
  });
});

describe('audit trail', () => {
  it('records creation, payment, shipping and delivery with actors and without personal data', async () => {
    const d = await deal();
    const o = await checkout(d);
    await paid(d, o);
    await call('post', d.seller, `/orders/${o.id}/process`);
    await call('post', d.seller, `/orders/${o.id}/ship`, {
      carrier: 'Own truck',
      trackingNumber: 'AUD-0001',
    });
    await call('post', d.buyer, `/orders/${o.id}/confirm-delivery`);
    const logs = await AuditLog.find({ targetId: o.id });
    expect(logs.map((l) => l.action)).toEqual(
      expect.arrayContaining([
        'order.created',
        'order.paid',
        'order.processing',
        'order.shipped',
        'order.delivered',
      ]),
    );
    expect(String(logs.find((l) => l.action === 'order.created')?.actorId)).toBe(d.buyer.id);
    expect(JSON.stringify(logs)).not.toMatch(/Secret Street|Somsak|5678/);
  });

  it('the order history is an append-only list of who moved it where, when and why', async () => {
    const d = await deal();
    const o = await checkout(d);
    await call('post', d.seller, `/orders/${o.id}/cancel`, { reason: 'Out of stock' });
    const hist = (await get(d.buyer, `/orders/${o.id}`)).body.order.history;
    expect(hist).toEqual([
      expect.objectContaining({ from: null, to: 'PENDING_PAYMENT', by: 'buyer' }),
      expect.objectContaining({
        from: 'PENDING_PAYMENT',
        to: 'CANCELLED',
        by: 'seller',
        reason: 'Out of stock',
        actor: expect.objectContaining({ id: d.seller.id }),
      }),
    ]);
  });
});
