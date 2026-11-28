import { expect, test } from '@playwright/test';
import { closeDb, register, signIn } from '../helpers';

/**
 * Staging QA #14: a link opened in a new tab used to land on the sign-in page (each tab keeps its own session). Now a
 * new tab asks an open, signed-in tab for a session of its own.
 */
test.afterAll(closeDb);

test('a new tab of a signed-in browser is signed in; signing out the first tab leaves the second working', async ({
  page,
  request,
}) => {
  const user = await register(request, 'Tab Person');
  await signIn(page, user, '/farms/profile');
  await expect(page.locator('dd', { hasText: user.email })).toBeVisible();

  // A second tab of the same browser (same context: same origin, its own sessionStorage).
  const second = await page.context().newPage();
  await second.goto('/farms/profile');
  await expect(second).toHaveURL(/\/farms\/profile$/);
  await expect(second.locator('dd', { hasText: user.email })).toBeVisible();

  // Each tab has its own session: signing out the first does not sign out the second.
  await page.getByRole('button', { name: 'My account' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await second.reload();
  await expect(second.locator('dd', { hasText: user.email })).toBeVisible();
});

test('a guest opening a new tab is not kept waiting and sees the sign-in page', async ({
  page,
}) => {
  await page.goto('/');
  const second = await page.context().newPage();
  const started = Date.now();
  await second.goto('/farms/profile');
  await expect(second).toHaveURL(/\/farms\/sign-in/);
  expect(Date.now() - started).toBeLessThan(5000);
});
