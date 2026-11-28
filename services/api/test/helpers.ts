import type { Server } from 'node:http';
import type { PhotoStorage } from '../src/modules/animals/photo-storage';
import type { Express } from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { apiEnvSchema, parseEnv, type ApiEnv } from '@farmplus/config/server';
import { createApp, createContext } from '../src/app';
import { connectDb, disconnectDb } from '../src/db/connect';
import { hashPassword } from '../src/lib/password';
import { currentStep, totpAt } from '../src/lib/totp';
import { Role, User, UserRole } from '../src/models';
import { seedAnimalTypes } from '../src/modules/animal-types/seed';
import { seedProductCategories } from '../src/modules/products/compliance';
import { MockAiProvider, createAiProvider } from '../src/modules/ai/provider';
import { MockPaymentProvider, createPaymentProvider } from '../src/modules/finance/provider';
import { createVideoProvider, type VideoProvider } from '../src/modules/media/provider';
import { syncRbac } from '../src/rbac/seed';
import { InMemoryNotifier } from '../src/services/notifier';
import { thaiToday } from '@farmplus/validation';

export const PASSWORD = 'correct horse battery staple';
export const WEBHOOK_SECRET = 'test-webhook-secret-1234567890';
export const PAYMENT_SECRET = 'test-payment-secret-1234567890';
export const SHIPPING_SECRET = 'test-shipping-secret-1234567890';

export function testEnv(mongoUri: string, overrides: Record<string, string> = {}): ApiEnv {
  return parseEnv(apiEnvSchema, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    MONGODB_URI: mongoUri,
    JWT_ACCESS_SECRET: 'test-only-secret-test-only-secret-1234567890',
    MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    RATE_LIMIT_ENABLED: 'false',
    VIDEO_WEBHOOK_SECRET: WEBHOOK_SECRET,
    PAYMENT_WEBHOOK_SECRET: PAYMENT_SECRET,
    SHIPPING_WEBHOOK_SECRET: SHIPPING_SECRET,
    SHIPPING_PROVIDER: 'mock',
    PAYMENT_PROVIDER: 'mock',
    AI_PROVIDER: 'mock',
    VIDEO_MAX_UPLOAD_MB: '5',
    VIDEO_MAX_DURATION_SECONDS: '60',
    ...overrides,
  });
}

export interface TestHarness {
  env: ApiEnv;
  app: Express;
  notifier: InMemoryNotifier;
  ctx: ReturnType<typeof createContext>;
  /** The video provider shared by `app` and `ctx` (the in-memory mock unless a test injects its own). */
  video: VideoProvider;
  /** The mock payment provider shared by `app` and `ctx` (null when a test turns payments off). */
  payments: MockPaymentProvider | null;
  /** The mock AI provider shared by `app` and `ctx` (null when a test turns AI off). */
  ai: MockAiProvider | null;
  stop(): Promise<void>;
}

// Mongoose is a process-wide singleton, so harnesses within one test file share one in-memory MongoDB
// (each still gets its own env/app/notifier). The server is stopped when the last harness stops.
let shared: { mongo: MongoMemoryServer; refs: number } | undefined;

/**
 * Start the in-memory MongoDB. With many test files starting at once, two can be handed the same free port before
 * either binds it ("Port … already in use"): that is retried with a short random pause; anything else fails at once.
 */
async function startMongo(): Promise<MongoMemoryServer> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await MongoMemoryServer.create();
    } catch (error) {
      const portTaken = /already in use/i.test(String((error as Error | undefined)?.message));
      if (!portTaken || attempt >= 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt + Math.random() * 350));
    }
  }
}

export async function startHarness(
  overrides: Record<string, string> = {},
  deps: { video?: (env: ApiEnv) => VideoProvider; photos?: PhotoStorage | null } = {},
): Promise<TestHarness> {
  if (!shared) {
    const mongo = await startMongo();
    await connectDb(mongo.getUri('farmplus_test'));
    await syncRbac();
    await seedAnimalTypes();
    await seedProductCategories();
    shared = { mongo, refs: 0 };
  }
  shared.refs++;
  const env = testEnv(shared.mongo.getUri('farmplus_test'), overrides);
  const notifier = new InMemoryNotifier();
  const video = deps.video ? deps.video(env) : createVideoProvider(env);
  const created = createPaymentProvider(env);
  const payments = created instanceof MockPaymentProvider ? created : null;
  const aiCreated = createAiProvider(env);
  const ai = aiCreated instanceof MockAiProvider ? aiCreated : null;
  return {
    env,
    app: createApp(env, { notifier, video, payments, ai, photos: deps.photos }),
    ctx: createContext(env, { notifier, video, payments, ai, photos: deps.photos }),
    video,
    payments,
    ai,
    notifier,
    async stop() {
      if (!shared || --shared.refs > 0) return;
      await disconnectDb();
      await shared.mongo.stop();
      shared = undefined;
    },
  };
}

export type { Server };

let counter = 0;
export const uniqueEmail = (prefix = 'user'): string => `${prefix}${++counter}@example.test`;

export interface Session {
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  auth: { Authorization: string };
}

export async function register(
  app: Express,
  email = uniqueEmail(),
  password = PASSWORD,
): Promise<{ id: string; email: string }> {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password, displayName: 'Test User' });
  if (res.status !== 201)
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.user.id, email };
}

export async function login(app: Express, email: string, password = PASSWORD): Promise<Session> {
  const res = await request(app).post('/api/v1/auth/login').send({ identifier: email, password });
  if (res.status !== 200 || res.body.status !== 'authenticated') {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return toSession(res.body, email);
}

function toSession(
  body: { user: { id: string }; tokens: { accessToken: string; refreshToken: string } },
  email: string,
): Session {
  return {
    id: body.user.id,
    email,
    accessToken: body.tokens.accessToken,
    refreshToken: body.tokens.refreshToken,
    auth: { Authorization: `Bearer ${body.tokens.accessToken}` },
  };
}

/** Registers, logs in and returns a plain (non-privileged) user session. */
export async function createUser(app: Express): Promise<Session> {
  const { email } = await register(app);
  return login(app, email);
}

export interface Staff extends Session {
  password: string;
  totpSecret: string;
  recoveryCodes: string[];
}

/**
 * Creates a staff account directly in the database (there is intentionally no API for self-serving
 * admin roles), then enrols MFA through the real API so the session is MFA-verified.
 */
export async function createStaff(
  app: Express,
  roleKeys: string[],
  options: { enrollMfa?: boolean } = {},
): Promise<Staff> {
  const email = uniqueEmail('staff');
  const user = await User.create({
    email,
    displayName: `Staff ${roleKeys.join(',')}`,
    passwordHash: await hashPassword(PASSWORD),
    status: 'active',
  });
  const roles = await Role.find({ key: { $in: [...roleKeys, 'buyer'] } });
  await UserRole.insertMany(roles.map((role) => ({ userId: user._id, roleId: role._id })));

  const session = await login(app, email);
  let totpSecret = '';
  let recoveryCodes: string[] = [];
  if (options.enrollMfa !== false) {
    const setup = await request(app).post('/api/v1/auth/mfa/setup').set(session.auth);
    totpSecret = setup.body.secret;
    const enable = await request(app)
      .post('/api/v1/auth/mfa/enable')
      .set(session.auth)
      .send({ code: totpAt(totpSecret, currentStep()) });
    if (enable.status !== 200) throw new Error(`mfa enable failed: ${JSON.stringify(enable.body)}`);
    recoveryCodes = enable.body.recoveryCodes;
  }
  return { ...session, password: PASSWORD, totpSecret, recoveryCodes };
}

export { toSession };

let roleCounter = 0;
/** Creates a custom role holding exactly `permissions` (via the real admin API) and a staff user with it. */
export async function createStaffWithPermissions(
  app: Express,
  root: Session,
  permissions: string[],
  options: { enrollMfa?: boolean } = {},
): Promise<Staff> {
  const key = `test_role_${++roleCounter}`;
  const res = await request(app)
    .post('/api/v1/admin/roles')
    .set(root.auth)
    .send({ key, name: key, permissions });
  if (res.status !== 201)
    throw new Error(`role create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return createStaff(app, [key], options);
}

// ---------------------------------------------------------------------------
// Farm helpers
// ---------------------------------------------------------------------------
/** A signed-in user holding the farm_owner role (normally granted when a farm-owner registration is approved). */
export async function createFarmer(app: Express): Promise<Session> {
  const { id, email } = await register(app);
  const role = await Role.findOne({ key: 'farm_owner' });
  await UserRole.create({ userId: id, roleId: role!._id });
  return login(app, email);
}

export async function makeFarm(app: Express, owner: Session, name = 'Happy Farm'): Promise<string> {
  const res = await request(app).post('/api/v1/farms').set(owner.auth).send({ name });
  if (res.status !== 201)
    throw new Error(`farm create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.farm.id;
}

export async function typeIdOf(app: Express, session: Session, key = 'buffalo'): Promise<string> {
  const res = await request(app).get('/api/v1/animal-types').set(session.auth);
  const type = res.body.animalTypes.find((t: { key: string }) => t.key === key);
  if (!type) throw new Error(`animal type ${key} not found`);
  return type.id;
}

/**
 * Add `user` to `farmId` through the real API: the owner invites, the person accepts (farm owners cannot add people
 * directly). Returns the new membership id.
 */
export async function addFarmMember(
  app: Express,
  owner: Session,
  farmId: string,
  user: Session,
  role: 'manager' | 'worker' | 'viewer',
  permissions?: string[],
): Promise<string> {
  const invite = await request(app)
    .post(`/api/v1/farms/${farmId}/invitations`)
    .set(owner.auth)
    .send({ email: user.email, role, ...(permissions ? { permissions } : {}) });
  if (invite.status !== 201)
    throw new Error(`invite failed: ${invite.status} ${JSON.stringify(invite.body)}`);
  const accept = await request(app)
    .post(`/api/v1/farm-invitations/${invite.body.invitation.id}/accept`)
    .set(user.auth);
  if (accept.status !== 200)
    throw new Error(`accept failed: ${accept.status} ${JSON.stringify(accept.body)}`);
  const members = await request(app).get(`/api/v1/farms/${farmId}/members`).set(owner.auth);
  const member = (members.body.members as { id: string; userId: string }[]).find(
    (m) => m.userId === user.id,
  );
  if (!member) throw new Error('member not found after accepting the invitation');
  return member.id;
}

// ---------------------------------------------------------------------------
// Part 08 helpers
// ---------------------------------------------------------------------------
/**
 * Calendar days counted from TODAY IN THAILAND, the day the API validates against (`thaiToday`). Counting from the UTC
 * date was off by one between 17:00 and 24:00 UTC: "tomorrow" in UTC was already today in Bangkok, so future-date checks
 * accepted it and those tests failed whenever CI ran at night Thai time.
 */
const thaiDayOffset = (n: number): string => {
  const day = new Date(`${thaiToday()}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + n);
  return day.toISOString().slice(0, 10);
};
export const daysAgo = (n: number): string => thaiDayOffset(-n);
export const daysAhead = (n: number): string => thaiDayOffset(n);

export interface FarmSetup {
  owner: Session;
  manager: Session;
  worker: Session;
  viewer: Session;
  farmId: string;
  buffalo: string;
  cattle: string;
}

/** A farm with one member of each role, plus the seeded buffalo/cattle type ids. */
export async function setupFarm(app: Express): Promise<FarmSetup> {
  const owner = await createFarmer(app);
  const farmId = await makeFarm(app, owner, 'Records Farm');
  const [manager, worker, viewer] = [
    await createUser(app),
    await createUser(app),
    await createUser(app),
  ];
  await addFarmMember(app, owner, farmId, manager, 'manager');
  await addFarmMember(app, owner, farmId, worker, 'worker');
  await addFarmMember(app, owner, farmId, viewer, 'viewer');
  return {
    owner,
    manager,
    worker,
    viewer,
    farmId,
    buffalo: await typeIdOf(app, owner, 'buffalo'),
    cattle: await typeIdOf(app, owner, 'cattle'),
  };
}

export async function mkAnimal(
  app: Express,
  who: Session,
  farmId: string,
  body: Record<string, unknown>,
): Promise<{ id: string; animalCode: string }> {
  const res = await request(app).post(`/api/v1/farms/${farmId}/animals`).set(who.auth).send(body);
  if (res.status !== 201)
    throw new Error(`animal create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.animal;
}
