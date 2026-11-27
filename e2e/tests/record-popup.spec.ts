import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { authed, closeDb, grantRoles, register, signIn } from '../helpers';

/**
 * Staging QA 2026-11-25, task 4: adding a weight from the list opens the form in a dialog (native <dialog>: Escape
 * closes it and focus goes back to the button); saving closes it and the list shows the new record.
 */
test.afterAll(closeDb);

const api = () => process.env['E2E_API']!;

test('add a weight in a dialog over the list; Escape closes it; focus returns to "Add weight"', async ({
  page,
  request,
}) => {
  const owner = await register(request, 'Popup Owner');
  await grantRoles(owner.id, ['farm_owner']);
  const farm = await request.post(`${api()}/api/v1/farms`, {
    ...authed(owner),
    data: { name: 'Popup Farm' },
  });
  const farmId = (await farm.json()).farm.id as string;
  const types = await (await request.get(`${api()}/api/v1/animal-types`, authed(owner))).json();
  const code = `P-${randomBytes(2).toString('hex')}`;
  const animal = await request.post(`${api()}/api/v1/farms/${farmId}/animals`, {
    ...authed(owner),
    data: { animalCode: code, animalTypeId: types.animalTypes[0].id, sex: 'female' },
  });
  expect(animal.status(), await animal.text()).toBe(201);

  await signIn(page, owner, `/farms/${farmId}/weights`);
  const add = page.getByRole('link', { name: 'Add weight' });
  await add.click();
  const dialog = page.getByRole('dialog', { name: 'New weight' });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/farms/${farmId}/weights$`)); // still on the list

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(add).toBeFocused();

  await add.click();
  await dialog.getByLabel(/^Animal/).selectOption({ label: code });
  await dialog.getByLabel(/^Date/).fill('2026-11-20');
  await dialog.getByLabel(/^Weight \(kg\)/).fill('123.5');
  await dialog.getByRole('button', { name: 'Save weight' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await expect(page.getByRole('table').getByText('123.5')).toBeVisible();

  // The page of its own still works (links, new tabs).
  await page.goto(`/farms/${farmId}/weights/new`);
  await expect(page.getByRole('heading', { level: 1, name: 'New weight' })).toBeVisible();
});
