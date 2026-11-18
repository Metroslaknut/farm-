/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import request from 'supertest';
import { expect } from 'vitest';
import { Role, UserRole } from '../src/models';
import {
  addFarmMember,
  createStaff,
  createUser,
  login,
  makeFarm,
  mkAnimal,
  register,
  typeIdOf,
  type Session,
  type Staff,
  type TestHarness,
} from './helpers';
import { ADDRESS, API, call as rawCall } from './orders-helpers';

export const SHIPPING = {
  mode: 'by_province',
  provinces: [
    { province: 'Bangkok', priceMinor: 250_000 },
    { province: 'Chiang Mai', priceMinor: 400_000 },
  ],
  estimatedDays: { min: 2, max: 4 },
  requirements: ['livestock_vehicle'],
};

export interface Deal {
  seller: Session;
  manager: Session;
  buyer: Session;
  farmId: string;
  listingId: string;
  negotiationId: string;
  animalId: string;
}

/** Marketplace → accepted deal → order helpers shared by the commerce test suites. */
export async function createWorld(h: TestHarness) {
  const mod = await createStaff(h.app, ['moderator']);
  const buffalo = await typeIdOf(h.app, await createUser(h.app), 'buffalo');
  const call = (
    m: 'get' | 'post' | 'patch' | 'delete' | 'put',
    s: Session,
    path: string,
    body?: object,
    headers?: Record<string, string>,
  ) => rawCall(h.app, m, s, path, body, headers);
  const get = (s: Session, p: string) => request(h.app).get(`${API}${p}`).set(s.auth);

  async function sellerUser(roles = ['farm_owner', 'seller']): Promise<Session> {
    const { id, email } = await register(h.app);
    for (const key of roles)
      await UserRole.create({ userId: id, roleId: (await Role.findOne({ key }))!._id });
    return login(h.app, email);
  }

  async function deal(
    opts: {
      delivery?: boolean;
      price?: number;
      seller?: Session;
      farmId?: string;
      asking?: number;
      buyer?: Session;
    } = {},
  ): Promise<Deal> {
    const seller = opts.seller ?? (await sellerUser());
    const farmId = opts.farmId ?? (await makeFarm(h.app, seller, 'Money Farm'));
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
      askingPriceMinor: opts.asking ?? 5_000_000,
      photos: [{ url: 'https://cdn.example.test/a.jpg' }],
      deliveryOptions: delivery ? ['pickup', 'delivery'] : ['pickup'],
      ...(delivery ? { shipping: SHIPPING } : {}),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const listingId = created.body.listing.id;
    await call('post', seller, `/farms/${farmId}/listings/${listingId}/submit`);
    expect(
      (await call('post', mod, `/marketplace/moderation/listings/${listingId}/approve`)).status,
    ).toBe(200);
    const buyer = opts.buyer ?? (await createUser(h.app));
    const neg = (
      await call('post', buyer, `/marketplace/listings/${listingId}/negotiations`, {
        amountMinor: opts.price ?? 4_000_000,
      })
    ).body.negotiation;
    const acc = await call('post', seller, `/marketplace/negotiations/${neg.id}/accept`, {
      expectedSeq: 1,
    });
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    return {
      seller,
      manager,
      buyer,
      farmId,
      listingId,
      negotiationId: neg.id,
      animalId: animal.id,
    };
  }

  async function checkout(d: Deal, over: Record<string, unknown> = {}, expectStatus = 201) {
    const q = (
      await call('post', d.buyer, '/shipping/quotes', {
        listingId: d.listingId,
        destination: { province: 'Bangkok' },
      })
    ).body.quote;
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

  async function pickup(d: Deal) {
    const res = await call('post', d.buyer, '/orders', {
      negotiationId: d.negotiationId,
      fulfillment: 'pickup',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.order as any;
  }
  /** Seller processes, buyer collects: the pickup order completes and the seller's earnings are released. */
  async function complete(d: Deal, order: any) {
    expect((await call('post', d.seller, `/orders/${order.id}/process`)).status).toBe(200);
    const done = await call('post', d.buyer, `/orders/${order.id}/confirm-delivery`);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    return done.body.order;
  }

  const finance = (over: { permissions?: string[] } = {}) =>
    createStaff(h.app, ['finance_admin'], over as never);
  return { mod, buffalo, call, get, sellerUser, deal, checkout, pickup, complete, finance };
}
export type World = Awaited<ReturnType<typeof createWorld>>;
export type { Session, Staff };
