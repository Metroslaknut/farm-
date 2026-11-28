import { expect, test } from '@playwright/test';
import { currentStep, totpAt } from '../../services/api/src/lib/totp';
import { authed, closeDb, grantRoles, PASSWORD, register, sellerWithListing } from '../helpers';

test.afterAll(closeDb);

const api = () => process.env['E2E_API']!;

test('a finance admin finds an order by its number and opens the read-only detail', async ({
  page,
  request,
}) => {
  // --- an order exists: offer → accept → pickup checkout (all through the real API) ----------------------------------
  const { seller, listingId } = await sellerWithListing(request, 'E2E Admin Orders Buffalo');
  const buyer = await register(request, 'Order Finder Buyer');
  const offer = await request.post(
    `${api()}/api/v1/marketplace/listings/${listingId}/negotiations`,
    {
      ...authed(buyer),
      data: { amountMinor: 4_500_000 },
    },
  );
  expect(offer.status(), await offer.text()).toBe(201);
  const negotiationId = (await offer.json()).negotiation.id as string;
  const accepted = await request.post(
    `${api()}/api/v1/marketplace/negotiations/${negotiationId}/accept`,
    { ...authed(seller), data: { expectedSeq: 1 } },
  );
  expect(accepted.status(), await accepted.text()).toBe(200);
  const placed = await request.post(`${api()}/api/v1/orders`, {
    ...authed(buyer),
    data: { negotiationId, fulfillment: 'pickup' },
  });
  expect(placed.status(), await placed.text()).toBe(201);
  const order = (await placed.json()).order as { id: string; orderNo: string };

  // --- a finance admin with MFA signs in to the backoffice ------------------------------------------------------------
  const finance = await register(request, 'Finance Reviewer');
  await grantRoles(finance.id, ['finance_admin']);
  const setup = await request.post(`${api()}/api/v1/auth/mfa/setup`, authed(finance));
  expect(setup.status(), await setup.text()).toBe(200);
  const secret = (await setup.json()).secret as string;
  const enabled = await request.post(`${api()}/api/v1/auth/mfa/enable`, {
    ...authed(finance),
    data: { code: totpAt(secret, currentStep()) },
  });
  expect(enabled.status(), await enabled.text()).toBe(200);

  await page.goto('/admin/orders');
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.getByLabel('Email or phone').fill(finance.email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // The setup/enable step consumed the current TOTP; login requires a fresh, later step.
  await page
    .getByLabel('Authenticator code or recovery code')
    .fill(totpAt(secret, currentStep() + 1));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/admin\/orders/);

  // --- search by the exact order number ------------------------------------------------------------------------------
  await page.getByLabel('Order number').fill(order.orderNo.toLowerCase());
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(new RegExp(`orderNo=${order.orderNo.toLowerCase()}`));
  await expect(page.getByRole('row')).toHaveCount(2); // header + the one match
  await page.getByRole('link', { name: order.orderNo }).click();

  await expect(page).toHaveURL(new RegExp(`/admin/orders/${order.id}$`));
  await expect(page.getByRole('heading', { name: order.orderNo })).toBeVisible();
  await expect(
    page.getByText('This page is read-only: no order actions are taken from here.'),
  ).toBeVisible();
  await expect(page.getByText('No delivery address (pickup).')).toBeVisible();
  await expect(page.getByText('Order Finder Buyer', { exact: true })).toBeVisible();
});
