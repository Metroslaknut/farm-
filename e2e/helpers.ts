import { randomBytes } from 'node:crypto';
import { languageState } from './language';
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import mongoose from 'mongoose';

export const PASSWORD = 'correct horse battery staple';
const api = () => process.env['E2E_API']!;

export interface User {
  id: string;
  email: string;
  token: string;
}

export const uniqueEmail = (p = 'e2e') => `${p}-${randomBytes(4).toString('hex')}@example.test`;

/** Account creation and role grants go through the API / database, exactly like the integration tests; the BROWSER does everything a user does. */
export async function register(
  request: APIRequestContext,
  displayName = 'E2E User',
): Promise<User> {
  const email = uniqueEmail();
  const res = await request.post(`${api()}/api/v1/auth/register`, {
    data: { email, password: PASSWORD, displayName },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  const login = await request.post(`${api()}/api/v1/auth/login`, {
    data: { identifier: email, password: PASSWORD },
  });
  const tokens = (await login.json()).tokens;
  return { id: body.user.id, email, token: tokens.accessToken };
}

let connected = false;
export async function grantRoles(userId: string, roleKeys: string[]): Promise<void> {
  if (!connected) {
    await mongoose.connect(process.env['E2E_MONGODB_URI']!);
    connected = true;
  }
  const db = mongoose.connection.db!;
  for (const key of roleKeys) {
    const role = await db.collection('roles').findOne({ key });
    if (role)
      await db
        .collection('user_roles')
        .updateOne(
          { userId: new mongoose.Types.ObjectId(userId), roleId: role._id },
          { $setOnInsert: { createdAt: new Date() } },
          { upsert: true },
        );
  }
}

export async function closeDb(): Promise<void> {
  if (connected) await mongoose.disconnect();
  connected = false;
}

export const authed = (user: User) => ({ headers: { authorization: `Bearer ${user.token}` } });

/** Sign in through the real sign-in page. */
export async function signIn(page: Page, user: User, then = '/farms'): Promise<void> {
  await page.goto('/farms/sign-in');
  await page.getByLabel('Email or phone').fill(user.email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // A farm owner without a farm is sent straight on to the (mandatory) farm setup; one with a farm lands on its
  // dashboard; anyone else on the farm list.
  await expect(page).toHaveURL(/\/farms(\/new|\/[a-f0-9]{24})?\/?$/);
  if (then !== '/farms') await page.goto(then);
}

export async function newSession(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  // Contexts created by hand do not inherit `use` options: start them in English like the default page.
  const context = await browser.newContext({ storageState: languageState('en') });
  return { context, page: await context.newPage() };
}

/** A seller with a farm and one live listing (review switched off so it is active at once). */
export async function sellerWithListing(request: APIRequestContext, title = 'E2E Swamp Buffalo') {
  const seller = await register(request, 'Somchai Seller');
  await grantRoles(seller.id, ['farm_owner', 'seller']);
  const db = mongoose.connection.db!;
  await db
    .collection('settings')
    .updateOne(
      { key: 'marketplace.requireReview' },
      { $set: { key: 'marketplace.requireReview', value: false } },
      { upsert: true },
    );
  const farm = await request.post(`${api()}/api/v1/farms`, {
    ...authed(seller),
    data: { name: 'Happy E2E Farm' },
  });
  expect(farm.status(), await farm.text()).toBe(201);
  const farmId = (await farm.json()).farm.id as string;
  const types = await (await request.get(`${api()}/api/v1/animal-types`, authed(seller))).json();
  const buffalo =
    types.animalTypes.find((t: { key: string }) => t.key === 'buffalo') ?? types.animalTypes[0];
  const animal = await request.post(`${api()}/api/v1/farms/${farmId}/animals`, {
    ...authed(seller),
    data: {
      animalCode: `E2E-${randomBytes(2).toString('hex')}`,
      animalTypeId: buffalo.id,
      sex: 'female',
    },
  });
  expect(animal.status(), await animal.text()).toBe(201);
  const listing = await request.post(`${api()}/api/v1/farms/${farmId}/listings`, {
    ...authed(seller),
    data: {
      animalId: (await animal.json()).animal.id,
      title,
      askingPriceMinor: 5_000_000,
      negotiable: true,
      photos: [{ url: 'https://cdn.example.test/a.jpg' }],
      deliveryOptions: ['pickup'],
    },
  });
  expect(listing.status(), await listing.text()).toBe(201);
  const listingId = (await listing.json()).listing.id as string;
  const submit = await request.post(
    `${api()}/api/v1/farms/${farmId}/listings/${listingId}/submit`,
    authed(seller),
  );
  expect(submit.status(), await submit.text()).toBe(200);
  expect((await submit.json()).listing.status).toBe('ACTIVE');
  return { seller, farmId, listingId, title };
}
