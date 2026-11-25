import { expect, test, type Page } from '@playwright/test';
import { languageState } from '../language';
import { closeDb, register, signIn } from '../helpers';

/**
 * Guided tours in a real browser: first visit, step through, remembered (this browser for guests, the server for
 * signed-in people — so another tab does not show it again), and "show again". Uses the help-centre tour on /help.
 */
test.afterAll(closeDb);

const card = (page: Page) => page.getByRole('dialog');

async function walkToEnd(page: Page) {
  await expect(card(page).getByText('Step 1 of 3')).toBeVisible();
  await card(page).getByRole('button', { name: 'Next' }).click();
  await expect(card(page).getByText('Step 2 of 3')).toBeVisible();
  await card(page).getByRole('button', { name: 'Next' }).click();
  await expect(card(page).getByText('Step 3 of 3')).toBeVisible();
  await card(page).getByRole('button', { name: 'Done' }).click();
  await expect(card(page)).toHaveCount(0);
}

test('a guest sees the tour on the first visit only, and can start it again from /help', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ storageState: languageState('en', { tours: true }) });
  const page = await ctx.newPage();
  await page.goto('/help');
  await expect(card(page).getByRole('heading', { name: 'Search the help' })).toBeVisible();
  // The page stays usable while the tour is open.
  await page.getByLabel('Search help').fill('password');
  await walkToEnd(page);
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await expect(card(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Start the tips' }).click();
  await expect(card(page).getByText('Step 1 of 3')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card(page)).toHaveCount(0);
  await ctx.close();
});

test('signed in: finishing the tour in one tab means another tab does not show it; the menu shows it again', async ({
  browser,
  request,
}) => {
  const user = await register(request, 'Tour Example');
  const first = await browser.newContext({ storageState: languageState('en', { tours: true }) });
  const a = await first.newPage();
  await signIn(a, user, '/help');
  await walkToEnd(a);
  await first.close();

  // A fresh browser context = another tab/device: nothing in its storage, the server remembers.
  const second = await browser.newContext({ storageState: languageState('en', { tours: true }) });
  const b = await second.newPage();
  await signIn(b, user, '/help');
  await b.waitForLoadState('networkidle');
  await b.waitForTimeout(1500);
  await expect(card(b)).toHaveCount(0);
  await b.getByRole('button', { name: 'My account' }).click();
  await b.getByRole('menuitem', { name: "Show this page's tips again" }).click();
  await expect(card(b).getByText('Step 1 of 3')).toBeVisible();
  await second.close();
});

test.describe('phone width', () => {
  test.use({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    storageState: languageState('en', { tours: true }),
  });
  test('the tour is a bottom sheet that does not cover what it points at', async ({ page }) => {
    await page.goto('/help');
    const sheet = card(page);
    await expect(sheet.getByText('Step 1 of 3')).toBeVisible();
    await sheet.getByRole('button', { name: 'Next' }).click();
    await expect(sheet.getByText('Step 2 of 3')).toBeVisible();
    await page.waitForTimeout(800); // let the page scroll the pointed section above the sheet
    const [sheetBox, target] = await Promise.all([
      sheet.boundingBox(),
      page.locator('[data-tour="help-getting-started"]').boundingBox(),
    ]);
    expect(sheetBox!.y + sheetBox!.height).toBeCloseTo(812, 0); // at the bottom of the screen
    expect(sheetBox!.width).toBeCloseTo(375, 0);
    expect(target!.y).toBeLessThan(sheetBox!.y); // the pointed section starts above the sheet
    const w = await page.evaluate(() => ({
      vw: innerWidth,
      page: document.documentElement.scrollWidth,
    }));
    expect(w.page).toBeLessThanOrEqual(w.vw);
  });
});
