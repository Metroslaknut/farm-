/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Animal,
  Listing,
  Negotiation,
  Order,
  Payment,
  Refund,
  Shipment,
  ShippingQuote,
} from '../../src/models';
import { runMarketplaceCleanup } from '../../src/modules/marketplace/cleanup.service';
import { runOrdersCleanup } from '../../src/modules/orders/orders.service';
import { SHIPPING, createWorld, type World } from '../commerce-fixtures';
import { payOrder, providerEvent, send, startPayment } from '../finance-helpers';
import {
  addFarmMember,
  createStaff,
  createUser,
  makeFarm,
  mkAnimal,
  startHarness,
  type Session,
  type Staff,
  type TestHarness,
} from '../helpers';
import { ADDRESS, shipWebhook } from '../orders-helpers';
import { createShopWorld, type ShopWorld } from '../shop-fixtures';

/**
 * Business workflow audit, scenarios D (marketplace & negotiation) and E (orders & shipping).
 * Every case drives the real API and asserts the resulting database state. Synthetic data only.
 */
let h: TestHarness;
let w: World;
let shop: ShopWorld;
let fin: Staff;
const API = '/api/v1';
const DAY = 86_400_000;

beforeAll(async () => {
  h = await startHarness();
  w = await createWorld(h);
  shop = await createShopWorld(h);
  fin = await createStaff(h.app, ['finance_admin']);
});
afterAll(() => h.stop());

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------
interface Farm {
  seller: Session;
  manager: Session;
  farmId: string;
  animalId: string;
}
async function farm(): Promise<Farm> {
  const seller = await w.sellerUser();
  const farmId = await makeFarm(h.app, seller, 'Audit Farm');
  const manager = await w.sellerUser(['seller']);
  await addFarmMember(h.app, seller, farmId, manager, 'manager');
  const a = await mkAnimal(h.app, seller, farmId, {
    animalTypeId: w.buffalo,
    sex: 'female',
    breed: 'swamp',
    birthDate: '2022-03-15',
  });
  return { seller, manager, farmId, animalId: a.id };
}
const listingBody = (animalId: string, over: Record<string, unknown> = {}) => ({
  animalId,
  title: 'Swamp buffalo cow',
  askingPriceMinor: 5_000_000,
  photos: [{ url: 'https://cdn.example.test/a.jpg' }],
  deliveryOptions: ['pickup', 'delivery'],
  shipping: SHIPPING,
  ...over,
});
async function live(f: Farm, over: Record<string, unknown> = {}): Promise<string> {
  const c = await w.call(
    'post',
    f.seller,
    `/farms/${f.farmId}/listings`,
    listingBody(f.animalId, over),
  );
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  const id = c.body.listing.id;
  expect((await w.call('post', f.seller, `/farms/${f.farmId}/listings/${id}/submit`)).status).toBe(
    200,
  );
  expect(
    (await w.call('post', w.mod, `/marketplace/moderation/listings/${id}/approve`)).status,
  ).toBe(200);
  return id;
}
const offer = (b: Session, listingId: string, amountMinor: number, extra: object = {}) =>
  w.call('post', b, `/marketplace/listings/${listingId}/negotiations`, { amountMinor, ...extra });
const act = (s: Session, negId: string, what: string, body: object = {}) =>
  w.call('post', s, `/marketplace/negotiations/${negId}/${what}`, body);
const finance = (s: Session, path: string, body?: object) =>
  request(h.app).post(`${API}/admin/finance${path}`).set(s.auth).send(body);
const openListings = (animalId: string) =>
  Listing.countDocuments({
    animalId,
    status: { $in: ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'RESERVED', 'PAUSED'] },
  });

/** A paid delivery order in SHIPPED state with its shipment. */
async function shipped() {
  const d = await w.deal();
  const o = await w.checkout(d);
  expect((await payOrder(h, d.buyer, o)).result).toBe('succeeded');
  expect((await w.call('post', d.seller, `/orders/${o.id}/process`)).status).toBe(200);
  const s = await w.call('post', d.seller, `/orders/${o.id}/ship`, {
    carrier: 'Own truck',
    trackingNumber: `TRK-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  return { d, o, sh: s.body.order.shipments[0] as any };
}
const carrier = (sh: any, status: string, opts: Parameters<typeof shipWebhook>[2] = {}) =>
  shipWebhook(
    h.app,
    { type: 'shipment.status', carrier: sh.carrier, trackingNumber: sh.trackingNumber, status },
    opts,
  );

// ===========================================================================
// D. Marketplace & negotiation
// ===========================================================================
describe('D1 create listing from an eligible animal; ineligible animals refused', () => {
  it('D1-a an active animal of the farm can be listed (DRAFT, snapshot of the animal)', async () => {
    const f = await farm();
    const res = await w.call(
      'post',
      f.seller,
      `/farms/${f.farmId}/listings`,
      listingBody(f.animalId),
    );
    expect(res.status).toBe(201);
    const l = (await Listing.findById(res.body.listing.id))!;
    expect(l.status).toBe('DRAFT');
    expect(String(l.animalId)).toBe(f.animalId);
    expect(String(l.farmId)).toBe(f.farmId);
    expect(l.animal.breed).toBe('swamp');
  });

  it('D1-b archived, sold, deceased, another farm’s and already-listed animals are refused', async () => {
    const f = await farm();
    const other = await farm();
    const create = (animalId: string) =>
      w.call('post', f.seller, `/farms/${f.farmId}/listings`, listingBody(animalId));
    // other farm's animal
    expect((await create(other.animalId)).status).toBe(404);
    // sold / deceased
    for (const status of ['sold', 'deceased']) {
      const a = await mkAnimal(h.app, f.seller, f.farmId, {
        animalTypeId: w.buffalo,
        sex: 'male',
        currentStatus: status,
      });
      const r = await create(a.id);
      expect(r.status, status).toBe(409);
      expect(r.body.error.code).toBe('ANIMAL_NOT_SELLABLE');
    }
    // archived
    const arch = await mkAnimal(h.app, f.seller, f.farmId, {
      animalTypeId: w.buffalo,
      sex: 'male',
    });
    expect(
      (await w.call('post', f.seller, `/farms/${f.farmId}/animals/${arch.id}/archive`, {})).status,
    ).toBe(200);
    expect((await create(arch.id)).body.error.code).toBe('ANIMAL_NOT_SELLABLE');
    // already listed
    expect((await create(f.animalId)).status).toBe(201);
    const dup = await create(f.animalId);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_LISTED');
    expect(await Listing.countDocuments({ farmId: f.farmId })).toBe(1);
    expect(await Listing.countDocuments({ animalId: other.animalId })).toBe(0);
  });
});

describe('D2 duplicate active listings prevented', () => {
  it('D2-a 6 concurrent creates for the same animal → exactly one listing', async () => {
    const f = await farm();
    const rs = await Promise.all(
      Array.from({ length: 6 }, () =>
        w.call('post', f.seller, `/farms/${f.farmId}/listings`, listingBody(f.animalId)),
      ),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of rs.filter((x) => x.status !== 201)) {
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('ALREADY_LISTED');
    }
    expect(await Listing.countDocuments({ animalId: f.animalId })).toBe(1);
  });

  it('D2-b renewing an EXPIRED listing while a newer listing of the same animal is open is refused cleanly (409, one open listing)', async () => {
    const f = await farm();
    const first = await live(f);
    await Listing.updateOne({ _id: first }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await runMarketplaceCleanup();
    expect((await Listing.findById(first))!.status).toBe('EXPIRED');
    // EXPIRED is not "open": a second listing for the same animal may be created and published
    const second = await live(f);
    expect((await Listing.findById(second))!.status).toBe('ACTIVE');
    const renew = await w.call('post', f.seller, `/farms/${f.farmId}/listings/${first}/renew`);
    expect(renew.status, JSON.stringify(renew.body)).toBe(409);
    expect(await openListings(f.animalId)).toBe(1);
    expect((await Listing.findById(first))!.status).toBe('EXPIRED');
  });
});

describe('D3 listing moderation', () => {
  it('D3-a submit → PENDING_REVIEW; seller, plain user and a moderator who belongs to the farm cannot approve', async () => {
    const f = await farm();
    const c = await w.call(
      'post',
      f.seller,
      `/farms/${f.farmId}/listings`,
      listingBody(f.animalId),
    );
    const id = c.body.listing.id;
    expect(
      (await w.call('post', f.seller, `/farms/${f.farmId}/listings/${id}/submit`)).status,
    ).toBe(200);
    expect((await Listing.findById(id))!.status).toBe('PENDING_REVIEW');
    const insiderMod = await createStaff(h.app, ['moderator']);
    await addFarmMember(h.app, f.seller, f.farmId, insiderMod, 'viewer');
    for (const who of [f.seller, f.manager, await createUser(h.app)])
      expect(
        (await w.call('post', who, `/marketplace/moderation/listings/${id}/approve`)).status,
      ).toBe(403);
    const self = await w.call('post', insiderMod, `/marketplace/moderation/listings/${id}/approve`);
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('SELF_MODERATION');
    expect((await Listing.findById(id))!.status).toBe('PENDING_REVIEW');
  });

  it('D3-b reject → REJECTED with reason; edit returns it to DRAFT; resubmit → approve → ACTIVE; double approve 409', async () => {
    const f = await farm();
    const c = await w.call(
      'post',
      f.seller,
      `/farms/${f.farmId}/listings`,
      listingBody(f.animalId),
    );
    const id = c.body.listing.id;
    await w.call('post', f.seller, `/farms/${f.farmId}/listings/${id}/submit`);
    const rej = await w.call('post', w.mod, `/marketplace/moderation/listings/${id}/reject`, {
      reason: 'Photo does not show the animal',
    });
    expect(rej.status).toBe(200);
    let l = (await Listing.findById(id))!;
    expect(l.status).toBe('REJECTED');
    expect(l.rejectedReason).toBe('Photo does not show the animal');
    // a rejected listing cannot be resubmitted without revising it
    expect(
      (await w.call('post', f.seller, `/farms/${f.farmId}/listings/${id}/submit`)).status,
    ).toBe(409);
    expect(
      (
        await w.call('patch', f.seller, `/farms/${f.farmId}/listings/${id}`, {
          title: 'Swamp buffalo, new photo',
        })
      ).status,
    ).toBe(200);
    l = (await Listing.findById(id))!;
    expect(l.status).toBe('DRAFT');
    expect(l.rejectedReason).toBeNull();
    // a partial edit (title only) must not touch the other fields
    expect(l.photos.map((p) => p.url)).toEqual(['https://cdn.example.test/a.jpg']);
    expect([...l.deliveryOptions]).toEqual(['pickup', 'delivery']);
    const resub = await w.call('post', f.seller, `/farms/${f.farmId}/listings/${id}/submit`);
    expect(resub.status, JSON.stringify(resub.body)).toBe(200);
    expect((await Listing.findById(id))!.status).toBe('PENDING_REVIEW');
    expect(
      (await w.call('post', w.mod, `/marketplace/moderation/listings/${id}/approve`)).status,
    ).toBe(200);
    expect(
      (await w.call('post', w.mod, `/marketplace/moderation/listings/${id}/approve`)).status,
    ).toBe(409);
    l = (await Listing.findById(id))!;
    expect(l.status).toBe('ACTIVE');
    expect(l.activatedAt).toBeTruthy();
  });
});

describe('D4 offer / counter-offer rules', () => {
  it('D4-a offers on one’s own farm’s listing are refused (owner and manager)', async () => {
    const f = await farm();
    const id = await live(f);
    for (const who of [f.seller, f.manager]) {
      const r = await offer(who, id, 4_000_000);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('OWN_LISTING');
    }
    expect(await Negotiation.countDocuments({ listingId: id })).toBe(0);
  });

  it('D4-b amount bounds: above asking, below floor, zero, negative, float, string, wrong currency are refused', async () => {
    const f = await farm();
    const id = await live(f, { minOfferMinor: 3_000_000 });
    const b = await createUser(h.app);
    for (const [amount, extra] of [
      [5_000_001, {}],
      [2_999_999, {}],
      [0, {}],
      [-100, {}],
      [4_000_000.5, {}],
      ['4000000', {}],
      [4_000_000, { currency: 'USD' }],
    ] as const) {
      const r = await offer(b, id, amount as number, extra);
      expect(r.status, `${amount} ${JSON.stringify(extra)}`).toBe(400);
    }
    expect(await Negotiation.countDocuments({ listingId: id })).toBe(0);
    expect((await offer(b, id, 3_000_000)).status).toBe(201);
    // a second offer while one is open
    expect((await offer(b, id, 3_100_000)).body.error.code).toBe('NEGOTIATION_EXISTS');
  });

  it('D4-c turn rules: buyer cannot answer own offer; counters must move toward each other; stale seq refused', async () => {
    const f = await farm();
    const id = await live(f);
    const b = await createUser(h.app);
    const n = (await offer(b, id, 4_000_000)).body.negotiation;
    expect((await act(b, n.id, 'accept', { expectedSeq: 1 })).body.error.code).toBe(
      'NOT_YOUR_TURN',
    );
    expect(
      (await act(b, n.id, 'counter', { amountMinor: 3_900_000, expectedSeq: 1 })).body.error.code,
    ).toBe('NOT_YOUR_TURN');
    // seller counters: not below the buyer's offer, not above asking, not equal
    for (const amt of [3_900_000, 5_100_000, 4_000_000])
      expect(
        (await act(f.seller, n.id, 'counter', { amountMinor: amt, expectedSeq: 1 })).status,
      ).toBe(400);
    const c = await act(f.manager, n.id, 'counter', { amountMinor: 4_600_000, expectedSeq: 1 });
    expect(c.status).toBe(200);
    // seller cannot act twice in a row
    expect((await act(f.seller, n.id, 'accept', { expectedSeq: 2 })).body.error.code).toBe(
      'NOT_YOUR_TURN',
    );
    // buyer: stale seq, above seller's price
    expect((await act(b, n.id, 'accept', { expectedSeq: 1 })).body.error.code).toBe('STALE_OFFER');
    expect((await act(b, n.id, 'counter', { amountMinor: 4_700_000, expectedSeq: 2 })).status).toBe(
      400,
    );
    const doc = (await Negotiation.findById(n.id))!;
    expect(doc.status).toBe('open');
    expect(doc.turn).toBe('buyer');
    expect(doc.currentOfferMinor).toBe(4_600_000);
    expect(doc.history.map((x) => x.type)).toEqual(['offer', 'counter']);
    expect(String(doc.history[1]!.actorId)).toBe(f.manager.id);
    expect((await Listing.findById(id))!.status).toBe('ACTIVE');
  });

  it('D4-d fixed-price listing: only the asking price, no counters', async () => {
    const f = await farm();
    const id = await live(f, { negotiable: false });
    const b = await createUser(h.app);
    expect((await offer(b, id, 4_000_000)).status).toBe(400);
    const n = (await offer(b, id, 5_000_000)).body.negotiation;
    const c = await act(f.seller, n.id, 'counter', { amountMinor: 5_000_000, expectedSeq: 1 });
    expect(c.status).toBe(409);
    expect(c.body.error.code).toBe('PRICE_FIXED');
  });
});

describe('D5 acceptance & expiration', () => {
  it('D5-a accept after offerExpiresAt is refused (OFFER_EXPIRED), negotiation expired, listing stays ACTIVE', async () => {
    const f = await farm();
    const id = await live(f);
    const b = await createUser(h.app);
    const n = (await offer(b, id, 4_000_000)).body.negotiation;
    await Negotiation.updateOne(
      { _id: n.id },
      { $set: { offerExpiresAt: new Date(Date.now() - 1000) } },
    );
    const r = await act(f.seller, n.id, 'accept', { expectedSeq: 1 });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('OFFER_EXPIRED');
    expect((await Negotiation.findById(n.id))!.status).toBe('expired');
    const l = (await Listing.findById(id))!;
    expect(l.status).toBe('ACTIVE');
    expect(l.reservation ?? null).toBeNull();
    // counter is refused as well
    expect(
      (await act(f.seller, n.id, 'counter', { amountMinor: 4_500_000, expectedSeq: 1 })).body.error
        .code,
    ).toBe('OFFER_EXPIRED');
  });

  it('D5-b the cleanup job expires stale offers without anybody reading them, and is idempotent', async () => {
    const f = await farm();
    const id = await live(f);
    const [b1, b2] = [await createUser(h.app), await createUser(h.app)];
    const n1 = (await offer(b1, id, 4_000_000)).body.negotiation;
    const n2 = (await offer(b2, id, 4_100_000)).body.negotiation;
    await Negotiation.updateOne(
      { _id: n1.id },
      { $set: { offerExpiresAt: new Date(Date.now() - 1000) } },
    );
    await runMarketplaceCleanup();
    expect((await Negotiation.findById(n1.id))!.status).toBe('expired');
    expect((await Negotiation.findById(n2.id))!.status).toBe('open');
    const len = (await Negotiation.findById(n1.id))!.history.length;
    await runMarketplaceCleanup();
    expect((await Negotiation.findById(n1.id))!.history.length).toBe(len);
  });
});

describe('D6 reservation on acceptance', () => {
  it('D6-a accepting reserves the listing once at the agreed price; other open negotiations are closed; second accept refused', async () => {
    const f = await farm();
    const id = await live(f);
    const [b1, b2, b3] = [
      await createUser(h.app),
      await createUser(h.app),
      await createUser(h.app),
    ];
    const n1 = (await offer(b1, id, 4_000_000)).body.negotiation;
    const n2 = (await offer(b2, id, 4_200_000)).body.negotiation;
    const n3 = (await offer(b3, id, 4_300_000)).body.negotiation;
    const ok = await act(f.seller, n2.id, 'accept', { expectedSeq: 1 });
    expect(ok.status).toBe(200);
    const l = (await Listing.findById(id))!;
    expect(l.status).toBe('RESERVED');
    expect(String(l.reservation!.negotiationId)).toBe(n2.id);
    expect(String(l.reservation!.buyerId)).toBe(b2.id);
    expect(l.reservation!.amountMinor).toBe(4_200_000);
    expect((await Negotiation.findById(n2.id))!.status).toBe('accepted');
    expect((await Negotiation.findById(n1.id))!.status).toBe('cancelled');
    expect((await Negotiation.findById(n3.id))!.status).toBe('cancelled');
    // the closed ones cannot be accepted any more, a new buyer cannot offer, re-accept is refused
    expect((await act(f.seller, n3.id, 'accept', { expectedSeq: 1 })).status).toBe(409);
    expect((await act(f.seller, n2.id, 'accept', { expectedSeq: 1 })).status).toBe(409);
    expect((await offer(await createUser(h.app), id, 4_000_000)).status).toBe(404);
    // the seller cannot edit or cancel a reserved listing
    expect(
      (
        await w.call('patch', f.seller, `/farms/${f.farmId}/listings/${id}`, {
          askingPriceMinor: 9_000_000,
        })
      ).status,
    ).toBe(409);
    expect(
      (await w.call('post', f.seller, `/farms/${f.farmId}/listings/${id}/cancel`)).status,
    ).toBe(409);
    const after = (await Listing.findById(id))!;
    expect(after.status).toBe('RESERVED');
    expect(after.askingPriceMinor).toBe(5_000_000);
    expect(await Negotiation.countDocuments({ listingId: id, status: 'accepted' })).toBe(1);
  });
});

describe('D7 concurrent purchase attempts', () => {
  it('D7-a seller accepts 6 buyers’ offers in parallel → exactly one reservation', async () => {
    const f = await farm();
    const id = await live(f);
    const buyers = await Promise.all(Array.from({ length: 6 }, () => createUser(h.app)));
    const negs: any[] = [];
    for (const [i, b] of buyers.entries())
      negs.push((await offer(b, id, 4_000_000 + i * 10_000)).body.negotiation);
    const rs = await Promise.all(
      negs.map((n, i) => act(i % 2 ? f.manager : f.seller, n.id, 'accept', { expectedSeq: 1 })),
    );
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    for (const r of rs.filter((x) => x.status !== 200)) expect(r.status).toBe(409);
    const winner = negs[rs.findIndex((r) => r.status === 200)];
    const l = (await Listing.findById(id))!;
    expect(l.status).toBe('RESERVED');
    expect(String(l.reservation!.negotiationId)).toBe(winner.id);
    expect(await Negotiation.countDocuments({ listingId: id, status: 'accepted' })).toBe(1);
    expect(await Negotiation.countDocuments({ listingId: id, status: 'open' })).toBe(0);
  });

  it('D7-b 6 parallel pickup checkouts of the same reservation → exactly one order', async () => {
    const d = await w.deal({ delivery: false });
    const rs = await Promise.all(
      Array.from({ length: 6 }, () =>
        w.call('post', d.buyer, '/orders', {
          negotiationId: d.negotiationId,
          fulfillment: 'pickup',
        }),
      ),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of rs.filter((x) => x.status !== 201)) {
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('ORDER_EXISTS');
    }
    expect(await Order.countDocuments({ negotiationId: d.negotiationId })).toBe(1);
    const o = (await Order.findOne({ negotiationId: d.negotiationId }))!;
    expect(String((await Listing.findById(d.listingId))!.reservation!.orderId)).toBe(String(o._id));
  });

  it('D7-c 4 parallel delivery checkouts with 4 distinct valid quotes → one order, only its quote consumed', async () => {
    const d = await w.deal();
    const quotes: any[] = [];
    for (let i = 0; i < 4; i++)
      quotes.push(
        (
          await w.call('post', d.buyer, '/shipping/quotes', {
            listingId: d.listingId,
            destination: { province: 'Bangkok' },
          })
        ).body.quote,
      );
    const rs = await Promise.all(
      quotes.map((q) =>
        w.call('post', d.buyer, '/orders', {
          negotiationId: d.negotiationId,
          fulfillment: 'delivery',
          quoteId: q.id,
          optionId: 'seller',
          address: ADDRESS,
          acknowledgeTransport: true,
        }),
      ),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await Order.countDocuments({ negotiationId: d.negotiationId })).toBe(1);
    const o = (await Order.findOne({ negotiationId: d.negotiationId }))!;
    expect(
      await ShippingQuote.countDocuments({
        _id: { $in: quotes.map((q) => q.id) },
        usedByOrderId: { $ne: null },
      }),
    ).toBe(1);
    expect(String((await ShippingQuote.findById(o.shippingSnapshot!.quoteId))!.usedByOrderId)).toBe(
      String(o._id),
    );
  });
});

describe('D8 sold / unavailable animals', () => {
  it('D8-a after the order completes: listing SOLD, animal "sold" (stays on the seller farm), cannot be listed again', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    expect((await payOrder(h, d.buyer, o)).result).toBe('succeeded');
    await w.complete(d, o);
    expect((await Order.findById(o.id))!.status).toBe('DELIVERED');
    expect((await Listing.findById(d.listingId))!.status).toBe('SOLD');
    expect((await Negotiation.findById(d.negotiationId))!.status).toBe('completed');
    const a = (await Animal.findById(d.animalId))!;
    expect(a.currentStatus).toBe('sold');
    // spec (marketplace.md "Known limitations"): ownership transfer is a later part — the record stays on the seller farm
    expect(String(a.farmId)).toBe(d.farmId);
    const relist = await w.call(
      'post',
      d.seller,
      `/farms/${d.farmId}/listings`,
      listingBody(d.animalId),
    );
    expect(relist.status).toBe(409);
    expect(relist.body.error.code).toBe('ANIMAL_NOT_SELLABLE');
  });

  it('D8-b a sold animal cannot be put back on sale by editing its status back to "active"', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    await payOrder(h, d.buyer, o);
    await w.complete(d, o);
    await w.call('patch', d.seller, `/farms/${d.farmId}/animals/${d.animalId}`, {
      currentStatus: 'active',
    });
    const relist = await w.call(
      'post',
      d.seller,
      `/farms/${d.farmId}/listings`,
      listingBody(d.animalId),
    );
    expect(relist.status, JSON.stringify(relist.body)).toBe(409);
    expect(await openListings(d.animalId)).toBe(0);
  });

  it('D8-c an animal recorded as deceased after its listing went live cannot be bought (accept refused)', async () => {
    const f = await farm();
    const id = await live(f);
    const b = await createUser(h.app);
    const n = (await offer(b, id, 4_000_000)).body.negotiation;
    const p = await w.call('patch', f.seller, `/farms/${f.farmId}/animals/${f.animalId}`, {
      currentStatus: 'deceased',
    });
    expect(p.status).toBe(200);
    const r = await act(f.seller, n.id, 'accept', { expectedSeq: 1 });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect((await Listing.findById(id))!.status).not.toBe('RESERVED');
  });
});

describe('D9 ownership validation on a farm’s listings', () => {
  it('D9-a worker / viewer / outsider cannot create, edit or answer offers; a removed manager loses access', async () => {
    const f = await farm();
    const id = await live(f);
    const [worker, viewer] = [await w.sellerUser(['seller']), await w.sellerUser(['seller'])];
    await addFarmMember(h.app, f.seller, f.farmId, worker, 'worker');
    await addFarmMember(h.app, f.seller, f.farmId, viewer, 'viewer');
    const outsider = await w.sellerUser();
    const a2 = await mkAnimal(h.app, f.seller, f.farmId, { animalTypeId: w.buffalo, sex: 'male' });
    for (const [who, code] of [
      [worker, 403],
      [viewer, 403],
      [outsider, 404],
    ] as const) {
      expect(
        (await w.call('post', who, `/farms/${f.farmId}/listings`, listingBody(a2.id))).status,
      ).toBe(code);
      expect((await w.call('post', who, `/farms/${f.farmId}/listings/${id}/pause`)).status).toBe(
        code,
      );
    }
    const b = await createUser(h.app);
    const n = (await offer(b, id, 4_000_000)).body.negotiation;
    for (const who of [worker, viewer, outsider])
      expect((await act(who, n.id, 'accept', { expectedSeq: 1 })).status).toBe(404);
    // a manager who is removed from the farm can no longer answer the farm's offers
    const members = (await w.get(f.seller, `/farms/${f.farmId}/members`)).body;
    const list = (members.members ?? members.items) as any[];
    const m = list.find((x: any) => (x.user?.id ?? x.userId) === f.manager.id);
    expect(m, JSON.stringify(members)).toBeTruthy();
    expect((await w.call('delete', f.seller, `/farms/${f.farmId}/members/${m.id}`)).status).toBe(
      204,
    );
    expect((await act(f.manager, n.id, 'accept', { expectedSeq: 1 })).status).toBe(404);
    expect(await Listing.countDocuments({ animalId: a2.id })).toBe(0);
    expect((await Listing.findById(id))!.status).toBe('ACTIVE');
    expect((await Negotiation.findById(n.id))!.status).toBe('open');
  });

  it('D9-b another farm cannot reach this farm’s listing through its own farm path (IDOR)', async () => {
    const f = await farm();
    const g = await farm();
    const id = await live(f);
    expect(
      (
        await w.call('patch', g.seller, `/farms/${g.farmId}/listings/${id}`, {
          title: 'Hijacked listing',
        })
      ).status,
    ).toBe(404);
    expect((await w.call('post', g.seller, `/farms/${g.farmId}/listings/${id}/pause`)).status).toBe(
      404,
    );
    expect((await Listing.findById(id))!.status).toBe('ACTIVE');
    expect((await Listing.findById(id))!.title).toBe('Swamp buffalo cow');
  });
});

// ===========================================================================
// E. Orders & shipping
// ===========================================================================
describe('E1 order from an accepted offer', () => {
  it('E1-a the order price is the accepted counter amount, not the asking price; repeat checkout refused', async () => {
    const f = await farm();
    const id = await live(f, { deliveryOptions: ['pickup'], shipping: undefined });
    const b = await createUser(h.app);
    const n = (await offer(b, id, 4_000_000)).body.negotiation;
    await act(f.seller, n.id, 'counter', { amountMinor: 4_500_000, expectedSeq: 1 });
    expect((await act(b, n.id, 'accept', { expectedSeq: 2 })).status).toBe(200);
    const r = await w.call('post', b, '/orders', { negotiationId: n.id, fulfillment: 'pickup' });
    expect(r.status).toBe(201);
    const o = (await Order.findById(r.body.order.id))!;
    expect(o.itemsMinor).toBe(4_500_000);
    expect(o.grandTotalMinor).toBe(4_500_000);
    expect((o.items[0] as any).unitPriceMinor).toBe(4_500_000);
    expect(o.status).toBe('PENDING_PAYMENT');
    const again = await w.call('post', b, '/orders', {
      negotiationId: n.id,
      fulfillment: 'pickup',
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ORDER_EXISTS');
    expect(await Order.countDocuments({ negotiationId: n.id })).toBe(1);
  });

  it('E1-b seller side and third parties cannot check out the buyer’s deal; delivery not offered is refused', async () => {
    const d = await w.deal({ delivery: false });
    for (const who of [d.seller, d.manager, await createUser(h.app)])
      expect(
        (
          await w.call('post', who, '/orders', {
            negotiationId: d.negotiationId,
            fulfillment: 'pickup',
          })
        ).status,
      ).toBe(404);
    const q = await w.call('post', d.seller, '/shipping/quotes', {
      listingId: d.listingId,
      destination: { province: 'Bangkok' },
    });
    expect(q.status).toBe(409);
    expect(q.body.error.code).toBe('OWN_LISTING');
    expect(await Order.countDocuments({ negotiationId: d.negotiationId })).toBe(0);
  });

  it('E1-c a buyer who has meanwhile become a manager of the selling farm cannot check out (self-dealing)', async () => {
    const d = await w.deal({ delivery: false });
    await addFarmMember(h.app, d.seller, d.farmId, d.buyer, 'manager');
    const r = await w.call('post', d.buyer, '/orders', {
      negotiationId: d.negotiationId,
      fulfillment: 'pickup',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(await Order.countDocuments({ negotiationId: d.negotiationId })).toBe(0);
  });
});

describe('E2 product order and price snapshots', () => {
  it('E2-a changing a product’s price/title after checkout leaves the order unchanged; a stale cart price is refused', async () => {
    const s = await shop.seller('Snapshot Farm');
    const p = await shop.live(s, { priceMinor: 100_000, stock: 9, title: 'Original dairy feed' });
    const buyer = await shop.buyer();
    await shop.put(buyer, p.id, 2);
    const o = (await shop.checkout(buyer)).body.orders[0];
    const before = (await Order.findById(o.id))!.toObject();
    expect(before.kind).toBe('product');
    expect(before.itemsMinor).toBe(200_000);
    const edit = await shop.call('patch', s.user, `/farms/${s.farmId}/products/${p.id}`, {
      priceMinor: 150_000,
      title: 'Renamed dairy feed',
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    const after = (await Order.findById(o.id))!.toObject();
    expect(after.items).toEqual(before.items);
    expect(after.itemsMinor).toBe(200_000);
    expect(after.grandTotalMinor).toBe(before.grandTotalMinor);
    expect((after.items[0] as any).title).toBe('Original dairy feed');
    expect((after.items[0] as any).unitPriceMinor).toBe(100_000);
    // paying uses the frozen total
    expect((await shop.pay(buyer, o)).result).toBe('succeeded');
    expect((await Payment.findOne({ orderId: o.id, disposition: 'applied' }))!.amountMinor).toBe(
      200_000,
    );
    // a second buyer whose cart was priced before a change is stopped
    const p2 = await shop.live(s, { priceMinor: 100_000, stock: 9 });
    const b2 = await shop.buyer();
    expect((await shop.put(b2, p2.id, 1)).status).toBe(200);
    const cart = await shop.cartOf(b2);
    await shop.call('patch', s.user, `/farms/${s.farmId}/products/${p2.id}`, {
      priceMinor: 160_000,
    });
    const res = await shop.call('post', b2, '/shop/cart/checkout', {
      fulfillment: 'pickup',
      expected: shop.expectedOf(cart),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error.code).toBe('PRICE_CHANGED');
    expect(await Order.countDocuments({ buyerId: b2.id })).toBe(0);
  });
});

describe('E3 shipping quote validation at checkout', () => {
  const body = (d: any, q: any, over: object = {}) => ({
    negotiationId: d.negotiationId,
    fulfillment: 'delivery',
    quoteId: q.id,
    optionId: 'seller',
    address: ADDRESS,
    acknowledgeTransport: true,
    ...over,
  });
  const quote = async (who: Session, listingId: string, province = 'Bangkok') =>
    (await w.call('post', who, '/shipping/quotes', { listingId, destination: { province } })).body
      .quote;

  it('E3-a another buyer’s quote, an expired quote and a province-mismatched quote are refused; nothing is reserved', async () => {
    const d = await w.deal();
    // another buyer's quote on an ACTIVE listing of the same seller? use a second deal's buyer quote on THIS listing — not allowed (reserved), so a quote of another buyer for another listing
    const d2 = await w.deal();
    const foreign = await quote(d2.buyer, d2.listingId);
    const r1 = await w.call('post', d.buyer, '/orders', body(d, foreign));
    expect(r1.status).toBe(400);
    // forged: other buyer's quote id for this very listing (inserted directly as if the other buyer had quoted it earlier)
    const other = await createUser(h.app);
    const mine = await quote(d.buyer, d.listingId);
    const stolen = await ShippingQuote.create({
      ...(await ShippingQuote.findById(mine.id))!.toObject(),
      _id: undefined,
      buyerId: other.id,
    });
    const r1b = await w.call('post', d.buyer, '/orders', body(d, { id: String(stolen._id) }));
    expect(r1b.status).toBe(400);
    // expired
    const exp = await quote(d.buyer, d.listingId);
    await ShippingQuote.updateOne(
      { _id: exp.id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    const r2 = await w.call('post', d.buyer, '/orders', body(d, exp));
    expect(r2.status).toBe(409);
    expect(r2.body.error.code).toBe('QUOTE_STALE');
    // province mismatch: Bangkok quote, Chiang Mai address
    const bkk = await quote(d.buyer, d.listingId, 'Bangkok');
    const r3 = await w.call(
      'post',
      d.buyer,
      '/orders',
      body(d, bkk, { address: { ...ADDRESS, province: 'Chiang Mai', postalCode: '50000' } }),
    );
    expect(r3.status).toBe(409);
    expect(r3.body.error.code).toBe('QUOTE_STALE');
    // unknown option / client-sent price
    expect(
      (await w.call('post', d.buyer, '/orders', body(d, bkk, { optionId: 'provider:free' })))
        .status,
    ).toBe(400);
    expect(
      (await w.call('post', d.buyer, '/orders', body(d, bkk, { shippingMinor: 1 }))).status,
    ).toBe(400);
    expect(await Order.countDocuments({ negotiationId: d.negotiationId })).toBe(0);
    const l = (await Listing.findById(d.listingId))!;
    expect(l.status).toBe('RESERVED');
    expect(l.reservation!.orderId ?? null).toBeNull();
  });

  it('E3-b the quoted amount is charged exactly (Chiang Mai 4,000 THB), quote is single-use', async () => {
    const d = await w.deal();
    const q = await quote(d.buyer, d.listingId, 'Chiang Mai');
    expect(q.options[0].priceMinor).toBe(400_000);
    const r = await w.call(
      'post',
      d.buyer,
      '/orders',
      body(d, q, { address: { ...ADDRESS, province: 'Chiang Mai', postalCode: '50000' } }),
    );
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const o = (await Order.findById(r.body.order.id))!;
    expect(o.shippingMinor).toBe(400_000);
    expect(o.itemsMinor).toBe(4_000_000);
    expect(o.grandTotalMinor).toBe(4_400_000);
    expect(String((await ShippingQuote.findById(q.id))!.usedByOrderId)).toBe(String(o._id));
    // requote with the used quote is refused
    const rq = await w.call('post', d.buyer, `/orders/${o._id}/requote`, {
      quoteId: q.id,
      optionId: 'seller',
      address: { ...ADDRESS, province: 'Chiang Mai', postalCode: '50000' },
      acknowledgeTransport: true,
    });
    expect(rq.status).toBe(409);
    expect((await Order.findById(o._id))!.grandTotalMinor).toBe(4_400_000);
  });

  it('E3-c a quote taken before the seller changed delivery prices is stale at checkout', async () => {
    const f = await farm();
    const id = await live(f);
    const b = await createUser(h.app);
    const n = (await offer(b, id, 4_000_000)).body.negotiation;
    const q = await quote(b, id);
    await w.call('post', f.seller, `/farms/${f.farmId}/listings/${id}/pause`);
    expect(
      (
        await w.call('patch', f.seller, `/farms/${f.farmId}/listings/${id}`, {
          shipping: { ...SHIPPING, provinces: [{ province: 'Bangkok', priceMinor: 900_000 }] },
          // sent explicitly: a partial PATCH resets omitted defaulted fields (see D3-b)
          deliveryOptions: ['pickup', 'delivery'],
          photos: [{ url: 'https://cdn.example.test/a.jpg' }],
        })
      ).status,
    ).toBe(200);
    await w.call('post', f.seller, `/farms/${f.farmId}/listings/${id}/resume`);
    expect((await act(f.seller, n.id, 'accept', { expectedSeq: 1 })).status).toBe(200);
    const r = await w.call('post', b, '/orders', body({ negotiationId: n.id }, q));
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error.code).toBe('QUOTE_STALE');
    expect(await Order.countDocuments({ negotiationId: n.id })).toBe(0);
  });
});

describe('E4 payment-required state', () => {
  it('E4-a an unpaid order cannot be processed or shipped, and cannot be confirmed delivered', async () => {
    const d = await w.deal();
    const o = await w.checkout(d);
    const p = await w.call('post', d.seller, `/orders/${o.id}/process`);
    expect(p.status).toBe(409);
    const s = await w.call('post', d.seller, `/orders/${o.id}/ship`, { carrier: 'Own truck' });
    expect(s.status).toBe(409);
    expect((await w.call('post', d.buyer, `/orders/${o.id}/confirm-delivery`)).status).toBe(409);
    expect((await Order.findById(o.id))!.status).toBe('PENDING_PAYMENT');
    expect(await Shipment.countDocuments({ orderId: o.id })).toBe(0);
  });

  it('E4-b unpaid order past its payment window is cancelled by cleanup, the reservation released, and it can no longer be paid', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    await Order.updateOne({ _id: o.id }, { $set: { paymentDueAt: new Date(Date.now() - 1000) } });
    const rep = await runOrdersCleanup(new Date(), h.payments);
    expect(rep.unpaidCancelled).toBeGreaterThanOrEqual(1);
    const ord = (await Order.findById(o.id))!;
    expect(ord.status).toBe('CANCELLED');
    expect(ord.cancelReason).toBe('payment_window_expired');
    const l = (await Listing.findById(d.listingId))!;
    expect(l.status).toBe('ACTIVE');
    expect(l.reservation ?? null).toBeNull();
    expect((await Negotiation.findById(d.negotiationId))!.status).toBe('cancelled');
    const pay = await startPayment(h.app, d.buyer, o.id);
    expect(pay.status).toBe(409);
    expect(pay.body.error.code).toBe('ORDER_NOT_PAYABLE');
    expect(await Payment.countDocuments({ orderId: o.id })).toBe(0);
    expect(await Refund.countDocuments({ orderId: o.id })).toBe(0);
  });
});

describe('E5 cancellation rules per state', () => {
  it('E5-a unpaid: buyer cancels → CANCELLED, listing back on sale, no refund; cancelling again refused', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    const c = await w.call('post', d.buyer, `/orders/${o.id}/cancel`, {
      reason: 'Changed my mind',
    });
    expect(c.status).toBe(200);
    expect((await Order.findById(o.id))!.status).toBe('CANCELLED');
    expect((await Listing.findById(d.listingId))!.status).toBe('ACTIVE');
    expect(await Refund.countDocuments({ orderId: o.id })).toBe(0);
    expect(
      (await w.call('post', d.seller, `/orders/${o.id}/cancel`, { reason: 'Again please' })).status,
    ).toBe(409);
  });

  it('E5-b paid: buyer and seller cancel at the same time → one REFUND_PENDING, exactly one refund of the full amount', async () => {
    const d = await w.deal();
    const o = await w.checkout(d);
    await payOrder(h, d.buyer, o);
    const rs = await Promise.all([
      w.call('post', d.buyer, `/orders/${o.id}/cancel`, { reason: 'Buyer changed mind' }),
      w.call('post', d.seller, `/orders/${o.id}/cancel`, { reason: 'Seller cannot deliver' }),
    ]);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(1);
    const ord = (await Order.findById(o.id))!;
    expect(ord.status).toBe('REFUND_PENDING');
    expect(await Refund.countDocuments({ orderId: o.id })).toBe(1);
    expect((await Refund.findOne({ orderId: o.id }))!.amountMinor).toBe(4_250_000);
    expect((await Listing.findById(d.listingId))!.status).toBe('ACTIVE');
    // a further cancel attempt is refused and creates nothing
    expect(
      (await w.call('post', d.buyer, `/orders/${o.id}/cancel`, { reason: 'Once more' })).status,
    ).toBe(409);
    expect(await Refund.countDocuments({ orderId: o.id })).toBe(1);
  });

  it('E5-c shipped: buyer cannot cancel; seller only after a failed delivery attempt; outsider gets 404', async () => {
    const { d, o, sh } = await shipped();
    const outsider = await createUser(h.app);
    expect(
      (await w.call('post', outsider, `/orders/${o.id}/cancel`, { reason: 'Not mine' })).status,
    ).toBe(404);
    const b = await w.call('post', d.buyer, `/orders/${o.id}/cancel`, { reason: 'Too slow' });
    expect(b.status).toBe(409);
    expect(b.body.error.code).toBe('CANCEL_NOT_ALLOWED');
    expect(
      (await w.call('post', d.seller, `/orders/${o.id}/cancel`, { reason: 'Give up' })).status,
    ).toBe(409);
    expect((await carrier(sh, 'failed')).body.result).toBe('applied');
    const s = await w.call('post', d.seller, `/orders/${o.id}/cancel`, {
      reason: 'Truck broke down',
    });
    expect(s.status).toBe(200);
    expect((await Order.findById(o.id))!.status).toBe('REFUND_PENDING');
    expect(await Refund.countDocuments({ orderId: o.id })).toBe(1);
  });
});

describe('E6 shipment status transitions', () => {
  it('E6-a invalid seller jumps refused; buyer / outsider / other farm’s seller cannot post events', async () => {
    const { d, o, sh } = await shipped();
    const ev = (who: Session, orderId: string, status: string) =>
      w.call('post', who, `/orders/${orderId}/shipments/${sh.id}/events`, { status });
    expect((await ev(d.seller, o.id, 'cancelled')).status).toBe(409);
    expect((await ev(d.seller, o.id, 'pending')).status).toBe(409);
    for (const who of [d.buyer, await createUser(h.app)])
      expect((await ev(who, o.id, 'out_for_delivery')).status).toBe(404);
    // a seller of ANOTHER order cannot reach this shipment through their own order id
    const other = await shipped();
    expect((await ev(other.d.seller, other.o.id, 'out_for_delivery')).status).toBe(404);
    expect((await ev(d.seller, o.id, 'out_for_delivery')).status).toBe(200);
    expect((await ev(d.seller, o.id, 'in_transit')).status).toBe(409); // backwards
    expect((await Shipment.findById(sh.id))!.status).toBe('out_for_delivery');
    expect((await Order.findById(o.id))!.status).toBe('SHIPPED');
  });

  it('E6-b carrier webhook: missing / bad / tampered / stale signatures 401; out-of-order and unknown events ignored', async () => {
    const { o, sh } = await shipped();
    expect((await carrier(sh, 'delivered', { header: null })).status).toBe(401);
    expect((await carrier(sh, 'delivered', { header: 'time=1,sig1=deadbeef' })).status).toBe(401);
    expect((await carrier(sh, 'delivered', { tamper: true })).status).toBe(401);
    expect(
      (await carrier(sh, 'delivered', { time: Math.floor(Date.now() / 1000) - 3600 })).status,
    ).toBe(401);
    expect((await Shipment.findById(sh.id))!.status).toBe('in_transit');
    expect((await carrier(sh, 'delivered')).body.result).toBe('applied');
    expect((await carrier(sh, 'in_transit')).body.result).toBe('ignored');
    expect((await carrier(sh, 'delivered')).body.result).toBe('ignored');
    expect((await carrier({ ...sh, trackingNumber: 'NOPE-0000' }, 'delivered')).body.result).toBe(
      'unknown_shipment',
    );
    const s = (await Shipment.findById(sh.id))!;
    expect(s.status).toBe('delivered');
    expect(s.events.filter((e) => e.status === 'delivered')).toHaveLength(1);
    expect((await Order.findById(o.id))!.status).toBe('SHIPPED'); // buyer still to confirm
  });
});

describe('E7 delivery confirmation', () => {
  it('E7-a only the buyer confirms; confirming completes the sale once', async () => {
    const { d, o } = await shipped();
    expect((await w.call('post', d.seller, `/orders/${o.id}/confirm-delivery`)).status).toBe(404);
    expect((await w.call('post', d.manager, `/orders/${o.id}/confirm-delivery`)).status).toBe(404);
    expect(
      (await w.call('post', await createUser(h.app), `/orders/${o.id}/confirm-delivery`)).status,
    ).toBe(404);
    expect((await Order.findById(o.id))!.status).toBe('SHIPPED');
    expect((await w.call('post', d.buyer, `/orders/${o.id}/confirm-delivery`)).status).toBe(200);
    expect((await w.call('post', d.buyer, `/orders/${o.id}/confirm-delivery`)).status).toBe(409);
    const ord = (await Order.findById(o.id))!;
    expect(ord.status).toBe('DELIVERED');
    expect(ord.history.filter((x) => x.to === 'DELIVERED')).toHaveLength(1);
    expect((await Listing.findById(d.listingId))!.status).toBe('SOLD');
    expect((await Animal.findById(d.animalId))!.currentStatus).toBe('sold');
  });

  it('E7-b auto-confirm runs only after the grace period counted from the carrier’s delivery report', async () => {
    const { d, o, sh } = await shipped();
    // no delivery report: nothing to auto-confirm, however late
    await runOrdersCleanup(new Date(Date.now() + 60 * DAY), h.payments);
    expect((await Order.findById(o.id))!.status).toBe('SHIPPED');
    expect((await carrier(sh, 'delivered')).body.result).toBe('applied');
    const ord = (await Order.findById(o.id))!;
    expect(ord.autoConfirmAt).toBeTruthy();
    const days = (ord.autoConfirmAt!.getTime() - ord.deliveredAt!.getTime()) / DAY;
    expect(days).toBeCloseTo(3, 3);
    await runOrdersCleanup(new Date(Date.now() + 2 * DAY), h.payments);
    expect((await Order.findById(o.id))!.status).toBe('SHIPPED');
    // buyer confirm racing the auto-confirm: exactly one DELIVERED transition
    await Promise.all([
      w.call('post', d.buyer, `/orders/${o.id}/confirm-delivery`),
      runOrdersCleanup(new Date(Date.now() + 3 * DAY + 60_000), h.payments),
    ]);
    const done = (await Order.findById(o.id))!;
    expect(done.status).toBe('DELIVERED');
    expect(done.history.filter((x) => x.to === 'DELIVERED')).toHaveLength(1);
    expect((await Listing.findById(d.listingId))!.status).toBe('SOLD');
  });

  it('E7-c pickup: buyer confirms only after the seller started processing (not while merely PAID)', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    await payOrder(h, d.buyer, o);
    expect((await w.call('post', d.buyer, `/orders/${o.id}/confirm-delivery`)).status).toBe(409);
    expect((await Order.findById(o.id))!.status).toBe('PAID');
    await w.complete(d, o);
    expect((await Order.findById(o.id))!.status).toBe('DELIVERED');
  });
});

describe('E8 refund eligibility', () => {
  it('E8-a refund = amount received (items + shipping); completes once; REFUNDED / DELIVERED orders produce no refund', async () => {
    const d = await w.deal();
    const o = await w.checkout(d);
    const { payment } = await payOrder(h, d.buyer, o);
    expect((await w.call('post', d.seller, `/orders/${o.id}/process`)).status).toBe(200);
    expect(
      (await w.call('post', d.buyer, `/orders/${o.id}/cancel`, { reason: 'Changed my mind' }))
        .status,
    ).toBe(200);
    const p = (await Payment.findById(payment.id))!;
    const refund = (await Refund.findOne({ orderId: o.id }))!;
    expect(refund.amountMinor).toBe(p.receivedMinor ?? p.amountMinor);
    expect(refund.amountMinor).toBe(4_250_000);
    expect(String(refund.paymentId)).toBe(payment.id);
    expect(
      (await finance(fin, `/refunds/${refund._id}/approve`, { confirmation: refund.refundNo }))
        .status,
    ).toBe(200);
    const stored = (await Refund.findById(refund._id))!;
    h.payments!.settleRefund(stored.providerRef!, 'succeeded');
    const ev = providerEvent('refund.succeeded', stored.providerRef!, stored.amountMinor);
    expect((await send(h.app, ev)).body.result).toBe('succeeded');
    await send(h.app, ev); // duplicate delivery
    expect((await Order.findById(o.id))!.status).toBe('REFUNDED');
    expect((await Refund.findById(refund._id))!.status).toBe('succeeded');
    expect(
      (await w.call('post', d.buyer, `/orders/${o.id}/cancel`, { reason: 'Refund again' })).status,
    ).toBe(409);
    expect(await Refund.countDocuments({ orderId: o.id })).toBe(1);

    // delivered order: final, no refund path
    const d2 = await w.deal({ delivery: false });
    const o2 = await w.pickup(d2);
    await payOrder(h, d2.buyer, o2);
    await w.complete(d2, o2);
    for (const who of [d2.buyer, d2.seller])
      expect(
        (await w.call('post', who, `/orders/${o2.id}/cancel`, { reason: 'Want money back' }))
          .status,
      ).toBe(409);
    expect(await Refund.countDocuments({ orderId: o2.id })).toBe(0);
  });

  it('E8-b a returned shipment opens exactly one refund even when the carrier repeats the callback', async () => {
    const { d, o, sh } = await shipped();
    expect((await carrier(sh, 'returned')).body.result).toBe('applied');
    await carrier(sh, 'returned');
    await carrier(sh, 'returned');
    expect((await Order.findById(o.id))!.status).toBe('REFUND_PENDING');
    expect(await Refund.countDocuments({ orderId: o.id })).toBe(1);
    expect((await Refund.findOne({ orderId: o.id }))!.amountMinor).toBe(4_250_000);
    expect((await Listing.findById(d.listingId))!.status).toBe('ACTIVE');
  });
});
