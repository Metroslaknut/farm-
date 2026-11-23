import { expect, test, type Page } from '@playwright/test';
import mongoose from 'mongoose';
import { buildHeaders } from '../../apps/web/scripts/render-headers.mjs';
import { languageState } from '../language';
import { authed, closeDb, grantRoles, register, signIn, type User } from '../helpers';

/**
 * Real-browser coverage for the staging QA fixes of 2026-11-22 (PR #4): the farm form's address data and map under the
 * production Content-Security-Policy, weight precision, readable record history, archiving a farm, the 404 page and
 * Thai names in the market and shop filters. The phone-width checks are in `staging-qa-mobile.spec.ts`.
 */
test.afterAll(closeDb);

const api = () => process.env['E2E_API']!;
const WEB = `http://localhost:${process.env['E2E_WEB_PORT'] ?? '5310'}`;
const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** A farm owner with a farm and one buffalo. */
async function ownerWithAnimal(request: Parameters<typeof register>[0], name: string) {
  const owner = await register(request, name);
  await grantRoles(owner.id, ['farm_owner']);
  const farm = await request.post(`${api()}/api/v1/farms`, {
    ...authed(owner),
    data: { name: `${name} Farm` },
  });
  expect(farm.status(), await farm.text()).toBe(201);
  const farmId = (await farm.json()).farm.id as string;
  const types = await (await request.get(`${api()}/api/v1/animal-types`, authed(owner))).json();
  const buffalo = types.animalTypes.find((t: { key: string }) => t.key === 'buffalo').id as string;
  const animal = await request.post(`${api()}/api/v1/farms/${farmId}/animals`, {
    ...authed(owner),
    data: { animalTypeId: buffalo, sex: 'female' },
  });
  expect(animal.status(), await animal.text()).toBe(201);
  return { owner, farmId, animalId: (await animal.json()).animal.id as string };
}

/** Sign in (the helper uses the English labels), then switch the UI to Thai and open `path`. */
async function signInThai(page: Page, user: User, path: string) {
  await signIn(page, user);
  await page.evaluate(() => localStorage.setItem('farmplus.locale', 'th'));
  await page.goto(path);
}

// ---------------------------------------------------------------------------------------------------------------------
// The production CSP, as far as the Vite dev server allows
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The CSP `render-headers.mjs` writes for production, with only what the dev server needs on top: its inline
 * React-refresh preamble and React's development build ('unsafe-inline' / 'unsafe-eval' scripts), its HMR websocket, and no `upgrade-insecure-requests` (the test site
 * is plain http on localhost). Every other directive — notably `connect-src` and `frame-src` — is the production one.
 */
function devCsp(): string {
  const { csp } = buildHeaders({ html: '', apiBase: '' });
  return csp
    .split('; ')
    .filter((d) => d !== 'upgrade-insecure-requests')
    .map((d) => {
      // Dev only: the refresh preamble is inline and React's development build uses eval for its debug stacks.
      if (d.startsWith('script-src')) return `${d} 'unsafe-inline' 'unsafe-eval'`;
      if (d.startsWith('connect-src')) return `${d} ws://localhost:*`;
      return d;
    })
    .join('; ');
}

/** Serves every page of the site with `devCsp()` and records CSP violations in `window.__csp`. */
async function enforceCsp(page: Page): Promise<() => Promise<string[]>> {
  const csp = devCsp();
  await page.route(
    (url) => url.origin === WEB,
    async (route) => {
      if (route.request().resourceType() !== 'document') return route.fallback();
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'content-security-policy': csp },
      });
    },
  );
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { __csp: string[] }).__csp.push(
        `${e.violatedDirective} ${e.blockedURI}`,
      ),
    );
  });
  const console: string[] = [];
  page.on('console', (m) => {
    if (/Content.Security.Policy/i.test(m.text())) console.push(m.text());
  });
  return async () => [
    ...((await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp)) ?? []),
    ...console,
  ];
}

/** Address dataset and map tiles are third-party: answer them locally (the CSP is checked before routing). */
async function stubThirdParties(page: Page) {
  const data = {
    province: [{ id: 'p1', name_local: 'ขอนแก่น', parent_id: null }],
    district: [{ id: 'd1', name_local: 'เมืองขอนแก่น', parent_id: 'p1' }],
    subdistrict: [
      {
        id: 's1',
        name_local: 'ในเมือง',
        parent_id: 'd1',
        postal_code: '40000',
        lat: 16.43,
        lon: 102.83,
      },
    ],
  };
  // One file per level, as FarmFormPage reads them (`/api/v1/th/<level>.json` → `{ entities }`).
  await page.route('https://api.openadmindata.org/**', (route) => {
    const level = /\/th\/(province|district|subdistrict)\.json$/.exec(
      new URL(route.request().url()).pathname,
    )?.[1];
    return level
      ? route.fulfill({
          json: { entities: data[level as keyof typeof data] },
          headers: { 'access-control-allow-origin': '*' },
        })
      : route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' } });
  });

  await page.route('https://www.openstreetmap.org/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body><p id="osm-stub">map tiles</p></body></html>',
    }),
  );
}

test('farm setup: province → district → sub-district, the map loads and takes a pin, with no CSP violation', async ({
  page,
  request,
}) => {
  const owner = await register(request, 'Address Picker');
  await grantRoles(owner.id, ['farm_owner']);
  const violations = await enforceCsp(page);
  await stubThirdParties(page);
  // A farm owner without a farm is sent to the setup.
  await signIn(page, owner, '/farms/new');
  await expect(page.getByRole('heading', { name: 'Set up your farm' })).toBeVisible();
  await page.getByLabel('Farm name').fill('CSP Checked Farm');
  await page.getByRole('button', { name: 'Next' }).click();

  await page.getByLabel('Province', { exact: true }).selectOption('ขอนแก่น');
  await page.getByLabel('District', { exact: true }).selectOption('เมืองขอนแก่น');
  await page.getByLabel('Sub-district', { exact: true }).selectOption('ในเมือง');
  await expect(page.getByLabel('Postal code')).toHaveValue('40000');
  // The map zooms to the chosen sub-district (16.43, 102.83): a box of ±0.2° longitude and ±0.15° latitude.
  const src = await page
    .locator('iframe[title="Map for selecting farm location"]')
    .getAttribute('src');
  const [west, south, east, north] = new URL(src!).searchParams.get('bbox')!.split(',').map(Number);
  expect([east! - west!, north! - south!].map((v) => v.toFixed(2))).toEqual(['0.40', '0.30']);
  expect([((west! + east!) / 2).toFixed(2), ((south! + north!) / 2).toFixed(2)]).toEqual([
    '102.83',
    '16.43',
  ]);
  await expect(page.getByText('Address data could not be loaded')).toHaveCount(0);
  await expect(
    page.frameLocator('iframe[title="Map for selecting farm location"]').locator('#osm-stub'),
  ).toHaveText('map tiles');
  await page.getByRole('button', { name: 'Click map to place farm location pin' }).click();
  await expect(page.getByText(/📍 \d+\.\d{6}, \d+\.\d{6}/)).toBeVisible();
  expect(await violations()).toEqual([]);
});

test('growth: 1.85 kg is shown as recorded, and the change is the real difference', async ({
  page,
  request,
}) => {
  const { owner, farmId, animalId } = await ownerWithAnimal(request, 'Precise Weigher');
  for (const [daysAgo, kg] of [
    [20, 1.6],
    [10, 1.85],
  ] as const) {
    const w = await request.post(`${api()}/api/v1/farms/${farmId}/weights`, {
      ...authed(owner),
      data: { animalId, weighedOn: isoDaysAgo(daysAgo), weightKg: kg },
    });
    expect(w.status(), await w.text()).toBe(201);
  }
  await signIn(page, owner, `/farms/${farmId}/animals/${animalId}/growth`);
  const table = page.getByRole('table', { name: 'Weighings' });
  await expect(table.getByRole('cell', { name: '1.85', exact: true }).first()).toBeVisible();
  await expect(table.getByRole('cell', { name: '0.25', exact: true }).first()).toBeVisible();
  await expect(table.getByRole('cell', { name: '1.9', exact: true })).toHaveCount(0);
  await expect(page.getByText('0.25 kg', { exact: true })).toBeVisible();
});

test('record history in Thai: field labels and formatted values, not raw field names', async ({
  browser,
  request,
}) => {
  const { owner, farmId } = await ownerWithAnimal(request, 'History Reader');
  const created = await request.post(`${api()}/api/v1/farms/${farmId}/expenses`, {
    ...authed(owner),
    data: {
      category: 'feed',
      expenseDate: isoDaysAgo(5),
      amount: 123.45,
      description: 'Rice bran',
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const id = (await created.json()).record.id as string;
  const corrected = await request.post(
    `${api()}/api/v1/farms/${farmId}/expenses/${id}/corrections`,
    {
      ...authed(owner),
      data: { reason: 'Receipt total', changes: { amount: 150, category: 'veterinary' } },
    },
  );
  expect(corrected.status(), await corrected.text()).toBe(200);

  const ctx = await browser.newContext({ storageState: languageState('en') });
  const page = await ctx.newPage();
  await signInThai(page, owner, `/farms/${farmId}/expenses/${id}`);
  const history = page.getByRole('heading', { name: 'ประวัติการเปลี่ยนแปลง' }).locator('..');
  await expect(history.getByText('จำนวนเงิน (บาท): ฿123.45 → ฿150.00')).toBeVisible();
  await expect(history.getByText('หมวดหมู่: อาหารสัตว์ → ค่าสัตวแพทย์')).toBeVisible();
  await expect(history.locator('code')).toHaveCount(0);
  await expect(history.getByText(/amount:/)).toHaveCount(0);
  await ctx.close();
});

test('the owner archives the farm after confirming; it is read-only afterwards', async ({
  page,
  request,
}) => {
  const { owner, farmId } = await ownerWithAnimal(request, 'Archiving Owner');
  await signIn(page, owner, `/farms/${farmId}/edit`);
  await page.getByRole('button', { name: 'Archive farm' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/until it is restored/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Archive farm' }).click();
  await expect(page).toHaveURL(new RegExp(`/farms/${farmId}$`));
  await expect(page.getByText('This farm is archived and read-only.').first()).toBeVisible();
  const farm = await mongoose.connection.db!.collection('farms').findOne({
    _id: new mongoose.Types.ObjectId(farmId),
  });
  expect(farm?.['status']).toBe('archived');
  // Read-only: the API refuses changes.
  const types = await (await request.get(`${api()}/api/v1/animal-types`, authed(owner))).json();
  const add = await request.post(`${api()}/api/v1/farms/${farmId}/animals`, {
    ...authed(owner),
    data: { animalTypeId: types.animalTypes[0].id, sex: 'male' },
  });
  expect(add.status()).toBe(409);
  expect((await add.json()).error.code).toBe('FARM_ARCHIVED');
});

test('an unknown URL shows the 404 page with a way home', async ({ page }) => {
  await page.goto('/this-page-does-not-exist');
  await expect(page.getByRole('heading', { name: 'Page not found', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Back to the home page' }).click();
  await expect(page).toHaveURL(`${WEB}/`);
});

test('market and shop filters show Thai names in Thai mode', async ({ browser, request }) => {
  const buyer: User = await register(request, 'Thai Filter Buyer');
  const ctx = await browser.newContext({ storageState: languageState('en') });
  const page = await ctx.newPage();
  await signInThai(page, buyer, '/market');
  const types = page.getByRole('heading', { name: 'ชนิดสัตว์' }).locator('..');
  await expect(types.getByLabel('ควาย')).toBeVisible();
  await expect(types.getByLabel('Buffalo')).toHaveCount(0);
  await page.goto('/shop');
  const cats = page.getByRole('heading', { name: 'หมวดหมู่สินค้า' }).locator('..');
  await expect(cats.getByLabel('อาหารสัตว์')).toBeVisible();
  await expect(cats.getByLabel('Animal feed')).toHaveCount(0);
  await ctx.close();
});
