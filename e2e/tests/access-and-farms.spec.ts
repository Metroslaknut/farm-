import { expect, test } from '@playwright/test';
import { languageState } from '../language';
import { authed, closeDb, grantRoles, PASSWORD, register, signIn } from '../helpers';

test.afterAll(closeDb);

test.describe('signing in and access control in a real browser', () => {
  test('anonymous visitors are sent to sign in, a wrong password is refused, and the right one opens "My farms"', async ({
    page,
    request,
  }) => {
    await page.goto('/farms');
    await expect(page).toHaveURL(/\/farms\/sign-in/);
    await expect(page.getByRole('heading', { name: 'Sign in to manage your farms' })).toBeVisible();

    const user = await register(request);
    await page.getByLabel('Email or phone').fill(user.email);
    await page.getByLabel('Password').fill('not-the-password-123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/sign-in/);

    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'My farms' })).toBeVisible();
  });

  test('the admin area is closed to anyone who is not signed in as staff', async ({
    page,
    request,
  }) => {
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/admin\/login/);
    const user = await register(request);
    await page.goto('/admin/login');
    await page
      .getByLabel(/email|identifier/i)
      .first()
      .fill(user.email);
    await page
      .getByLabel(/password/i)
      .first()
      .fill(PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await page.goto('/admin/users');
    // an ordinary user never reaches the user list, whatever the URL
    await expect(page.getByRole('heading', { name: /^Users$/ })).toHaveCount(0);
  });

  test('a farm owner creates a farm in the browser; another user cannot open it', async ({
    page,
    browser,
    request,
  }) => {
    const owner = await register(request, 'Farm Owner');
    await grantRoles(owner.id, ['farm_owner']);
    await signIn(page, owner);
    // No farm yet → the farm setup is forced (no way back), one step at a time.
    await expect(page.getByRole('heading', { name: 'Set up your farm' })).toBeVisible();
    await expect(page).toHaveURL(/\/farms\/new$/);
    await expect(page.getByRole('link', { name: 'Cancel' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Step 1 of 3')).toBeVisible(); // the name is required
    await page.getByLabel('Farm name').fill('Browser Created Farm');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Save and start' }).click();
    // "My farm" opens as a dashboard: overview, sidebar menu, and the farm picked in the sidebar.
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'My farm menu' })).toBeVisible();
    await expect(
      page.getByRole('combobox', { name: 'Farm', exact: true }).locator('option:checked'),
    ).toHaveText('Browser Created Farm');
    const farmUrl = page.url();
    expect(farmUrl).toMatch(/\/farms\/[a-f0-9]{24}$/);
    // Once set up, the farm settings live in the profile.
    await page.goto('/farms/profile');
    await expect(page.getByRole('link', { name: 'Edit farm details' })).toHaveAttribute(
      'href',
      new URL(farmUrl).pathname + '/edit',
    );

    // The same URL as a different signed-in user: the farm does not exist for them.
    const stranger = await register(request, 'Stranger');
    const ctx = await browser.newContext({ storageState: languageState('en') });
    const other = await ctx.newPage();
    await signIn(other, stranger);
    await other.goto(farmUrl);
    await expect(other.getByRole('alert').first()).toBeVisible();
    await expect(other.getByText('Browser Created Farm')).toHaveCount(0);
    await expect(other.getByText(/not found|could not|error/i).first()).toBeVisible();
    await ctx.close();
  });

  test('user-supplied text is shown as text: markup in a farm name never runs', async ({
    page,
    request,
  }) => {
    const owner = await register(request, 'Farm Owner');
    await grantRoles(owner.id, ['farm_owner']);
    const payload = '<img src=x onerror="window.__pwned=1"><b>bold?</b>';
    const created = await request.post(`${process.env['E2E_API']}/api/v1/farms`, {
      ...authed(owner),
      data: { name: payload },
    });
    expect(created.status(), await created.text()).toBe(201);
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    await signIn(page, owner);
    await expect(page.getByRole('main').getByText(payload, { exact: false }).first()).toBeVisible();
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
    ).toBeUndefined();
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    expect(await page.locator('main b', { hasText: 'bold?' }).count()).toBe(0);
    expect(dialogs).toEqual([]);
  });

  test('security headers and no cookies reach the browser from the dev API', async ({
    request,
  }) => {
    const res = await request.get(`${process.env['E2E_API']}/api/v1/health`);
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['set-cookie']).toBeUndefined();
    expect(res.headers()['x-powered-by']).toBeUndefined();
  });
});
