import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, type Deal, type World } from '../commerce-fixtures';
import { payOrder } from '../finance-helpers';
import {
  addFarmMember,
  createFarmer,
  createStaff,
  createStaffWithPermissions,
  createUser,
  makeFarm,
  startHarness,
  type Session,
  type TestHarness,
} from '../helpers';
import { PUBLIC_ANONYMOUS, SELF_SERVICE, WEBHOOKS } from './authz-allowlists';
import { call, isSuccess, label } from './matrix';
import { collectRoutes, installRouteRecorder, type RouteInfo } from './route-inventory';

installRouteRecorder();

let h: TestHarness;
let routes: RouteInfo[];
let plain: Session;
let farmer: Session;
let otherFarmer: Session;
let viewer: Session;
let worker: Session;
let farmId: string;

beforeAll(async () => {
  h = await startHarness();
  routes = collectRoutes(h.app);
  plain = await createUser(h.app);
  farmer = await createFarmer(h.app);
  otherFarmer = await createFarmer(h.app);
  farmId = await makeFarm(h.app, farmer, 'Matrix Farm');
  viewer = await createUser(h.app);
  worker = await createUser(h.app);
  await addFarmMember(h.app, farmer, farmId, viewer, 'viewer');
  await addFarmMember(h.app, farmer, farmId, worker, 'worker');
});
afterAll(async () => {
  await h.stop();
});

const api = (r: RouteInfo) => r.path.startsWith('/api/v1');
/** Calls that end the caller's own session or change their credentials: exercised by the auth suite, not in shared-token loops. */
const SESSION_ENDING = /\/auth\/(logout|sessions|password\/change|mfa)/;
const SNAPSHOT = join(process.cwd(), 'test/qa/routes.snapshot.txt');

describe('route inventory', () => {
  it('lists every route; a new, removed or renamed route fails until the snapshot is reviewed', () => {
    expect(routes.length).toBeGreaterThan(300);
    expect(new Set(routes.map(label)).size).toBe(routes.length);
    const current = routes.map(label).sort().join('\n');
    if (process.env['UPDATE_QA_SNAPSHOTS'] === '1' || !existsSync(SNAPSHOT))
      writeFileSync(SNAPSHOT, `${current}\n`);
    expect(
      current,
      'Route list changed. Review the new endpoints for authorization (auth, role, ownership, validation, rate limit) and update with UPDATE_QA_SNAPSHOTS=1',
    ).toBe(readFileSync(SNAPSHOT, 'utf8').trimEnd());
  });
});

describe('anonymous callers', () => {
  it('can reach only the reviewed public routes; every other route answers 401', async () => {
    const reached: string[] = [];
    for (const r of routes) {
      if (label(r) in PUBLIC_ANONYMOUS) continue;
      const res = await call(h.app, r);
      if (res.status !== 401) reached.push(`${res.status} ${label(r)}`);
      expect(res.status, label(r)).toBeLessThan(500);
    }
    expect(reached).toEqual([]);
  });

  it('public routes never answer 5xx, and the machine endpoints refuse unsigned requests', async () => {
    for (const r of routes.filter((x) => label(x) in PUBLIC_ANONYMOUS))
      expect((await call(h.app, r)).status, label(r)).toBeLessThan(500);
    for (const w of WEBHOOKS) {
      const r = routes.find((x) => label(x) === w)!;
      expect((await call(h.app, r, { body: { id: 'evt_1', type: 'x', data: {} } })).status, w).toBe(
        401,
      );
    }
  });

  it('every reviewed public route still exists (a stale allow-list entry hides nothing)', () => {
    const labels = new Set(routes.map(label));
    for (const key of [...Object.keys(PUBLIC_ANONYMOUS), ...WEBHOOKS, ...SELF_SERVICE])
      expect(labels.has(key), key).toBe(true);
  });
});

describe('a signed-in user with no role and no farm', () => {
  it('can successfully call only the reviewed self-service routes', async () => {
    const reached: string[] = [];
    for (const r of routes.filter(
      (x) => api(x) && !SESSION_ENDING.test(x.path) && !x.path.includes('/media/dev'),
    )) {
      const res = await call(h.app, r, { token: plain.accessToken });
      expect(res.status, label(r)).toBeLessThan(500);
      if (isSuccess(res.status) && !SELF_SERVICE.has(label(r)))
        reached.push(`${res.status} ${label(r)}`);
    }
    expect(reached).toEqual([]);
  });

  it('is refused (403, never 2xx) on every administrative route', async () => {
    for (const r of routes.filter(
      (x) =>
        /^\/api\/v1\/(admin|moderation|roles|permissions|audit-logs)/.test(x.path) ||
        /\/(moderation)\//.test(x.path),
    )) {
      if (SELF_SERVICE.has(label(r))) continue;
      const res = await call(h.app, r, { token: plain.accessToken });
      // 400 is acceptable where the query must be validated before the permission can be decided (export sections);
      // what matters is that nothing succeeds and nothing is returned.
      expect([400, 401, 403, 404], label(r)).toContain(res.status);
      expect(isSuccess(res.status), label(r)).toBe(false);
    }
  });
});

describe('farm isolation', () => {
  const farmRoutes = () => routes.filter((x) => x.path.includes(':farmId'));

  it('another farm’s owner and a stranger get 404 on EVERY farm route — the farm’s existence is not revealed', async () => {
    expect(farmRoutes().length).toBeGreaterThan(80);
    for (const who of [otherFarmer, plain])
      for (const r of farmRoutes()) {
        const res = await call(h.app, r, { token: who.accessToken, known: { farmId } });
        expect(res.status, `${label(r)} as ${who === plain ? 'stranger' : 'other farmer'}`).toBe(
          404,
        );
      }
  });

  it('a viewer and a worker can never change anything with an empty request, on any farm route', async () => {
    for (const [name, who] of [
      ['viewer', viewer],
      ['worker', worker],
    ] as const)
      for (const r of farmRoutes().filter((x) => x.method !== 'get')) {
        const res = await call(h.app, r, { token: who.accessToken, known: { farmId } });
        expect(isSuccess(res.status), `${name} ${label(r)} → ${res.status}`).toBe(false);
        expect(res.status, `${name} ${label(r)}`).toBeLessThan(500);
      }
  });

  it('platform staff without farms.read/farms.manage cannot see a farm either', async () => {
    const root = await createStaff(h.app, ['super_admin']);
    const staff = await createStaffWithPermissions(h.app, root, ['users.read', 'reports.read']);
    for (const r of farmRoutes()
      .filter((x) => x.method === 'get')
      .slice(0, 25)) {
      const res = await call(h.app, r, { token: staff.accessToken, known: { farmId } });
      expect(isSuccess(res.status), label(r)).toBe(false);
    }
  });
});

describe('object-level access (IDOR): real resources of one user, requested by someone else', () => {
  let w: World;
  let d: Deal;
  const ids: Record<string, string> = {};
  let intruder: Session;

  beforeAll(async () => {
    w = await createWorld(h);
    d = await w.deal({ delivery: false });
    const order = await w.pickup(d);
    await payOrder(h, d.buyer, order);
    ids['orders'] = order.id;
    ids['marketplace/negotiations'] = d.negotiationId;
    ids['marketplace/listings'] = d.listingId;
    ids['animals'] = d.animalId;
    const started = await supertest(h.app).get('/api/v1/payments').set(d.buyer.auth);
    ids['payments'] = (started.body.payments ?? started.body.items ?? [])[0]?.id ?? '';
    // The deal's listing is reserved, so open the conversation through a live product of the same farm.
    const { Product } = await import('../../src/models');
    const { Types } = await import('mongoose');
    const product = await Product.collection.insertOne({
      farmId: new Types.ObjectId(d.farmId),
      title: 'Hay',
      status: 'ACTIVE',
    } as never);
    const conv = await supertest(h.app)
      .post('/api/v1/conversations')
      .set(d.buyer.auth)
      .send({ productId: String(product.insertedId), message: 'hello' });
    ids['conversations'] = conv.body.conversation?.id ?? '';
    intruder = await createUser(h.app);
  });

  /** Which real id belongs in `:id` / `:animalId` for this route, by its first path segments. */
  const known = (r: RouteInfo): Record<string, string> | null => {
    const p = r.path.replace('/api/v1/', '');
    for (const prefix of ['orders', 'marketplace/negotiations', 'conversations', 'payments'])
      if (p.startsWith(`${prefix}/:id`)) return { id: ids[prefix]! };
    if (p.startsWith('animals/:animalId')) return { animalId: ids['animals']! };
    return null;
  };

  it('the fixture produced real ids for every resource kind', () => {
    for (const k of ['orders', 'marketplace/negotiations', 'animals', 'conversations'])
      expect(ids[k], k).toMatch(/^[a-f0-9]{24}$/);
  });

  it('a stranger gets 404 (or a refusal) on every route addressing those resources — never the data, never a change', async () => {
    const targets = routes.filter((r) => known(r) !== null && !SESSION_ENDING.test(r.path));
    expect(targets.length).toBeGreaterThan(20);
    for (const r of targets) {
      const res = await call(h.app, r, { token: intruder.accessToken, known: known(r)! });
      expect([400, 403, 404, 409], `${label(r)} → ${res.status}`).toContain(res.status);
    }
    // and the order was not touched by any of it
    const { Order } = await import('../../src/models');
    expect((await Order.findById(ids['orders']))!.status).toBe('PAID');
  });

  it('a different seller (another farm) and the seller’s own buyer cannot act as the seller', async () => {
    const otherSeller = await createFarmer(h.app);
    for (const path of ['process', 'ship', 'cancel-by-seller']) {
      const r = routes.find((x) => x.path === `/api/v1/orders/:id/${path}`);
      if (!r) continue;
      expect([403, 404, 409, 400], path).toContain(
        (await call(h.app, r, { token: otherSeller.accessToken, known: { id: ids['orders']! } }))
          .status,
      );
      expect([403, 404, 409, 400], `${path} (buyer)`).toContain(
        (await call(h.app, r, { token: d.buyer.accessToken, known: { id: ids['orders']! } }))
          .status,
      );
    }
  });
});
