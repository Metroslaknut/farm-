import { expect, test, type Page } from '@playwright/test';
import mongoose from 'mongoose';
import { languageState } from '../language';
import { closeDb, PASSWORD, register } from '../helpers';

/** The help centre (public), its entry points, and the sign-in page's "send the link again". */
test.afterAll(closeDb);

async function db() {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env['E2E_MONGODB_URI']!);
  return mongoose.connection.db!;
}

const noSidewaysScroll = async (page: Page) => {
  const w = await page.evaluate(() => ({
    vw: innerWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(w.page, JSON.stringify(w)).toBeLessThanOrEqual(w.vw);
};

test('the footer "Help" opens /help without signing in; Thai search finds the e-mail article', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ storageState: languageState('th') });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.locator('footer').getByRole('link', { name: 'ช่วยเหลือ' }).click();
  await expect(page).toHaveURL(/\/help$/);
  await expect(page.getByRole('heading', { level: 1, name: 'ศูนย์ช่วยเหลือ' })).toBeVisible();
  await page.getByLabel('ค้นหาวิธีใช้').fill('ไม่ได้รับอีเมล');
  await page.getByRole('button', { name: 'ค้นหาวิธีใช้' }).click();
  const results = page.getByRole('region', { name: 'ผลการค้นหา' });
  await expect(results.getByRole('link').first()).toContainText('สมัครสมาชิกด้วยอีเมล');
  await results.getByRole('link').first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'สมัครสมาชิกด้วยอีเมล' })).toBeVisible();
  // Pictures are real files (lazy-loaded): the first one loads.
  const img = page.getByRole('img').first();
  await img.scrollIntoViewIfNeeded();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
  await ctx.close();
});

test('an unverified account can ask for the verification link again on the sign-in page', async ({
  page,
  request,
}) => {
  const user = await register(request, 'Unverified Example');
  // e2e runs with verification off; put this account back to "waiting for verification".
  await (
    await db()
  )
    .collection('users')
    .updateOne(
      { _id: new mongoose.Types.ObjectId(user.id) },
      { $set: { status: 'pending_verification' } },
    );
  await page.goto('/farms/sign-in');
  await page.getByLabel('Email or phone').fill(user.email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText(/Verify your email or phone number before signing in/)).toBeVisible();
  const resent = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/api/v1/auth/verify/resend'),
  );
  await page.getByRole('button', { name: 'Send the link again' }).click();
  expect((await resent).status()).toBeLessThan(300);
  await expect(page.getByText(/we have sent it a new link or code/)).toBeVisible();
});

test.describe('phone width', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  test('/help and an article fit a 375 px screen', async ({ page }) => {
    await page.goto('/help');
    await expect(page.getByRole('heading', { level: 1, name: 'Help centre' })).toBeVisible();
    await noSidewaysScroll(page);
    await page.goto('/help/register-email');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Register with your email' }),
    ).toBeVisible();
    await page.waitForLoadState('networkidle');
    await noSidewaysScroll(page);
  });
});
