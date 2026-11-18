/* eslint-disable @typescript-eslint/no-explicit-any -- responses are inspected loosely in tests */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld } from '../commerce-fixtures';
import { payOrder } from '../finance-helpers';
import {
  createFarmer,
  createStaff,
  makeFarm,
  startHarness,
  type Session,
  type TestHarness,
} from '../helpers';
import { collectRoutes, installRouteRecorder, type RouteInfo } from './route-inventory';
import { label } from './matrix';
import { findSecrets } from './secret-scan';

installRouteRecorder();

let h: TestHarness;
let routes: RouteInfo[];
let admin: Session;
let farmer: Session;
let farmId: string;
const pool = new Set<string>();

const deep = (n: number) => {
  let o: unknown = 'leaf';
  for (let i = 0; i < n; i++) o = { a: o };
  return o;
};
const BODIES: [string, string, string][] = [
  ['empty object', 'application/json', '{}'],
  ['array', 'application/json', '[]'],
  ['null', 'application/json', 'null'],
  ['string', 'application/json', '"just a string"'],
  ['truncated json', 'application/json', '{"a":'],
  ['text/plain body', 'text/plain', 'hello'],
  [
    'prototype pollution',
    'application/json',
    '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}}',
  ],
  [
    'mongo operators',
    'application/json',
    JSON.stringify({
      $where: 'sleep(5000)',
      email: { $ne: null },
      identifier: { $gt: '' },
      status: { $in: ['x'] },
      farmId: { $ne: null },
      role: { $regex: '.*' },
    }),
  ],
  ['500-level nesting', 'application/json', JSON.stringify(deep(500))],
  ['oversized (150 kB)', 'application/json', JSON.stringify({ body: 'x'.repeat(150_000) })],
  [
    'wrong types everywhere',
    'application/json',
    JSON.stringify({
      amountMinor: -1,
      quantity: 1e308,
      limit: 'x',
      body: 5,
      text: ['a'],
      ids: [null],
      reason: { a: 1 },
      email: 12345,
      password: false,
      title: [],
      note: null,
      items: 'x',
      price: 'NaN',
      status: 7,
    }),
  ],
  [
    'hostile unicode / markup',
    'application/json',
    JSON.stringify({
      title: '\u0000\ud800 ‮ RTL',
      body: '😀'.repeat(3000),
      displayName: '<script>alert(1)</script>',
      note: "'; DROP TABLE users; --",
      message: '${7*7} {{7*7}} %s %n',
    }),
  ],
];
const QUERIES = [
  '?q[$ne]=1&limit=-5&limit=abc&cursor=%00&page=9999999999&sort[$gt]=1&from=2020-13-45&to=&unread=maybe',
  '?__proto__[polluted]=1&constructor[prototype][polluted]=1&status[$ne]=x',
  '?q=%E0%A4%A&x=%',
  `?${'a='.repeat(3000)}`,
  '?limit=1e9&pageSize=0&page=-1&from=2026-02-30&granularity=hour',
];
const BAD_PARAMS = [
  '%00',
  'null',
  '[object Object]',
  'a'.repeat(300),
  '$ne',
  '..%2f..%2fetc%2fpasswd',
  '%E0%A4%A',
  'undefined',
];

beforeAll(async () => {
  h = await startHarness();
  routes = collectRoutes(h.app).filter(
    (r) =>
      r.path.startsWith('/api/v1') &&
      !r.path.includes('/media/dev') &&
      !/\/auth\/(logout|sessions|password\/change|mfa|password\/reset|verify)/.test(r.path) &&
      !r.path.endsWith('/users/me/password'),
  );
  admin = await createStaff(h.app, ['super_admin']);
  farmer = await createFarmer(h.app);
  farmId = await makeFarm(h.app, farmer, 'Fuzz Farm');
  // Realistic data to crawl: users, an order paid through the real flow, notifications, a conversation.
  const w = await createWorld(h);
  const d = await w.deal({ delivery: false });
  const order = await w.pickup(d);
  await payOrder(h, d.buyer, order);
  for (const id of [
    d.farmId,
    d.listingId,
    d.negotiationId,
    d.animalId,
    order.id,
    farmId,
    admin.id,
    farmer.id,
    d.buyer.id,
    d.seller.id,
  ])
    pool.add(id);
});
afterAll(async () => {
  await h.stop();
});

const ID = /[a-f0-9]{24}/g;
const harvest = (text: string) => {
  for (const m of text.match(ID) ?? []) if (pool.size < 400) pool.add(m);
};
const pick = (i: number) => [...pool][i % pool.size]!;
const subst = (path: string, salt: number, bad?: string) => {
  let n = salt;
  return path.replace(/:(\w+)/g, (_m, name: string) => {
    if (bad) return bad;
    if (name === 'farmId') return farmId;
    if (name === 'targetType') return 'post';
    return pick(n++);
  });
};

async function hit(
  token: string | undefined,
  r: RouteInfo,
  url: string,
  body?: [string, string, string],
) {
  let req = request(h.app)[r.method](url);
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  if (body && r.method !== 'get' && r.method !== 'delete')
    req = req.set('Content-Type', body[1]).send(body[2]);
  const res = await req;
  const text = res.text ?? '';
  harvest(text);
  return { res, text };
}

function assertSane(
  who: string,
  r: RouteInfo,
  what: string,
  status: number,
  res: request.Response,
) {
  const where = `${who} ${label(r)} [${what}]`;
  expect(status, `${where} → ${status}`).toBeLessThan(500);
  if (
    status >= 400 &&
    status !== 404 &&
    !(res.headers['content-type'] ?? '').includes('json') &&
    status !== 204
  )
    expect(res.headers['content-type'] ?? '', `${where}: error responses must be JSON`).toMatch(
      /json/,
    );
  if (status >= 400 && (res.headers['content-type'] ?? '').includes('json'))
    expect(JSON.stringify(res.body), `${where}: stack trace leaked`).not.toMatch(
      /\bat \S+ \(.*:\d+:\d+\)|node_modules|ECONN|MongoServerError|Cast to ObjectId|E11000/,
    );
}

describe('hostile input never produces a server error or a leak (every route, three kinds of caller)', () => {
  it('malformed and malicious request bodies', async () => {
    for (const [who, token] of [
      ['anonymous', undefined],
      ['farmer', farmer.accessToken],
      ['super admin', admin.accessToken],
    ] as const)
      for (const r of routes.filter((x) => x.method !== 'get' && x.method !== 'delete'))
        for (const body of BODIES) {
          const { res } = await hit(token, r, subst(r.path, 0), body);
          assertSane(who, r, body[0], res.status, res);
        }
  }, 900_000);

  it('hostile query strings', async () => {
    for (const [who, token] of [
      ['anonymous', undefined],
      ['farmer', farmer.accessToken],
      ['super admin', admin.accessToken],
    ] as const)
      for (const r of routes)
        for (const q of QUERIES) {
          const { res } = await hit(token, r, `${subst(r.path, 1)}${q}`);
          assertSane(who, r, `query ${q.slice(0, 30)}`, res.status, res);
        }
  }, 900_000);

  it('hostile path parameters', async () => {
    for (const [who, token] of [
      ['farmer', farmer.accessToken],
      ['super admin', admin.accessToken],
    ] as const)
      for (const r of routes.filter((x) => x.params.length > 0))
        for (const bad of BAD_PARAMS) {
          const { res } = await hit(token, r, subst(r.path, 2, bad), [
            'empty object',
            'application/json',
            '{}',
          ]);
          assertSane(who, r, `param ${bad.slice(0, 20)}`, res.status, res);
        }
  }, 900_000);

  it('no prototype pollution happened, and the server is still healthy', async () => {
    expect(({} as any).polluted).toBeUndefined();
    expect((Object.prototype as any).polluted).toBeUndefined();
    expect((await request(h.app).get('/ready')).status).toBe(200);
  });
});

describe('responses never contain secrets (crawled as a super admin over real data)', () => {
  it('no password hashes, token hashes, TOTP/MFA secrets, encrypted addresses, tokens or connection strings in any successful response', async () => {
    const problems: string[] = [];
    let crawled = 0;
    const gets = routes.filter((r) => r.method === 'get' && !r.path.includes('/export'));
    for (let round = 0; round < 3; round++)
      for (const r of gets) {
        const { res, text } = await hit(admin.accessToken, r, subst(r.path, round * 7));
        if (res.status !== 200 || !text) continue;
        crawled++;
        for (const f of findSecrets(res.body)) problems.push(`${label(r)}: ${f}`);
      }
    expect(crawled).toBeGreaterThan(150);
    expect(problems).toEqual([]);
  }, 900_000);
});
