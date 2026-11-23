import { expect, test, type Page } from '@playwright/test';
import { authed, closeDb, grantRoles, register, signIn } from '../helpers';

/**
 * Phone width (375 × 812, iPhone 12/13 mini class): the header must fit, the search hint must not be cut off
 * ("ค้นหา…" — staging QA showed "ค้นห"), and the pages fixed in PR #4 must not scroll sideways.
 */
test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
test.afterAll(closeDb);

const api = () => process.env['E2E_API']!;
const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** Fails with the offending widths when the page or the header is wider than the screen. */
async function expectNoSidewaysScroll(page: Page, label: string) {
  await page.waitForLoadState('networkidle');
  const widths = await page.evaluate(() => {
    const header = document.querySelector('.site-header') as HTMLElement | null;
    return {
      viewport: window.innerWidth,
      page: document.documentElement.scrollWidth,
      header: header ? header.scrollWidth : 0,
      headerBox: header ? header.clientWidth : 0,
    };
  });
  expect(widths.page, `${label}: page width ${JSON.stringify(widths)}`).toBeLessThanOrEqual(
    widths.viewport,
  );
  expect(widths.header, `${label}: header width ${JSON.stringify(widths)}`).toBeLessThanOrEqual(
    widths.headerBox,
  );
}

/** The search box's placeholder text, measured in its own font, fits inside its content box. */
async function expectSearchHintFits(page: Page, expected: string) {
  const input = page.getByRole('searchbox');
  await expect(input).toHaveAttribute('placeholder', expected);
  const fit = await input.evaluate((el: HTMLInputElement) => {
    const style = getComputedStyle(el);
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const text = ctx.measureText(el.placeholder).width;
    const box = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return { text, box };
  });
  expect(fit.text, `placeholder ${JSON.stringify(fit)}`).toBeLessThanOrEqual(fit.box);
}

async function toThai(page: Page) {
  await page.evaluate(() => localStorage.setItem('farmplus.locale', 'th'));
  await page.reload();
}

test('signed out: the header fits and the search hint is complete in Thai and English', async ({
  page,
}) => {
  await page.goto('/');
  await expectSearchHintFits(page, 'Search…');
  await expectNoSidewaysScroll(page, 'home (en)');
  await toThai(page);
  await expectSearchHintFits(page, 'ค้นหา…');
  await expectNoSidewaysScroll(page, 'home (th)');
  await page.goto('/this-page-does-not-exist');
  await expect(page.getByRole('heading', { name: 'ไม่พบหน้านี้' })).toBeVisible();
  await expectNoSidewaysScroll(page, '404');
});

test('signed in: header and the pages fixed in the staging QA round do not scroll sideways', async ({
  page,
  request,
}) => {
  const owner = await register(request, 'Phone Farmer');
  await grantRoles(owner.id, ['farm_owner']);
  // No farm yet: the farm setup (address and map step) first.
  await signIn(page, owner, '/farms/new');
  await expect(page.getByRole('heading', { name: 'Set up your farm' })).toBeVisible();
  await expectNoSidewaysScroll(page, 'farm setup');

  const farm = await request.post(`${api()}/api/v1/farms`, {
    ...authed(owner),
    data: { name: 'Phone Farm' },
  });
  const farmId = (await farm.json()).farm.id as string;
  const types = await (await request.get(`${api()}/api/v1/animal-types`, authed(owner))).json();
  const animal = await request.post(`${api()}/api/v1/farms/${farmId}/animals`, {
    ...authed(owner),
    data: { animalTypeId: types.animalTypes[0].id, sex: 'female' },
  });
  const animalId = (await animal.json()).animal.id as string;
  for (const [d, kg] of [
    [20, 1.6],
    [10, 1.85],
  ] as const)
    await request.post(`${api()}/api/v1/farms/${farmId}/weights`, {
      ...authed(owner),
      data: { animalId, weighedOn: isoDaysAgo(d), weightKg: kg },
    });
  const expense = await request.post(`${api()}/api/v1/farms/${farmId}/expenses`, {
    ...authed(owner),
    data: { category: 'feed', expenseDate: isoDaysAgo(5), amount: 123.45, description: 'Bran' },
  });
  const expenseId = (await expense.json()).record.id as string;
  await request.post(`${api()}/api/v1/farms/${farmId}/expenses/${expenseId}/corrections`, {
    ...authed(owner),
    data: { reason: 'Receipt total', changes: { amount: 150 } },
  });

  await page.goto('/');
  await expectSearchHintFits(page, 'Search…');
  await toThai(page);
  await expectSearchHintFits(page, 'ค้นหา…');
  for (const path of [
    '/',
    '/market',
    '/shop',
    `/farms/${farmId}/edit`,
    `/farms/${farmId}/animals/${animalId}/growth`,
    `/farms/${farmId}/expenses/${expenseId}`,
  ]) {
    await page.goto(path);
    await expectNoSidewaysScroll(page, path);
  }
});
