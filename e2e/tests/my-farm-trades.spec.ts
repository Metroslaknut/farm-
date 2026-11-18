import { expect, test } from '@playwright/test';
import { authed, closeDb, sellerWithListing, signIn } from '../helpers';

test.afterAll(closeDb);

const api = () => process.env['E2E_API']!;

test('a live listing puts the animal on sale; the farm sees it under Trades; cancelling restores the animal', async ({
  page,
  request,
}) => {
  const { seller, farmId, listingId, title } = await sellerWithListing(
    request,
    'E2E Trades Buffalo',
  );
  const live = await request.get(
    `${api()}/api/v1/farms/${farmId}/listings/${listingId}`,
    authed(seller),
  );
  const animalId = (await live.json()).listing.animalId as string;

  await signIn(page, seller);
  // My farm home → Trades through the farm menu.
  await page.goto(`/farms/${farmId}`);
  await expect(page.getByText(/For sale: 1/).first()).toBeVisible();
  const menu = page.getByRole('navigation', { name: 'My farm menu' });
  await menu.getByRole('button', { name: 'Trade', exact: true }).click();
  await menu.getByRole('link', { name: 'Trades' }).click();
  await expect(page).toHaveURL(new RegExp(`/farms/${farmId}/trades$`));
  const listings = page.getByRole('table', { name: 'Listings' });
  await expect(listings.getByText(title).locator('visible=true').first()).toBeVisible();
  await expect(listings.getByText('Active').locator('visible=true').first()).toBeVisible();

  // The animal itself shows "For sale" (set by the server when the listing went live).
  await page.goto(`/farms/${farmId}/animals/${animalId}`);
  await expect(page.getByText('For sale').first()).toBeVisible();

  // Cancel the listing in the seller tools.
  await page.goto(`/market/sell/${farmId}/${listingId}`);
  await page.getByRole('button', { name: 'Cancel listing' }).click();
  const dialog = page.getByRole('dialog');
  const cancelled = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith(`/listings/${listingId}/cancel`),
  );
  await dialog.getByRole('button', { name: 'Cancel listing' }).click();
  expect((await cancelled).status()).toBe(200);

  const animal = await request.get(
    `${api()}/api/v1/farms/${farmId}/animals/${animalId}`,
    authed(seller),
  );
  expect((await animal.json()).animal.currentStatus).toBe('active');
  await page.goto(`/farms/${farmId}/trades`);
  await expect(
    page
      .getByRole('table', { name: 'Listings' })
      .getByText('Cancelled')
      .locator('visible=true')
      .first(),
  ).toBeVisible();

  // The pedigree page is reachable from the animal.
  await page.goto(`/farms/${farmId}/animals/${animalId}`);
  await page.getByRole('link', { name: 'Pedigree' }).click();
  await expect(page.getByText('No parents recorded for this animal yet.')).toBeVisible();
});
