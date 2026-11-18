import { expect, test } from '@playwright/test';
import { currentStep, totpAt } from '../../services/api/src/lib/totp';
import { languageState } from '../language';
import { authed, closeDb, grantRoles, PASSWORD, register, signIn } from '../helpers';

test.afterAll(closeDb);

const api = () => process.env['E2E_API']!;
const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

test('an admin sets a growth criterion; the farmer sees measurements compared, alerted and counted', async ({
  page,
  browser,
  request,
}) => {
  // --- Admin (MFA) creates a weight-for-age criterion in the admin UI -------------------------
  const admin = await register(request, 'Species Admin');
  await grantRoles(admin.id, ['admin']);
  const setup = await request.post(`${api()}/api/v1/auth/mfa/setup`, authed(admin));
  const secret = (await setup.json()).secret as string;
  const enabled = await request.post(`${api()}/api/v1/auth/mfa/enable`, {
    ...authed(admin),
    data: { code: totpAt(secret, currentStep()) },
  });
  expect(enabled.status(), await enabled.text()).toBe(200);
  await page.goto('/admin/growth-standards');
  await page.getByLabel('Email or phone').fill(admin.email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page
    .getByLabel('Authenticator code or recovery code')
    .fill(totpAt(secret, currentStep() + 1));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: 'Growth criteria' })).toBeVisible();

  await page.getByRole('button', { name: 'Add criterion' }).click();
  const form = page.getByRole('form', { name: 'New growth criterion' });
  await form.getByLabel('Animal type').selectOption({ label: 'Goat' });
  await form.getByLabel(/^Age from/).fill('0');
  await form.getByLabel(/^Age to/).fill('3650');
  await form.getByLabel(/^Minimum weight/).fill('40');
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/api/v1/growth-standards'),
  );
  await form.getByRole('button', { name: 'Save criterion' }).click();
  expect((await created).status()).toBe(201);
  await expect(page.getByRole('cell', { name: 'System recommendation' })).toBeVisible();

  // --- Farmer: farm, a goat with a birth date, two weighings (the latest below the criterion) ----
  const owner = await register(request, 'Goat Farmer');
  await grantRoles(owner.id, ['farm_owner']);
  const farm = await request.post(`${api()}/api/v1/farms`, {
    ...authed(owner),
    data: { name: 'Goat Growth Farm' },
  });
  const farmId = (await farm.json()).farm.id as string;
  const types = await (await request.get(`${api()}/api/v1/animal-types`, authed(owner))).json();
  const goat = types.animalTypes.find((t: { key: string }) => t.key === 'goat').id as string;
  const animal = await request.post(`${api()}/api/v1/farms/${farmId}/animals`, {
    ...authed(owner),
    data: { animalTypeId: goat, sex: 'female', birthDate: isoDaysAgo(400) },
  });
  const animalId = (await animal.json()).animal.id as string;
  for (const [daysAgo, kg] of [
    [60, 45],
    [3, 30],
  ] as const) {
    const w = await request.post(`${api()}/api/v1/farms/${farmId}/weights`, {
      ...authed(owner),
      data: { animalId, weighedOn: isoDaysAgo(daysAgo), weightKg: kg, heightCm: 60 },
    });
    expect(w.status(), await w.text()).toBe(201);
  }

  const ctx = await browser.newContext({ storageState: languageState('en') });
  const farmer = await ctx.newPage();
  await signIn(farmer, owner);
  await farmer.goto(`/farms/${farmId}/animals/${animalId}/growth`);
  await expect(farmer.getByText('Latest measurement is outside the criterion')).toBeVisible();
  await expect(
    farmer.getByText(/Weight 30 kg is below the criterion \(minimum 40 kg\)/),
  ).toBeVisible();
  await expect(farmer.getByText('▼ Below').locator('visible=true').first()).toBeVisible();
  await expect(farmer.getByText('● Within').locator('visible=true').first()).toBeVisible();
  await expect(
    farmer.getByText('System recommendation (not an academic standard)').first(),
  ).toBeVisible();
  await expect(farmer.getByRole('img', { name: /Weight by age/ })).toBeVisible();

  // The My farm home counts it.
  await farmer.goto(`/farms/${farmId}`);
  await expect(farmer.getByText('Outside growth criteria: 1').first()).toBeVisible();
  await ctx.close();
});
