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
  register,
  type Session,
  type Staff,
  type TestHarness,
} from './helpers';
import { ADDRESS, API, call as rawCall } from './orders-helpers';
import { payOrder } from './finance-helpers';

export const SHIP = {
  mode: 'by_province',
  provinces: [
    { province: 'Bangkok', priceMinor: 15_000 },
    { province: 'Chiang Mai', priceMinor: 30_000 },
  ],
  estimatedDays: { min: 1, max: 3 },
};

export const PRODUCT = {
  categoryKey: 'feed',
  title: 'Premium dairy feed 25 kg',
  description: 'Balanced pellet feed for lactating cattle.',
  brand: 'AgriBest',
  sku: undefined as string | undefined,
  unit: 'bag',
  priceMinor: 120_000,
  stock: 10,
  specs: [
    { name: 'Weight', value: '25 kg' },
    { name: 'Protein', value: '18%' },
  ],
  photos: [{ url: 'https://cdn.example.test/p1.jpg' }],
  deliveryOptions: ['pickup', 'delivery'],
  shipping: SHIP,
};

let skuN = 0;
export const sku = () => `SKU-${Date.now()}-${++skuN}`;

export async function createShopWorld(h: TestHarness) {
  const mod = await createStaff(h.app, ['moderator']);
  const admin = await createStaff(h.app, ['super_admin']);
  const call = (
    m: 'get' | 'post' | 'patch' | 'delete' | 'put',
    s: Session,
    path: string,
    body?: object,
    headers?: Record<string, string>,
  ) => rawCall(h.app, m, s, path, body, headers);

  async function sellerUser(roles = ['farm_owner', 'seller']): Promise<Session> {
    const { id, email } = await register(h.app);
    for (const key of roles)
      await UserRole.create({ userId: id, roleId: (await Role.findOne({ key }))!._id });
    return login(h.app, email);
  }
  /** A seller with a farm. */
  async function seller(name = 'Shop Farm') {
    const user = await sellerUser();
    const farmId = await makeFarm(h.app, user, name);
    return { user, farmId };
  }
  async function create(s: { user: Session; farmId: string }, over: Record<string, unknown> = {}) {
    const res = await call('post', s.user, `/farms/${s.farmId}/products`, {
      ...PRODUCT,
      sku: sku(),
      ...over,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.product as any;
  }
  /** Created, submitted and approved: on sale. */
  async function live(s: { user: Session; farmId: string }, over: Record<string, unknown> = {}) {
    const p = await create(s, over);
    const sub = await call('post', s.user, `/farms/${s.farmId}/products/${p.id}/submit`);
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    const ok = await call('post', mod, `/shop/moderation/products/${p.id}/approve`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    return ok.body.product as any;
  }
  const put = (b: Session, productId: string, quantity: number) =>
    call('put', b, `/shop/cart/items/${productId}`, { quantity });
  const cartOf = async (b: Session, province?: string) =>
    (
      await call(
        'get',
        b,
        `/shop/cart${province ? `?province=${encodeURIComponent(province)}` : ''}`,
      )
    ).body.cart as any;
  /** What the buyer saw per seller, as the checkout request wants it. */
  const expectedOf = (cart: any, delivery = false) =>
    cart.groups.map((g: any) => ({
      farmId: g.farmId,
      itemsMinor: g.itemsMinor,
      shippingMinor: delivery ? g.shipping.shippingMinor : 0,
    }));
  async function checkout(
    b: Session,
    opts: { delivery?: boolean; province?: string; expected?: any; address?: object } = {},
    expectStatus = 201,
  ) {
    const delivery = opts.delivery ?? false;
    const cart = await cartOf(b, delivery ? (opts.province ?? 'Bangkok') : undefined);
    const body: Record<string, unknown> = {
      fulfillment: delivery ? 'delivery' : 'pickup',
      expected: opts.expected ?? expectedOf(cart, delivery),
      ...(delivery ? { address: opts.address ?? ADDRESS } : {}),
    };
    const res = await call('post', b, '/shop/cart/checkout', body);
    expect(res.status, JSON.stringify(res.body)).toBe(expectStatus);
    return res;
  }
  const pay = (b: Session, order: any) => payOrder(h, b, order);
  const get = (s: Session, p: string) => request(h.app).get(`${API}${p}`).set(s.auth);
  const buyer = () => createUser(h.app);
  return {
    mod,
    admin,
    call,
    get,
    sellerUser,
    seller,
    create,
    live,
    put,
    cartOf,
    expectedOf,
    checkout,
    pay,
    buyer,
    addFarmMember,
    h,
  };
}
export type ShopWorld = Awaited<ReturnType<typeof createShopWorld>>;
export type { Session, Staff };
