import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import mongoose from 'mongoose';
import { authed, closeDb, grantRoles, register, signIn } from '../helpers';

test.afterAll(closeDb);

/**
 * Business workflows driven through the real Web UI, then checked through the API (and so the database): a farm
 * record, a community post and a shop purchase. Ids come from the API; every user action happens in the browser.
 */
const api = () => process.env['E2E_API']!;

test('WF-UI-B06 an owner records a weighing in the browser; the API returns it and the history shows it', async ({
  page,
  request,
}) => {
  const owner = await register(request, 'Weighing Owner');
  await grantRoles(owner.id, ['farm_owner']);
  const farm = await request.post(`${api()}/api/v1/farms`, {
    ...authed(owner),
    data: { name: 'Weighing Farm' },
  });
  const farmId = (await farm.json()).farm.id as string;
  const types = await (await request.get(`${api()}/api/v1/animal-types`, authed(owner))).json();
  const buffalo = types.animalTypes.find((t: { key: string }) => t.key === 'buffalo');
  const code = `W-${randomBytes(2).toString('hex')}`;
  const animal = await request.post(`${api()}/api/v1/farms/${farmId}/animals`, {
    ...authed(owner),
    data: { animalCode: code, animalTypeId: buffalo.id, sex: 'female', birthDate: '2024-01-01' },
  });
  const animalId = (await animal.json()).animal.id as string;

  await signIn(page, owner, `/farms/${farmId}/weights/new`);
  await page.getByLabel('Animal').selectOption({ label: code });
  await page.getByLabel('Weight (kg)').fill('312.5');
  await page.getByRole('button', { name: 'Save weight' }).click();
  await expect(page.getByText('312.5 kg', { exact: false }).first()).toBeVisible();

  const weights = await (
    await request.get(`${api()}/api/v1/farms/${farmId}/weights?animalId=${animalId}`, authed(owner))
  ).json();
  expect(weights.items.map((w: { weightKg: number }) => w.weightKg)).toEqual([312.5]);
  const history = await (
    await request.get(
      `${api()}/api/v1/farms/${farmId}/animals/${animalId}/history?types=weight`,
      authed(owner),
    )
  ).json();
  expect(history.items.length).toBeGreaterThan(0);
});

test('WF-UI-C01 a member publishes a post in the browser; another member sees it in the feed', async ({
  page,
  request,
}) => {
  const author = await register(request, 'Post Author');
  const text = `Morning milking went well ${randomBytes(3).toString('hex')}`;
  await signIn(page, author, '/community');
  await page.getByLabel('Share with the community').fill(text);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByText(text)).toBeVisible();

  const reader = await register(request, 'Feed Reader');
  const feed = await (await request.get(`${api()}/api/v1/posts?limit=20`, authed(reader))).json();
  const post = feed.items.find(
    (p: { text?: string; body?: string }) => (p.text ?? p.body) === text,
  );
  expect(post, JSON.stringify(feed.items.slice(0, 2))).toBeTruthy();
  expect(post.author.id).toBe(author.id);
});

test('WF-UI-H03 a buyer adds a shop product to the cart, checks out and pays in the browser; stock and order agree', async ({
  page,
  request,
}) => {
  const seller = await register(request, 'Feed Seller');
  await grantRoles(seller.id, ['farm_owner', 'seller']);
  const farm = await request.post(`${api()}/api/v1/farms`, {
    ...authed(seller),
    data: { name: 'Feed Shop Farm' },
  });
  const farmId = (await farm.json()).farm.id as string;
  const title = `Dairy feed ${randomBytes(2).toString('hex')}`;
  const created = await request.post(`${api()}/api/v1/farms/${farmId}/products`, {
    ...authed(seller),
    data: {
      categoryKey: 'feed',
      title,
      description: 'Balanced pellet feed for lactating cattle.',
      sku: `SKU-${randomBytes(3).toString('hex')}`,
      unit: 'bag',
      priceMinor: 120_000,
      stock: 10,
      photos: [{ url: 'https://cdn.example.test/p1.jpg' }],
      deliveryOptions: ['pickup'],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const productId = (await created.json()).product.id as string;
  // Precondition: moderator approval needs an MFA-enrolled staff session, which this browser suite does not create;
  // the approval itself is covered by the API tests. Mark it approved in the test database.
  await mongoose.connection
    .db!.collection('products')
    .updateOne(
      { _id: new mongoose.Types.ObjectId(productId) },
      { $set: { status: 'ACTIVE', 'review.approvedAt': new Date() } },
    );

  const buyer = await register(request, 'Feed Buyer');
  await signIn(page, buyer, `/shop/product/${productId}`);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await page.getByLabel('Quantity').fill('3');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  // Wait for the confirmation, as a user would: leaving the page earlier cancels the request.
  await expect(page.getByText('Added to your cart.')).toBeVisible();
  await page.goto('/shop/cart');
  await page.getByLabel('I collect it from the seller').check();
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page).toHaveURL(/\/market\/orders\/[a-f0-9]{24}/);
  const orderId = new URL(page.url()).pathname.split('/').pop()!;
  await page.getByRole('button', { name: /^Pay ฿3,600\.00/ }).click();
  await page.getByRole('button', { name: 'Simulate successful payment' }).click();
  await expect(page.getByText('PAID', { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  const orderOf = async () =>
    (await (await request.get(`${api()}/api/v1/orders/${orderId}`, authed(buyer))).json()).order;
  await expect.poll(async () => (await orderOf()).status, { timeout: 15_000 }).toBe('PAID');
  const order = await orderOf();
  expect(order.totals.grandTotalMinor).toBe(360_000);
  const product = (
    await (
      await request.get(`${api()}/api/v1/farms/${farmId}/products/${productId}`, authed(seller))
    ).json()
  ).product;
  expect(product.inventory).toMatchObject({ stock: 7, reserved: 0 });
});
