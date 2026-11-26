import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { authed, closeDb, grantRoles, register, signIn } from '../helpers';

/**
 * Staging QA 2026-11-25, B1: switching between farm record pages from the farm menu (weights → expenses → health)
 * blanked the whole app ("Cannot read properties of undefined (reading 'replace')").
 */
test.afterAll(closeDb);

const api = () => process.env['E2E_API']!;

test('switching record pages in the farm menu (weights → expenses → health) does not crash', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const owner = await register(request, 'Records Owner');
  await grantRoles(owner.id, ['farm_owner']);
  const farm = await request.post(`${api()}/api/v1/farms`, {
    ...authed(owner),
    data: { name: 'Records Farm' },
  });
  expect(farm.status(), await farm.text()).toBe(201);
  const farmId = (await farm.json()).farm.id as string;
  const types = await (await request.get(`${api()}/api/v1/animal-types`, authed(owner))).json();
  const animal = await request.post(`${api()}/api/v1/farms/${farmId}/animals`, {
    ...authed(owner),
    data: {
      animalCode: `R-${randomBytes(2).toString('hex')}`,
      animalTypeId: types.animalTypes[0].id,
      sex: 'female',
    },
  });
  expect(animal.status(), await animal.text()).toBe(201);
  const animalId = (await animal.json()).animal.id as string;
  const post = async (path: string, data: object) => {
    const res = await request.post(`${api()}/api/v1/farms/${farmId}/${path}`, {
      ...authed(owner),
      data,
    });
    expect(res.status(), await res.text()).toBe(201);
  };
  await post('weights', { animalId, weighedOn: '2026-11-01', weightKg: 250 });
  await post('expenses', {
    category: 'feed',
    expenseDate: '2026-11-02',
    amount: 1200,
    description: 'Rice straw',
  });
  await post('health', {
    animalId,
    type: 'illness',
    recordedOn: '2026-11-03',
    title: 'Cough check',
  });

  await signIn(page, owner, `/farms/${farmId}/weights`);
  await expect(page.getByRole('heading', { level: 1, name: 'Weights' })).toBeVisible();
  await expect(page.getByText('250').first()).toBeVisible();

  const menu = page.getByRole('navigation', { name: 'My farm menu' });
  await menu.getByRole('link', { name: 'Costs', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Costs' })).toBeVisible();
  await expect(page.getByText('Rice straw')).toBeVisible();

  await menu.getByRole('link', { name: 'Health', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Health records' })).toBeVisible();
  await expect(page.getByText('Cough check')).toBeVisible();

  // The site around the page is still there, and nothing threw.
  await expect(menu).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});
