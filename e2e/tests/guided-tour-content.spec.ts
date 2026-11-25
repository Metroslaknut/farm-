import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import tours from '../../apps/web/src/i18n/messages/tours';
import { tourById } from '../../apps/web/src/tours/registry';
import { languageState } from '../language';
import { PASSWORD, authed, closeDb, grantRoles, register, type User } from '../helpers';

/**
 * The main guided tours on the real pages, in Thai and English, on a desktop (1280 px) and a phone (375 px): every
 * step's text is the catalog text, its element is on screen, and the tour runs to "Done" (farm-setup follows the
 * wizard: its own "Next" moves the tour on).
 */
test.afterAll(closeDb);

const api = () => process.env['E2E_API']!;
type Locale = 'th' | 'en';
const card = (page: Page) => page.getByRole('dialog');
const text = (locale: Locale, key: string) => (tours[locale] as Record<string, string>)[key]!;

async function signInAs(page: Page, user: User, locale: Locale) {
  const L = (th: string, en: string) => (locale === 'th' ? th : en);
  await page.goto('/farms/sign-in');
  await page
    .getByLabel(new RegExp(`^${L('อีเมลหรือเบอร์โทรศัพท์', 'Email or phone')}`))
    .fill(user.email);
  await page.getByLabel(new RegExp(`^${L('รหัสผ่าน', 'Password')}`)).fill(PASSWORD);
  await page.getByRole('button', { name: L('เข้าสู่ระบบ', 'Sign in'), exact: true }).click();
  await expect(page).not.toHaveURL(/sign-in/);
}

/** A farm owner (optionally also a seller) with a farm and one animal, made through the API. */
async function ownerWithFarm(request: APIRequestContext, roles: string[]) {
  const user = await register(request, 'Tour Owner');
  await grantRoles(user.id, roles);
  const farm = await request.post(`${api()}/api/v1/farms`, {
    ...authed(user),
    data: { name: 'Tour Farm' },
  });
  expect(farm.status(), await farm.text()).toBe(201);
  const farmId = (await farm.json()).farm.id as string;
  const types = await (await request.get(`${api()}/api/v1/animal-types`, authed(user))).json();
  const animal = await request.post(`${api()}/api/v1/farms/${farmId}/animals`, {
    ...authed(user),
    data: {
      animalCode: `T-${randomBytes(2).toString('hex')}`,
      animalTypeId: types.animalTypes[0].id,
      sex: 'female',
    },
  });
  expect(animal.status(), await animal.text()).toBe(201);
  return { user, farmId };
}

/**
 * Walks a tour from its first card to "Done". `act` runs page actions a step needs (filling the wizard). Returns the
 * anchors of the steps shown, in order.
 */
async function walk(
  page: Page,
  locale: Locale,
  tourId: string,
  act: (anchor: string) => Promise<void> = async () => undefined,
) {
  const tour = tourById(tourId)!;
  const shown: string[] = [];
  await expect(card(page)).toBeVisible({ timeout: 15_000 });
  for (let guard = 0; guard < 12; guard++) {
    if ((await card(page).count()) === 0) break;
    const title = (await card(page).getByRole('heading').textContent())!.trim();
    const step = tour.steps.find(
      (s, i) => text(locale, s.titleKey) === title && !shown.includes(`${i}`),
    );
    expect(step, `${tourId}: unexpected card "${title}"`).toBeTruthy();
    const index = tour.steps.indexOf(step!);
    shown.push(`${index}`);
    await expect(card(page).getByText(text(locale, step!.bodyKey))).toBeVisible();
    const target = page.locator(`[data-tour="${step!.anchor}"]`).locator('visible=true').first();
    await expect(target, `${tourId}: ${step!.anchor} on screen`).toBeVisible();
    await act(step!.anchor);
    if (step!.advanceOnClick) {
      await expect(card(page).getByRole('button', { name: text(locale, 'ui.next') })).toHaveCount(
        0,
      );
      await target.click();
    } else {
      const done = card(page).getByRole('button', { name: text(locale, 'ui.done') });
      const next = card(page).getByRole('button', { name: text(locale, 'ui.next') });
      await ((await done.count()) ? done : next).click();
    }
    // The next card (or none): wait until the heading changes.
    await expect
      .poll(async () =>
        (await card(page).count()) ? await card(page).getByRole('heading').textContent() : '',
      )
      .not.toBe(title);
  }
  await expect(card(page)).toHaveCount(0);
  return shown.map((i) => tour.steps[Number(i)]!.anchor);
}

/** Every required (not optional) step of the tour was shown. */
function expectAllRequired(tourId: string, shown: string[]) {
  for (const s of tourById(tourId)!.steps.filter((s) => !s.optional))
    expect(shown, `${tourId} shows ${s.anchor}`).toContain(s.anchor);
}

const VIEWPORTS = {
  1280: { viewport: { width: 1280, height: 800 } },
  375: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
} as const;

for (const width of [1280, 375] as const)
  for (const locale of ['th', 'en'] as const) {
    if (width === 375 && locale === 'en') continue; // phones: Thai (the default language); English at 1280
    test.describe(`${locale} ${width}px`, () => {
      test.use({ ...VIEWPORTS[width], storageState: languageState(locale, { tours: true }) });

      test('welcome', async ({ page, request }) => {
        const user = await register(request, 'Tour Member');
        await signInAs(page, user, locale);
        await page.goto('/');
        const shown = await walk(page, locale, 'welcome');
        expectAllRequired('welcome', shown);
        // The menu that can be seen at this width: the bar on a desktop, the "Menu" button on a phone.
        expect(shown).toContain(width === 1280 ? 'main-menu' : 'main-menu-toggle');
        expect(shown).not.toContain(width === 1280 ? 'main-menu-toggle' : 'main-menu');
      });

      test('farm-setup follows the wizard', async ({ page, request }) => {
        const user = await register(request, 'Tour New Owner');
        await grantRoles(user.id, ['farm_owner']);
        await signInAs(page, user, locale);
        await expect(page).toHaveURL(/\/farms\/new/);
        const shown = await walk(page, locale, 'farm-setup', async (anchor) => {
          if (anchor === 'farm-name')
            await page.locator('[data-tour="farm-name"]').fill('Tour Farm');
          if (anchor === 'farm-animal-types')
            await page
              .locator('[data-tour="farm-animal-types"]')
              .getByRole('checkbox')
              .first()
              .check();
        });
        expectAllRequired('farm-setup', shown);
        await expect(page.locator('[data-tour="farm-contact"]')).toBeVisible();
      });

      test('animal-new', async ({ page, request }) => {
        const { user, farmId } = await ownerWithFarm(request, ['farm_owner']);
        await signInAs(page, user, locale);
        await page.goto(`/farms/${farmId}/animals/new`);
        const shown = await walk(page, locale, 'animal-new');
        expectAllRequired('animal-new', shown);
      });

      test('listing-new (approved seller)', async ({ page, request }) => {
        const { user, farmId } = await ownerWithFarm(request, ['farm_owner', 'seller']);
        await signInAs(page, user, locale);
        await page.goto(`/farms/${farmId}/listings/new`);
        const shown = await walk(page, locale, 'listing-new');
        expectAllRequired('listing-new', shown);
        expect(shown).not.toContain('listing-become-seller');
      });
    });
  }

test.describe('not a seller yet', () => {
  test.use({ storageState: languageState('th', { tours: true }) });
  test('listing-new starts by pointing at "apply to become a seller"', async ({
    page,
    request,
  }) => {
    const { user, farmId } = await ownerWithFarm(request, ['farm_owner']);
    await signInAs(page, user, 'th');
    await page.goto(`/farms/${farmId}/listings/new`);
    const shown = await walk(page, 'th', 'listing-new');
    expect(shown[0]).toBe('listing-become-seller');
  });
});
