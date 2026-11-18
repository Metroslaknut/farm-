/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in this probe */
/**
 * Performance probe (not part of the normal suite: runs only with PERF_PROBE=1).
 *
 *   cd services/api && PERF_PROBE=1 PERF_OUT=/tmp/perf.json npx vitest run test/perf/query-probe.test.ts
 *
 * Seeds a realistic world through the public API, then calls each hot read endpoint sequentially and records:
 *   - Mongo operations issued per request (counted with the Mongoose debug hook, so independent of CPU load),
 *   - response size,
 *   - latency with the database reached directly and through a TCP proxy that adds a fixed delay each way
 *     (PERF_RTT_MS, default 10 ms round trip), which approximates an app server talking to a remote Atlas cluster.
 * Latency numbers from a busy laptop are noisy; operation counts and simulated-RTT latency are the comparable ones.
 */
import { writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import net from 'node:net';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { describe, it } from 'vitest';
import { createApp, createContext } from '../../src/app';
import { connectDb, disconnectDb } from '../../src/db/connect';
import { Setting } from '../../src/models';
import { seedAnimalTypes } from '../../src/modules/animal-types/seed';
import { MockAiProvider, createAiProvider } from '../../src/modules/ai/provider';
import { MockPaymentProvider, createPaymentProvider } from '../../src/modules/finance/provider';
import { createVideoProvider } from '../../src/modules/media/provider';
import { seedProductCategories } from '../../src/modules/products/compliance';
import { syncRbac } from '../../src/rbac/seed';
import { InMemoryNotifier } from '../../src/services/notifier';
import {
  createFarmer,
  createUser,
  daysAgo,
  login,
  makeFarm,
  testEnv,
  typeIdOf,
  type Session,
  type TestHarness,
} from '../helpers';
import { ADDRESS } from '../orders-helpers';
import { createShopWorld } from '../shop-fixtures';

const ANIMALS = Number(process.env.PERF_ANIMALS ?? 800);
const RUNS = Number(process.env.PERF_RUNS ?? 15);
const RTT_MS = Number(process.env.PERF_RTT_MS ?? 10);

/** A TCP proxy that holds every chunk for `delay.ms` in each direction (order is kept: same delay, FIFO timers). */
function delayProxy(target: { host: string; port: number }, delay: { ms: number }) {
  const server = net.createServer((client) => {
    const upstream = net.connect(target.port, target.host);
    const pipe = (from: net.Socket, to: net.Socket) =>
      from.on('data', (chunk) => {
        if (delay.ms <= 0) to.write(chunk);
        else setTimeout(() => to.write(chunk), delay.ms);
      });
    pipe(client, upstream);
    pipe(upstream, client);
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on('error', close).on('close', close);
    upstream.on('error', close).on('close', close);
  });
  return new Promise<net.Server>((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<unknown>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) await fn(items[i++]!);
    }),
  );
}

describe.runIf(process.env.PERF_PROBE === '1')('performance probe', () => {
  it('measures hot read endpoints', { timeout: 3_600_000 }, async () => {
    const mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 180_000 } });
    const direct = new URL(mongo.getUri());
    const delay = { ms: 0 };
    const proxy = await delayProxy({ host: direct.hostname, port: Number(direct.port) }, delay);
    const uri = `mongodb://127.0.0.1:${(proxy.address() as AddressInfo).port}/farmplus_perf`;
    await connectDb(uri);
    await syncRbac();
    await seedAnimalTypes();
    await seedProductCategories();

    // Seeding a busy machine can outlast the default 15-minute access token.
    const env = testEnv(uri, { ACCESS_TOKEN_TTL_SECONDS: '3600' });
    const notifier = new InMemoryNotifier();
    const video = createVideoProvider(env);
    const created = createPaymentProvider(env);
    const payments = created instanceof MockPaymentProvider ? created : null;
    const aiCreated = createAiProvider(env);
    const ai = aiCreated instanceof MockAiProvider ? aiCreated : null;
    const app = createApp(env, { notifier, video, payments, ai });
    const h: TestHarness = {
      env,
      app,
      notifier,
      ctx: createContext(env, { notifier, video, payments, ai }),
      video,
      payments,
      ai,
      stop: async () => {},
    };
    const httpServer = app.listen(0, '127.0.0.1');
    await new Promise((r) => httpServer.once('listening', r));
    const base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/api/v1`;

    await Setting.updateOne(
      { key: 'marketplace.requireReview' },
      { $set: { key: 'marketplace.requireReview', value: false } },
      { upsert: true },
    );
    await Setting.updateOne(
      { key: 'chat.messagesPerMinute' },
      { $set: { key: 'chat.messagesPerMinute', value: 100_000 } },
      { upsert: true },
    );

    // --- seed ---------------------------------------------------------------------------------------------------------
    const t0 = Date.now();
    const api = async (method: string, path: string, s: { auth: object } | null, body?: object) => {
      let r = (request(app) as any)[method](`/api/v1${path}`);
      if (s) r = r.set(s.auth);
      const res = await (body ? r.send(body) : r);
      if (res.status >= 300)
        throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
      return res.body;
    };
    let farmer: Session = await createFarmer(app);
    const farmId = await makeFarm(app, farmer, 'Probe Farm');
    const buffalo = await typeIdOf(app, farmer);
    const animalIds: string[] = [];
    await pool(
      Array.from({ length: ANIMALS }, (_, i) => i),
      20,
      async (i) => {
        const a = await api('post', `/farms/${farmId}/animals`, farmer, {
          animalCode: `P-${String(i).padStart(5, '0')}`,
          name: `Animal ${i}`,
          animalTypeId: buffalo,
          sex: i % 2 ? 'male' : 'female',
          birthDate: daysAgo(400 + (i % 300)),
        });
        animalIds.push(a.animal.id);
      },
    );
    const weighed = animalIds.slice(0, 120);
    await pool(
      weighed.flatMap((animalId) => [10, 40, 70, 100].map((d) => ({ animalId, d }))),
      20,
      ({ animalId, d }) =>
        api('post', `/farms/${farmId}/weights`, farmer, {
          animalId,
          weighedOn: daysAgo(d),
          weightKg: 200 + d,
        }),
    );
    await pool(animalIds.slice(0, 200), 20, (animalId) =>
      api('post', `/farms/${farmId}/health`, farmer, {
        animalId,
        type: 'vaccination',
        recordedOn: daysAgo(5),
        title: 'FMD vaccine',
      }).catch(() =>
        api('post', `/farms/${farmId}/health`, farmer, {
          animalId,
          type: 'checkup',
          recordedOn: daysAgo(5),
          title: 'Routine check',
        }),
      ),
    );

    // Shop sellers + products, a buyer with a cart and orders.
    const shop = await createShopWorld(h);
    const sellers = [
      await shop.seller('Seller A'),
      await shop.seller('Seller B'),
      await shop.seller('Seller C'),
    ];
    const products: any[] = [];
    for (let i = 0; i < 30; i++)
      products.push(await shop.live(sellers[i % 3]!, { title: `Probe feed ${i}`, stock: 1000 }));
    let buyer: Session = await createUser(app);
    for (let i = 0; i < 12; i++) {
      await shop.put(buyer, products[i % 3]!.id, 1);
      const res = await shop.checkout(buyer, {
        delivery: true,
        province: 'Bangkok',
        address: ADDRESS,
      });
      for (const order of res.body.orders ?? [res.body.order])
        if (i % 2 === 0) await shop.pay(buyer, order);
    }
    for (let i = 0; i < 6; i++) await shop.put(buyer, products[i]!.id, 1);

    // Marketplace listings from the probe farm, conversations with the buyer.
    const sellerRole = await mongoose.connection.db!.collection('roles').findOne({ key: 'seller' });
    await mongoose.connection.db!.collection('user_roles').insertOne({
      userId: new mongoose.Types.ObjectId(farmer.id),
      roleId: sellerRole!._id,
    });
    farmer = await login(app, farmer.email);
    const listingIds: string[] = [];
    for (const animalId of animalIds.slice(-Math.min(60, Math.floor(animalIds.length / 2)))) {
      const l = await api('post', `/farms/${farmId}/listings`, farmer, {
        animalId,
        title: `Probe listing ${animalId.slice(-6)}`,
        askingPriceMinor: 3_000_000,
        negotiable: true,
        photos: [{ url: 'https://cdn.example.test/a.jpg' }],
        deliveryOptions: ['pickup'],
      });
      await api('post', `/farms/${farmId}/listings/${l.listing.id}/submit`, farmer);
      listingIds.push(l.listing.id);
    }
    for (const listingId of listingIds.slice(0, 10)) {
      const c = await api('post', '/conversations', buyer, { listingId, message: 'hello' });
      // 10 + 10×10 messages stay under the chat limit (at most 120 per user per minute, by design).
      for (let m = 0; m < 10; m++)
        await api('post', `/conversations/${c.conversation.id}/messages`, buyer, {
          body: `msg ${m}`,
        });
    }
    for (let i = 0; i < 40; i++) await api('post', '/posts', farmer, { body: `Probe post ${i}` });
    const sampleAnimal = animalIds[0]!;
    const sampleProduct = products[0]!.id;
    const sampleListing = listingIds[0]!;
    const seedSeconds = (Date.now() - t0) / 1000;

    // Fresh tokens for the measurement (seeding may have taken a while).
    farmer = await login(app, farmer.email);
    buyer = await login(app, buyer.email);
    sellers[0]!.user = await login(app, sellers[0]!.user.email);

    // --- measure ------------------------------------------------------------------------------------------------------
    let ops = 0;
    const opNames: string[] = [];
    mongoose.set('debug', (coll: string, method: string) => {
      ops++;
      opNames.push(`${coll}.${method}`);
    });
    const endpoints: { name: string; path: string; who: { accessToken: string } }[] = [
      { name: 'GET /auth/me', path: '/auth/me', who: buyer },
      { name: 'GET /notifications/unread-count', path: '/notifications/unread-count', who: buyer },
      { name: 'GET /notifications', path: '/notifications', who: buyer },
      { name: 'GET /farms/me', path: '/farms/me', who: farmer },
      { name: 'GET /farms/:id', path: `/farms/${farmId}`, who: farmer },
      { name: 'GET /farms/:id/summary', path: `/farms/${farmId}/summary`, who: farmer },
      {
        name: 'GET /farms/:id/animals (page 20)',
        path: `/farms/${farmId}/animals?pageSize=20`,
        who: farmer,
      },
      {
        name: 'GET /farms/:id/animals sort=animalCode',
        path: `/farms/${farmId}/animals?pageSize=20&sort=animalCode`,
        who: farmer,
      },
      {
        name: 'GET /farms/:id/animals/:animalId',
        path: `/farms/${farmId}/animals/${sampleAnimal}`,
        who: farmer,
      },
      { name: 'GET /farms/:id/health', path: `/farms/${farmId}/health`, who: farmer },
      { name: 'GET /farms/:id/weights', path: `/farms/${farmId}/weights`, who: farmer },
      {
        name: 'GET /farms/:id/orders (seller)',
        path: `/farms/${sellers[0]!.farmId}/orders`,
        who: sellers[0]!.user,
      },
      { name: 'GET /orders (buyer)', path: '/orders', who: buyer },
      { name: 'GET /marketplace/listings', path: '/marketplace/listings?limit=20', who: buyer },
      {
        name: 'GET /marketplace/listings/:id',
        path: `/marketplace/listings/${sampleListing}`,
        who: buyer,
      },
      { name: 'GET /shop/products', path: '/shop/products', who: buyer },
      { name: 'GET /shop/products/:id', path: `/shop/products/${sampleProduct}`, who: buyer },
      { name: 'GET /shop/cart', path: '/shop/cart', who: buyer },
      { name: 'GET /conversations', path: '/conversations', who: buyer },
      { name: 'GET /posts (feed)', path: '/posts', who: buyer },
    ];
    const pct = (xs: number[], p: number) => {
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
    };
    const rows: any[] = [];
    for (const e of endpoints) {
      const row: any = { endpoint: e.name };
      for (const [label, ms] of [
        ['local', 0],
        [`rtt${RTT_MS}`, RTT_MS / 2],
      ] as const) {
        delay.ms = ms;
        const times: number[] = [];
        for (let i = 0; i < RUNS + 2; i++) {
          ops = 0;
          opNames.length = 0;
          const start = performance.now();
          const res = await fetch(`${base}${e.path}`, {
            headers: { authorization: `Bearer ${e.who.accessToken}` },
          });
          const text = await res.text();
          const took = performance.now() - start;
          if (!res.ok) throw new Error(`${e.name} → ${res.status} ${text.slice(0, 300)}`);
          if (i >= 2) times.push(took);
          row.status = res.status;
          row.bytes = Buffer.byteLength(text);
          row.dbOps = ops;
          row.opNames = [...opNames];
        }
        row[`${label}P50`] = Math.round(pct(times, 50) * 10) / 10;
        row[`${label}P95`] = Math.round(pct(times, 95) * 10) / 10;
      }
      rows.push(row);
      console.log(
        `${e.name.padEnd(42)} ops ${String(row.dbOps).padStart(3)}  bytes ${String(row.bytes).padStart(7)}  local p50 ${row.localP50} ms  rtt${RTT_MS} p50 ${row[`rtt${RTT_MS}P50`]} ms p95 ${row[`rtt${RTT_MS}P95`]} ms`,
      );
    }
    mongoose.set('debug', false);
    const out = {
      when: new Date().toISOString(),
      animals: ANIMALS,
      runs: RUNS,
      rttMs: RTT_MS,
      seedSeconds,
      rows,
    };
    if (process.env.PERF_OUT)
      writeFileSync(process.env.PERF_OUT, `${JSON.stringify(out, null, 2)}\n`);

    httpServer.close();
    await disconnectDb();
    proxy.close();
    await mongo.stop();
  });
});
