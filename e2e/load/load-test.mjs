#!/usr/bin/env node
/**
 * Load and performance test. Starts a throw-away stack (in-memory MongoDB + the API), seeds realistic volume through the
 * PUBLIC API, then drives each scenario with autocannon and prints a table (also written to e2e/load/results/).
 *
 *   node e2e/load/load-test.mjs            # default sizes (~ a minute)
 *   LOAD_ANIMALS=20000 LOAD_DURATION=20 node e2e/load/load-test.mjs
 *
 * Numbers depend on the machine and on an in-memory MongoDB on the same host, so they show RELATIVE cost and regressions —
 * not production capacity. Re-run against staging (point LOAD_API at it, with LOAD_TOKEN) for sizing.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import autocannon from 'autocannon';
import { MongoMemoryServer } from 'mongodb-memory-server';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = process.env.LOAD_API_PORT ?? '4320';
const BASE = `http://127.0.0.1:${PORT}`;
const ANIMALS = Number(process.env.LOAD_ANIMALS ?? 3000);
const LISTINGS = Number(process.env.LOAD_LISTINGS ?? 400);
const DURATION = Number(process.env.LOAD_DURATION ?? 8);
const PASSWORD = 'correct horse battery staple';

const mongo = await MongoMemoryServer.create();
const uri = mongo.getUri('farmplus_load');
const api = spawn(join(ROOT, 'services/api/node_modules/.bin/tsx'), ['src/server.ts'], {
  cwd: join(ROOT, 'services/api'),
  env: {
    PATH: process.env.PATH ?? '',
    NODE_ENV: 'development',
    API_PORT: PORT,
    MONGODB_URI: uri,
    JWT_ACCESS_SECRET: randomBytes(48).toString('base64'),
    MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    RATE_LIMIT_ENABLED: 'false',
    LOG_LEVEL: 'error',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let apiErrors = 0;
let realErrorLines = 0;
const stderrSample = [];
// Node deprecation warnings are not errors; structured error log lines ({"level":"error"…}) are.
const apiStderrLinesThatAreNotWarnings = () => realErrorLines;
api.stderr.on('data', (d) => {
  for (const line of String(d).split('\n').filter(Boolean)) {
    apiErrors++;
    if (/"level":"error"/.test(line)) {
      realErrorLines++;
      if (stderrSample.length < 5) stderrSample.push(line.slice(0, 600));
    }
  }
});
const stop = async () => {
  api.kill('SIGTERM');
  await mongo.stop();
};
process.on('SIGINT', () => stop().then(() => process.exit(130)));

async function waitReady() {
  for (let i = 0; i < 180; i++) {
    try {
      if ((await fetch(`${BASE}/ready`)).ok) return;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('API did not start');
}
const call = async (method, path, token, body, headers = {}) => {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
};
async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

try {
  await waitReady();

  // --- seed through the public API ---------------------------------------------------------------------------------
  const mongoose = (await import(join(ROOT, 'services/api/node_modules/mongoose/index.js')))
    .default;
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const email = `load-${randomBytes(3).toString('hex')}@example.test`;
  await call('POST', '/auth/register', null, {
    email,
    password: PASSWORD,
    displayName: 'Load Seller',
  });
  const userId = (await db.collection('users').findOne({ email }))._id;
  for (const key of ['farm_owner', 'seller']) {
    const role = await db.collection('roles').findOne({ key });
    await db.collection('user_roles').insertOne({ userId, roleId: role._id });
  }
  await db
    .collection('settings')
    .updateOne(
      { key: 'marketplace.requireReview' },
      { $set: { key: 'marketplace.requireReview', value: false } },
      { upsert: true },
    );
  await db
    .collection('settings')
    .updateOne(
      { key: 'chat.messagesPerMinute' },
      { $set: { key: 'chat.messagesPerMinute', value: 100000 } },
      { upsert: true },
    );
  const login = async (e) =>
    (await call('POST', '/auth/login', null, { identifier: e, password: PASSWORD })).tokens
      .accessToken;
  const seller = await login(email);
  const farmId = (await call('POST', '/farms', seller, { name: 'Load Farm' })).farm.id;
  const types = (await call('GET', '/animal-types', seller)).animalTypes;
  const buffalo = types.find((t) => t.key === 'buffalo') ?? types[0];
  const t0 = Date.now();
  const animalIds = [];
  await pool(
    Array.from({ length: ANIMALS }, (_, i) => i),
    40,
    async (i) => {
      const a = await call('POST', `/farms/${farmId}/animals`, seller, {
        animalCode: `L-${String(i).padStart(6, '0')}`,
        animalTypeId: buffalo.id,
        sex: i % 2 ? 'male' : 'female',
      });
      if (animalIds.length < LISTINGS) animalIds.push(a.animal.id);
    },
  );
  await pool(animalIds, 30, async (animalId) => {
    const l = await call('POST', `/farms/${farmId}/listings`, seller, {
      animalId,
      title: `Load listing ${animalId.slice(-6)}`,
      askingPriceMinor: 3_000_000 + Math.floor(Math.random() * 3_000_000),
      negotiable: true,
      photos: [{ url: 'https://cdn.example.test/a.jpg' }],
      deliveryOptions: ['pickup'],
    });
    await call('POST', `/farms/${farmId}/listings/${l.listing.id}/submit`, seller);
  });
  const buyerEmail = `buyer-${randomBytes(3).toString('hex')}@example.test`;
  await call('POST', '/auth/register', null, {
    email: buyerEmail,
    password: PASSWORD,
    displayName: 'Load Buyer',
  });
  const buyer = await login(buyerEmail);
  const listings = (await call('GET', '/marketplace/listings?limit=1', buyer)).items ?? [];
  const conv = await call('POST', '/conversations', buyer, {
    listingId: listings[0]?.id,
    message: 'hello',
  }).catch(() => null);
  console.log(
    `seeded ${ANIMALS} animals, ${animalIds.length} listings in ${((Date.now() - t0) / 1000).toFixed(1)} s`,
  );
  await mongoose.disconnect();

  // --- scenarios ------------------------------------------------------------------------------------------------------
  const auth = (t) => ({ authorization: `Bearer ${t}` });
  const scenarios = [
    { name: 'GET /health (framework baseline)', url: '/health', connections: 50 },
    { name: 'GET /ready (database ping)', url: '/ready', connections: 50 },
    {
      name: 'POST /auth/login (password hashing)',
      url: '/api/v1/auth/login',
      method: 'POST',
      body: JSON.stringify({ identifier: email, password: PASSWORD }),
      headers: { 'content-type': 'application/json' },
      connections: 10,
    },
    {
      name: 'GET unread counters',
      url: '/api/v1/notifications/unread-count',
      headers: auth(buyer),
      connections: 50,
    },
    {
      name: `GET animals page (farm of ${ANIMALS})`,
      url: `/api/v1/farms/${farmId}/animals?pageSize=20`,
      headers: auth(seller),
      connections: 40,
    },
    {
      name: `GET marketplace search (${animalIds.length} listings)`,
      url: '/api/v1/marketplace/listings?limit=20&sort=newest&q=Load',
      headers: auth(buyer),
      connections: 40,
    },
    {
      name: 'GET farm dashboard (cached 60 s)',
      url: `/api/v1/farms/${farmId}/dashboard`,
      headers: auth(seller),
      connections: 20,
    },
    {
      name: 'GET farm dashboard (fresh, every request aggregates)',
      url: `/api/v1/farms/${farmId}/dashboard?fresh=true`,
      headers: auth(seller),
      connections: 10,
    },
    ...(conv?.conversation
      ? [
          {
            name: 'POST chat message (write + notification + unread)',
            url: `/api/v1/conversations/${conv.conversation.id}/messages`,
            method: 'POST',
            headers: { ...auth(buyer), 'content-type': 'application/json' },
            body: JSON.stringify({ body: 'load test message' }),
            connections: 20,
            allow: [429], // by design: at most 120 messages per user per minute
          },
        ]
      : []),
  ];
  const rows = [];
  for (const s of scenarios) {
    const res = await autocannon({
      url: `${BASE}${s.url}`,
      method: s.method ?? 'GET',
      headers: s.headers,
      body: s.body,
      connections: s.connections,
      duration: DURATION,
    });
    const codes = Object.fromEntries(
      Object.entries(res.statusCodeStats ?? {}).map(([c, v]) => [c, v.count]),
    );
    const unexpected = Object.entries(codes)
      .filter(([c]) => !c.startsWith('2') && !(s.allow ?? []).includes(Number(c)))
      .reduce((n, [, v]) => n + v, 0);
    rows.push({
      scenario: s.name,
      statusCodes: codes,
      unexpectedStatus: unexpected,
      connections: s.connections,
      rps: Math.round(res.requests.average),
      p50: res.latency.p50,
      p97_5: res.latency.p97_5,
      p99: res.latency.p99,
      max: res.latency.max,
      ok2xx: res['2xx'],
      non2xx: res.non2xx,
      errors: res.errors,
      timeouts: res.timeouts,
    });
    console.log(
      `${s.name.padEnd(58)} ${String(Math.round(res.requests.average)).padStart(6)} req/s  p50 ${res.latency.p50} ms  p99 ${res.latency.p99} ms  unexpected-status ${unexpected}  errors ${res.errors}${s.allow ? `  (statuses ${JSON.stringify(codes)})` : ''}`,
    );
  }
  const health = await fetch(`${BASE}/ready`);
  if (stderrSample.length) console.log('\nfirst API error lines:\n' + stderrSample.join('\n'));
  console.log(
    `\nAPI still ready after the run: ${health.ok}; stderr lines: ${apiErrors}, of which error logs: ${realErrorLines}`,
  );
  mkdirSync(join(ROOT, 'e2e/load/results'), { recursive: true });
  const out = {
    when: new Date().toISOString(),
    node: process.version,
    cpus: (await import('node:os')).cpus().length,
    animals: ANIMALS,
    listings: animalIds.length,
    durationSeconds: DURATION,
    rows,
    apiStderrLines: apiErrors,
    apiErrorLogLines: realErrorLines,
    readyAfter: health.ok,
  };
  writeFileSync(join(ROOT, 'e2e/load/results/latest.json'), `${JSON.stringify(out, null, 2)}\n`);
  const realErrors = apiStderrLinesThatAreNotWarnings();
  const bad = rows.filter((r) => r.errors > 0 || r.timeouts > 0 || r.unexpectedStatus > 0);
  if (bad.length || realErrors > 0) {
    console.error(
      '\nFAILED: errors or non-2xx responses under load:',
      bad.map((b) => b.scenario).join('; '),
    );
    process.exitCode = 1;
  }
} finally {
  await stop();
}
