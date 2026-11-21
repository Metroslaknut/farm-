/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import request from 'supertest';
import { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Notification, NotificationPreference } from '../src/models';
import { orderMoved } from '../src/modules/notifications/events';
import { notify } from '../src/modules/notifications/service';
import { createWorld, SHIPPING, type World } from './commerce-fixtures';
import { payOrder } from './finance-helpers';
import {
  addFarmMember,
  createUser,
  mkAnimal,
  startHarness,
  type Session,
  type TestHarness,
} from './helpers';
import { API } from './orders-helpers';

let h: TestHarness;
let w: World;
beforeAll(async () => {
  h = await startHarness();
  w = await createWorld(h);
});
afterAll(async () => {
  await h.stop();
});
afterEach(() => vi.restoreAllMocks());

const get = (s: Session, path: string) => request(h.app).get(`${API}${path}`).set(s.auth);
const send = (m: 'post' | 'put' | 'delete', s: Session, path: string, body?: object) =>
  request(h.app)[m](`${API}${path}`).set(s.auth).send(body);
const mine = async (s: Session, qs = '') =>
  (await get(s, `/notifications?limit=50${qs}`)).body.items as any[];
const types = async (s: Session) => (await mine(s)).map((n) => n.type);
const unread = async (s: Session) => (await get(s, '/notifications/unread-count')).body;

/** A listing that is live and open to offers (negotiable), without any offer yet. */
async function openListing(d: { seller: Session; farmId: string }) {
  const animal = await mkAnimal(h.app, d.seller, d.farmId, {
    animalTypeId: w.buffalo,
    sex: 'female',
    breed: 'swamp',
    birthDate: '2022-03-15',
  });
  const created = await w.call('post', d.seller, `/farms/${d.farmId}/listings`, {
    animalId: animal.id,
    title: 'Negotiable cow',
    askingPriceMinor: 5_000_000,
    negotiable: true,
    photos: [{ url: 'https://cdn.example.test/a.jpg' }],
    deliveryOptions: ['pickup', 'delivery'],
    shipping: SHIPPING,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.listing.id as string;
  await w.call('post', d.seller, `/farms/${d.farmId}/listings/${id}/submit`);
  expect(
    (await w.call('post', w.mod, `/marketplace/moderation/listings/${id}/approve`)).status,
  ).toBe(200);
  return id;
}

describe('who is notified of offers, counter-offers and moderation', () => {
  it('approval, offer, counter and acceptance each reach the right people — and never the person who acted', async () => {
    const d = await w.deal({ delivery: false }); // listing approved → buyer offers → seller accepts
    const sellerTypes = await types(d.seller);
    expect(sellerTypes).toContain('moderation.listing_approved');
    expect(sellerTypes).toContain('offer.received');
    expect(sellerTypes).not.toContain('offer.accepted'); // the seller accepted it themselves
    expect(await types(d.manager)).toEqual(
      expect.arrayContaining(['moderation.listing_approved', 'offer.received']),
    ); // the whole seller side
    const buyerTypes = await types(d.buyer);
    expect(buyerTypes).toContain('offer.accepted');
    expect(buyerTypes).not.toContain('offer.received'); // the buyer made the offer
    const offer = (await mine(d.seller)).find((n) => n.type === 'offer.received');
    expect(offer).toMatchObject({ category: 'offers', title: 'New offer', readAt: null, count: 1 });
    expect(offer.body).toContain('฿40,000.00');
    expect(offer.body).toContain('Swamp buffalo cow');
  });

  it('a counter-offer goes to the other side only; reject and withdraw likewise; the note text never appears', async () => {
    const d = await w.deal({ delivery: false });
    const listingId = await openListing(d);
    const neg = (
      await w.call('post', d.buyer, `/marketplace/listings/${listingId}/negotiations`, {
        amountMinor: 3_000_000,
        message: 'SECRET-NOTE-123',
      })
    ).body.negotiation;
    const countered = await w.call(
      'post',
      d.seller,
      `/marketplace/negotiations/${neg.id}/counter`,
      { amountMinor: 4_500_000, expectedSeq: 1, message: 'ANOTHER-SECRET' },
    );
    expect(countered.status, JSON.stringify(countered.body)).toBe(200);
    const c = (await mine(d.buyer)).find((n) => n.type === 'offer.countered');
    expect(c.body).toContain('฿45,000.00');
    expect((await types(d.seller)).filter((t) => t === 'offer.countered')).toHaveLength(0);
    const rejected = await w.call('post', d.buyer, `/marketplace/negotiations/${neg.id}/reject`, {
      expectedSeq: 2,
    });
    expect(rejected.status).toBe(200);
    expect(await types(d.seller)).toContain('offer.withdrawn');
    expect(await types(d.manager)).toContain('offer.withdrawn');
    const all = JSON.stringify([
      ...(await mine(d.buyer)),
      ...(await mine(d.seller)),
      ...(await mine(d.manager)),
    ]);
    expect(all).not.toContain('SECRET-NOTE-123');
    expect(all).not.toContain('ANOTHER-SECRET');
  });

  it('moderator decisions on a listing reach the farm’s owners and managers, with the moderator’s reason', async () => {
    const d = await w.deal({ delivery: false });
    const listingId = await openListing(d);
    expect(
      (
        await w.call('post', w.mod, `/marketplace/moderation/listings/${listingId}/suspend`, {
          reason: 'Photos do not match the animal',
        })
      ).status,
    ).toBe(200);
    for (const who of [d.seller, d.manager]) {
      const n = (await mine(who)).find((x) => x.type === 'moderation.listing_suspended');
      expect(n.body).toContain('Photos do not match the animal');
      expect(n.category).toBe('moderation');
    }
    expect((await types(d.buyer)).includes('moderation.listing_suspended')).toBe(false);
  });

  it('farm membership changes notify the person affected, not the actor', async () => {
    const d = await w.deal({ delivery: false });
    const newcomer = await createUser(h.app);
    const memberId = await addFarmMember(h.app, d.seller, d.farmId, newcomer, 'worker');
    // Invited → the newcomer is told; they accept → the owner is told. Nobody is told about their own action.
    expect(await types(newcomer)).toContain('farm.invitation_received');
    expect(await types(newcomer)).not.toContain('farm.invitation_accepted');
    expect(await types(d.seller)).toContain('farm.invitation_accepted');
    expect(await types(d.seller)).not.toContain('farm.invitation_received');
    expect(
      (await send('post', d.seller, `/farms/${d.farmId}/members/${memberId}`, {})).status,
    ).toBeGreaterThanOrEqual(400); // (sanity: not a real route)
    const changed = await request(h.app)
      .patch(`${API}/farms/${d.farmId}/members/${memberId}`)
      .set(d.seller.auth)
      .send({ role: 'viewer' });
    expect(changed.status).toBe(200);
    expect(await types(newcomer)).toContain('farm.member_role_changed');
    expect(
      (
        await request(h.app)
          .delete(`${API}/farms/${d.farmId}/members/${memberId}`)
          .set(d.seller.auth)
      ).status,
    ).toBe(204);
    expect(await types(newcomer)).toContain('farm.member_removed');
  });
});

describe('order status notifications', () => {
  it('every step of a pickup order tells the right side, once, in plain facts', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    expect(await types(d.seller)).toContain('order.placed');
    expect(await types(d.manager)).toContain('order.placed');
    expect(await types(d.buyer)).not.toContain('order.placed');
    expect((await payOrder(h, d.buyer, o)).result).toBe('succeeded');
    expect(await types(d.buyer)).toContain('order.paid');
    expect(await types(d.seller)).toContain('order.paid');
    expect((await w.call('post', d.seller, `/orders/${o.id}/process`)).status).toBe(200);
    expect(await types(d.buyer)).toContain('order.processing');
    expect(await types(d.seller)).not.toContain('order.processing');
    expect((await w.call('post', d.buyer, `/orders/${o.id}/confirm-delivery`)).status).toBe(200);
    const seller = await types(d.seller);
    expect(seller).toEqual(expect.arrayContaining(['order.delivered', 'farm.sale_completed']));
    expect(await types(d.buyer)).not.toContain('order.delivered'); // the buyer did it
    const placed = (await mine(d.seller)).find((n) => n.type === 'order.placed');
    expect(placed.body).toContain(o.orderNo);
    expect(placed.category).toBe('orders');
    // idempotent: replaying the same transition cannot announce it twice
    const before = await Notification.countDocuments({});
    const { Order } = await import('../src/models');
    const order = (await Order.findById(o.id))!;
    await orderMoved(order, 'PROCESSING', 'DELIVERED', 'buyer', d.buyer.id);
    await orderMoved(order, 'PAID', 'PROCESSING', 'seller', d.seller.id);
    expect(await Notification.countDocuments({})).toBe(before);
  });

  it('cancelling before payment tells the other party; cancelling after payment starts a refund and tells the buyer', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    expect(
      (await w.call('post', d.buyer, `/orders/${o.id}/cancel`, { reason: 'Changed my mind' }))
        .status,
    ).toBe(200);
    expect(await types(d.seller)).toContain('order.cancelled');
    expect(await types(d.buyer)).not.toContain('order.cancelled');

    const d2 = await w.deal({ delivery: false });
    const o2 = await w.pickup(d2);
    await payOrder(h, d2.buyer, o2);
    expect(
      (await w.call('post', d2.seller, `/orders/${o2.id}/cancel`, { reason: 'Animal is sick' }))
        .status,
    ).toBe(200);
    expect(await types(d2.buyer)).toEqual(expect.arrayContaining(['order.refund_pending']));
    expect(await types(d2.seller)).not.toContain('order.refund_pending');
  });

  it('a failing notification never undoes the business action', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    await payOrder(h, d.buyer, o);
    const spy = vi
      .spyOn(Notification, 'create')
      .mockRejectedValue(new Error('notification store down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await w.call('post', d.seller, `/orders/${o.id}/process`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.order.status).toBe('PROCESSING');
    expect(spy).toHaveBeenCalled();
  });
});

describe('reading, unread counters and scoping', () => {
  it('the unread counter always equals the stored unread rows, per category, and follows reads', async () => {
    const buyer = await createUser(h.app);
    for (let i = 0; i < 7; i++)
      await notify({
        to: [buyer.id],
        type: 'order.placed',
        params: { orderNo: `N${i}` },
        eventKey: `t:${i}`,
      });
    await notify({
      to: [buyer.id],
      type: 'moderation.listing_approved',
      params: { title: 'x' },
      eventKey: 't:mod',
    });
    let u = await unread(buyer);
    expect(u).toMatchObject({
      notifications: 8,
      messages: 0,
      byCategory: { orders: 7, moderation: 1 },
    });
    expect(u.notifications).toBe(
      await Notification.countDocuments({ userId: buyer.id, readAt: null }),
    );
    const first = (await mine(buyer))[0];
    const read = await send('post', buyer, `/notifications/${first.id}/read`);
    expect(read.status).toBe(200);
    expect(read.body.notification.readAt).toBeTruthy();
    expect((await send('post', buyer, `/notifications/${first.id}/read`)).status).toBe(200); // idempotent
    u = await unread(buyer);
    expect(u.notifications).toBe(7);
    expect(u.notifications).toBe(
      await Notification.countDocuments({ userId: buyer.id, readAt: null }),
    );
    expect(
      (await send('post', buyer, '/notifications/read-all', { category: 'orders' })).body.updated,
    ).toBeGreaterThan(0);
    expect((await unread(buyer)).byCategory).toEqual({}); // the newest (moderation) one was read above, the orders just now
    await send('post', buyer, '/notifications/read-all', {});
    expect((await unread(buyer)).notifications).toBe(0);
    expect(await mine(buyer, '&unread=true')).toHaveLength(0);
    expect((await mine(buyer)).length).toBe(8); // read ones are still listed
  });

  it('pages newest first with a cursor and filters by category and unread', async () => {
    const u = await createUser(h.app);
    for (let i = 0; i < 25; i++)
      await notify({
        to: [u.id],
        type: 'order.placed',
        params: { orderNo: `P${i}` },
        eventKey: `p:${i}`,
      });
    await notify({
      to: [u.id],
      type: 'moderation.listing_approved',
      params: { title: 't' },
      eventKey: 'p:m',
    });
    const page1 = await get(u, '/notifications?limit=10');
    expect(page1.body.items).toHaveLength(10);
    expect(page1.body.items[0].type).toBe('moderation.listing_approved'); // newest first
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await get(u, `/notifications?limit=10&cursor=${page1.body.nextCursor}`);
    expect(page2.body.items.map((n: any) => n.id)).not.toContain(page1.body.items[0].id);
    const ids = new Set<string>();
    let cursor: string | undefined;
    for (let i = 0; i < 5; i++) {
      const p = await get(u, `/notifications?limit=10${cursor ? `&cursor=${cursor}` : ''}`);
      p.body.items.forEach((n: any) => ids.add(n.id));
      cursor = p.body.nextCursor;
      if (!cursor) break;
    }
    expect(ids.size).toBe(26); // no gaps, no duplicates
    expect((await get(u, '/notifications?category=moderation')).body.items).toHaveLength(1);
    expect((await get(u, '/notifications?cursor=nope')).status).toBe(400);
    expect((await get(u, '/notifications?bogus=1')).status).toBe(400);
  });

  it('is private: nobody can read, mark or delete another user’s notifications; anonymous is refused', async () => {
    const a = await createUser(h.app);
    const b = await createUser(h.app);
    await notify({
      to: [a.id],
      type: 'order.placed',
      params: { orderNo: 'PRIVATE-1' },
      eventKey: 'priv',
    });
    const n = (await mine(a))[0];
    expect(JSON.stringify(await mine(b))).not.toContain('PRIVATE-1');
    expect((await send('post', b, `/notifications/${n.id}/read`)).status).toBe(404);
    expect((await send('delete', b, `/notifications/${n.id}`)).status).toBe(404);
    expect(
      (await get(a, '/notifications')).body.items.find((x: any) => x.id === n.id).readAt,
    ).toBeNull();
    await send('post', b, '/notifications/read-all', {});
    expect((await unread(a)).notifications).toBe(1); // b's read-all touched only b's rows
    expect((await request(h.app).get(`${API}/notifications`)).status).toBe(401);
    expect((await send('delete', a, `/notifications/${n.id}`)).status).toBe(204);
    expect((await unread(a)).notifications).toBe(0);
    expect((await send('post', a, `/notifications/${new Types.ObjectId()}/read`)).status).toBe(404);
  });
});

describe('preferences', () => {
  it('start with everything on; orders and moderation are locked; muting a category stops new notifications in it', async () => {
    const d = await w.deal({ delivery: false });
    const prefs = (await get(d.seller, '/notifications/preferences')).body.categories;
    expect(prefs).toEqual({
      orders: { inApp: true, locked: true },
      offers: { inApp: true, locked: false },
      farm: { inApp: true, locked: false },
      moderation: { inApp: true, locked: true },
      messages: { inApp: true, locked: false },
    });
    expect(
      (
        await send('put', d.seller, '/notifications/preferences', {
          categories: { orders: { inApp: false } },
        })
      ).status,
    ).toBe(409);
    expect(
      (await send('put', d.seller, '/notifications/preferences', { categories: {} })).status,
    ).toBe(400);
    expect(
      (
        await send('put', d.seller, '/notifications/preferences', {
          categories: { weather: { inApp: false } },
        })
      ).status,
    ).toBe(400);
    const set = await send('put', d.seller, '/notifications/preferences', {
      categories: { offers: { inApp: false } },
    });
    expect(set.status).toBe(200);
    expect(set.body.categories.offers.inApp).toBe(false);
    expect((await get(d.seller, '/notifications/preferences')).body.categories.offers.inApp).toBe(
      false,
    );

    const listingId = await openListing(d);
    const buyer = await createUser(h.app);
    const before = (await mine(d.seller)).length;
    await w.call('post', buyer, `/marketplace/listings/${listingId}/negotiations`, {
      amountMinor: 3_000_000,
    });
    const after = await mine(d.seller);
    expect(after.length).toBe(before); // muted: no offer notification for the seller…
    expect(await types(d.manager)).toContain('offer.received'); // …but the manager, who did not mute, still gets it
    await send('put', d.seller, '/notifications/preferences', {
      categories: { offers: { inApp: true } },
    });
    expect(await NotificationPreference.countDocuments({ userId: d.seller.id })).toBe(1);
  });
});
