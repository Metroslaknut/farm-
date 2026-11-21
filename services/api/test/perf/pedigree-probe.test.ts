/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in this probe */
/**
 * Performance probe for farm staff, breeding and pedigree reads (runs only with PERF_PROBE=1).
 *
 *   cd services/api && PERF_PROBE=1 PERF_OUT=<file.json> npx vitest run test/perf/pedigree-probe.test.ts
 *
 * Seeds, through the public API, a fighting-cock farm with a 6-generation pedigree (every generation hatched from
 * breeding records of the previous one), unrelated birds, staff who joined by invitation and pending invitations.
 * Then reads each endpoint sequentially and records Mongo operations per request, response size and latency, directly
 * and through a TCP proxy adding PERF_RTT_MS (default 10 ms) per round trip (≈ a remote Atlas cluster).
 * Latency on a busy laptop is noisy; the operation counts are the comparable numbers.
 */
import { writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import net from 'node:net';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { connectDb } from '../../src/db/connect';
import { seedAnimalTypes } from '../../src/modules/animal-types/seed';
import { createVideoProvider } from '../../src/modules/media/provider';
import { syncRbac } from '../../src/rbac/seed';
import { InMemoryNotifier } from '../../src/services/notifier';
import {
  addFarmMember,
  createFarmer,
  createUser,
  daysAgo,
  login,
  makeFarm,
  testEnv,
  typeIdOf,
} from '../helpers';

const RUNS = Number(process.env.PERF_RUNS ?? 15);
const RTT_MS = Number(process.env.PERF_RTT_MS ?? 10);
const EXTRA = Number(process.env.PERF_ANIMALS ?? 400);

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

describe.runIf(process.env.PERF_PROBE === '1')('pedigree & staff performance probe', () => {
  it('measures the new read endpoints', { timeout: 3_600_000 }, async () => {
    const mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 180_000 } });
    const direct = new URL(mongo.getUri());
    const delay = { ms: 0 };
    const proxy = await delayProxy({ host: direct.hostname, port: Number(direct.port) }, delay);
    const uri = `mongodb://127.0.0.1:${(proxy.address() as AddressInfo).port}/farmplus_pedigree_perf`;
    await connectDb(uri);
    await syncRbac();
    await seedAnimalTypes();
    const env = testEnv(uri, { ACCESS_TOKEN_TTL_SECONDS: '3600' });
    const app = createApp(env, {
      notifier: new InMemoryNotifier(),
      video: createVideoProvider(env),
    });
    const httpServer = app.listen(0, '127.0.0.1');
    await new Promise((r) => httpServer.once('listening', r));
    const base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/api/v1`;

    const t0 = Date.now();
    const call = async (method: string, path: string, s: { auth: object }, body?: object) => {
      const res = await (request(app) as any)[method](`/api/v1${path}`).set(s.auth).send(body);
      if (res.status >= 300)
        throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
      return res.body;
    };
    let owner = await createFarmer(app);
    const farmId = await makeFarm(app, owner, 'Pedigree Probe Farm');
    const chicken = await typeIdOf(app, owner, 'chicken');
    const F = `/farms/${farmId}`;
    const breeds = ['pama_ma_lo', 'lueang_hang_khao', 'saigon', 'pama_ramwong', 'chi', 'brazil'];
    let seq = 0;
    const bird = async (sex: 'male' | 'female', i: number) =>
      (
        await call('post', `${F}/animals`, owner, {
          animalCode: `G0-${++seq}`,
          animalTypeId: chicken,
          sex,
          breed: breeds[i % breeds.length],
          rearingType: 'fighting_cock',
          birthDate: daysAgo(3000),
        })
      ).animal.id as string;

    // Generation 0: 8 cocks and 8 hens. Each later generation: every pair hatches 4 chicks (2 cocks, 2 hens).
    let males = await Promise.all(Array.from({ length: 8 }, (_, i) => bird('male', i)));
    let females = await Promise.all(Array.from({ length: 8 }, (_, i) => bird('female', i + 1)));
    let deepest = '';
    for (let gen = 1; gen <= 6; gen++) {
      const nextM: string[] = [];
      const nextF: string[] = [];
      const pairs = Math.min(8, males.length, females.length);
      for (let p = 0; p < pairs; p++) {
        const born = 3000 - gen * 400;
        const rec = await call('post', `${F}/breeding`, owner, {
          damId: females[p],
          sireId: males[(p + gen) % males.length],
          method: 'natural',
          breedingDate: daysAgo(born + 21),
          clutch: { eggsLaid: 6 },
        });
        const done = await call('post', `${F}/breeding/${rec.record.id}/delivery`, owner, {
          date: daysAgo(born),
          clutch: { eggsSet: 6, chicksHatched: 4 },
          offspring: ['male', 'male', 'female', 'female'].map((sex) => ({ register: { sex } })),
        });
        const ids = done.record.delivery.offspring.map((o: any) => o.animal.id);
        nextM.push(ids[0], ids[1]);
        nextF.push(ids[2], ids[3]);
      }
      males = nextM;
      females = nextF;
      deepest = nextM[0]!;
    }
    // Unrelated birds so the farm is not tiny.
    for (let i = 0; i < EXTRA; i += 20)
      await Promise.all(
        Array.from({ length: Math.min(20, EXTRA - i) }, (_, k) =>
          call('post', `${F}/animals`, owner, {
            animalTypeId: chicken,
            sex: (i + k) % 2 ? 'male' : 'female',
            breed: breeds[(i + k) % breeds.length],
          }),
        ),
      );
    // Staff: 10 accepted invitations, 20 pending.
    for (let i = 0; i < 10; i++)
      await addFarmMember(app, owner, farmId, await createUser(app), i % 2 ? 'worker' : 'manager');
    const invitee = await createUser(app);
    for (let i = 0; i < 20; i++)
      await call('post', `${F}/invitations`, owner, {
        email: i === 0 ? invitee.email : (await createUser(app)).email,
        role: 'viewer',
      });
    const founder = (await call('get', `${F}/animals?q=G0-1&pageSize=1`, owner)).items[0].id;
    const seedSeconds = Math.round((Date.now() - t0) / 1000);
    owner = await login(app, owner.email);
    const invited = await login(app, invitee.email);

    let ops = 0;
    mongoose.set('debug', () => {
      ops++;
    });
    const endpoints: { name: string; path: string; who: { accessToken: string } }[] = [
      { name: 'lineage (F6, 3 gens)', path: `${F}/animals/${deepest}/lineage`, who: owner },
      {
        name: 'lineage (F6, 5 gens)',
        path: `${F}/animals/${deepest}/lineage?generations=5`,
        who: owner,
      },
      {
        name: 'lineage (founder, many offspring)',
        path: `${F}/animals/${founder}/lineage`,
        who: owner,
      },
      { name: 'breeding list', path: `${F}/breeding`, who: owner },
      {
        name: 'breeding ?animalId (founder)',
        path: `${F}/breeding?animalId=${founder}`,
        who: owner,
      },
      { name: 'animals ?breedGroup=burmese', path: `${F}/animals?breedGroup=burmese`, who: owner },
      { name: 'members', path: `${F}/members`, who: owner },
      { name: 'farm invitations (PENDING)', path: `${F}/invitations?status=PENDING`, who: owner },
      { name: 'my invitations', path: '/farm-invitations', who: invited },
      { name: 'farms ?relation=owned', path: '/farms?relation=owned', who: owner },
      { name: 'animal-types', path: '/animal-types', who: owner },
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
          const start = performance.now();
          const res = await fetch(`${base}${e.path}`, {
            headers: { authorization: `Bearer ${e.who.accessToken}` },
          });
          const text = await res.text();
          const took = performance.now() - start;
          expect(res.status, `${e.name}: ${text.slice(0, 200)}`).toBe(200);
          if (i >= 2) times.push(took);
          row.bytes = Buffer.byteLength(text);
          row.dbOps = ops;
        }
        row[`${label}P50`] = Math.round(pct(times, 50) * 10) / 10;
        row[`${label}P95`] = Math.round(pct(times, 95) * 10) / 10;
      }
      rows.push(row);
      console.log(
        `${e.name.padEnd(36)} ops ${String(row.dbOps).padStart(3)}  bytes ${String(row.bytes).padStart(7)}  local p50 ${row.localP50} ms p95 ${row.localP95}  rtt${RTT_MS} p50 ${row[`rtt${RTT_MS}P50`]} ms p95 ${row[`rtt${RTT_MS}P95`]} ms`,
      );
    }
    mongoose.set('debug', false);
    const lineage = (await call(
      'get',
      `${F}/animals/${deepest}/lineage?generations=5`,
      owner,
    )) as any;
    console.log(
      `deepest bird: F${lineage.pedigree.animal.filialGeneration}, ${lineage.generation} recorded generations`,
    );
    const out = { when: new Date().toISOString(), runs: RUNS, rttMs: RTT_MS, seedSeconds, rows };
    if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT, JSON.stringify(out, null, 2));
    httpServer.close();
    await mongoose.disconnect();
    proxy.close();
    await mongo.stop();
  });
});
