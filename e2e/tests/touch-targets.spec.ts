import { expect, test, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { languageState } from '../language';
import { PASSWORD, authed, closeDb, grantRoles, register } from '../helpers';

/**
 * Staging QA 2026-11-25, task 6: below 768 px every button, form field, language/theme switch and link in a table is at
 * least 44 px tall (WCAG 2.5.5 target size). Links inside sentences are exempt (WCAG "inline" exception).
 */
test.afterAll(closeDb);
test.use({
  viewport: { width: 375, height: 812 },
  isMobile: true,
  hasTouch: true,
  storageState: languageState('th'),
});

const api = () => process.env['E2E_API']!;
const MIN = 44;

/** Visible controls smaller than 44 px tall, described for the failure message. */
async function tooSmall(page: Page): Promise<string[]> {
  return page.evaluate((min) => {
    const selector = [
      'button',
      'a.ds-btn',
      'select',
      'textarea',
      'input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file])',
      'table a',
      '.ds-theme-toggle label',
      '.site-lang label',
      '[role=radiogroup] label',
    ].join(',');
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || style.visibility === 'hidden') continue;
      if (el.closest('[hidden], dialog:not([open]), .ds-sr-only, [aria-hidden=true]')) continue;
      // A control inside a bigger tappable label/row counts as that row.
      const target = el.closest('label') ?? el;
      const h = Math.max(r.height, target.getBoundingClientRect().height);
      if (h + 0.5 < min)
        out.push(
          `${el.tagName.toLowerCase()}.${el.className} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(h)}px`,
        );
    }
    return [...new Set(out)];
  }, MIN);
}

test('pages a farmer uses every day have touch targets of at least 44 px on a phone', async ({
  page,
  request,
}) => {
  const owner = await register(request, 'Touch Owner');
  await grantRoles(owner.id, ['farm_owner']);
  const farm = await request.post(`${api()}/api/v1/farms`, {
    ...authed(owner),
    data: { name: 'Touch Farm' },
  });
  const farmId = (await farm.json()).farm.id as string;
  const types = await (await request.get(`${api()}/api/v1/animal-types`, authed(owner))).json();
  const animal = await request.post(`${api()}/api/v1/farms/${farmId}/animals`, {
    ...authed(owner),
    data: {
      animalCode: `T-${randomBytes(2).toString('hex')}`,
      animalTypeId: types.animalTypes[0].id,
      sex: 'female',
    },
  });
  const animalId = (await animal.json()).animal.id as string;
  await request.post(`${api()}/api/v1/farms/${farmId}/weights`, {
    ...authed(owner),
    data: { animalId, weighedOn: '2026-11-01', weightKg: 250 },
  });
  await page.goto('/farms/sign-in');
  await page.getByLabel(/^อีเมลหรือเบอร์โทรศัพท์/).fill(owner.email);
  await page.getByLabel(/^รหัสผ่าน/).fill(PASSWORD);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  await expect(page).not.toHaveURL(/sign-in/);

  const problems: Record<string, string[]> = {};
  for (const path of [
    '/',
    '/market',
    '/shop',
    `/farms/${farmId}`,
    `/farms/${farmId}/animals`,
    `/farms/${farmId}/animals/${animalId}`,
    `/farms/${farmId}/weights`,
    `/farms/${farmId}/weights/new`,
    '/help',
  ]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const small = await tooSmall(page);
    if (small.length) problems[path] = small;
  }
  expect(problems).toEqual({});
});
