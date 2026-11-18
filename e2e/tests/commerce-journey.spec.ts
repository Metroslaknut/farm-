import { expect, test } from '@playwright/test';
import mongoose from 'mongoose';
import { authed, closeDb, newSession, register, sellerWithListing, signIn } from '../helpers';

test.afterAll(closeDb);

/**
 * The Web UI end to end, two browsers: a buyer makes an offer on a listing, the seller accepts it, the buyer checks out and pays
 * (test-mode provider), the seller processes the order, the buyer confirms receipt. Money is then checked through the API.
 */
test('offer → accept → checkout → pay → process → received, in the browser, with the right money at the end', async ({
  browser,
  request,
}) => {
  const { seller, listingId, title } = await sellerWithListing(request, 'Browser Journey Buffalo');
  const buyer = await register(request, 'Nok Buyer');
  const api = process.env['E2E_API']!;

  const sellerSide = await newSession(browser);
  const buyerSide = await newSession(browser);
  const sp = sellerSide.page;
  const bp = buyerSide.page;

  // --- the buyer makes an offer ---------------------------------------------------------------------------------
  await signIn(bp, buyer, `/market/listing/${listingId}`);
  await expect(bp.getByRole('heading', { name: title })).toBeVisible();
  await bp.getByLabel('Your offer (฿)').fill('45000');
  await bp.getByRole('button', { name: 'Send offer' }).click();
  await expect(bp).toHaveURL(/\/market\/offers\/[a-f0-9]{24}/);
  const negotiationPath = new URL(bp.url()).pathname;
  const negotiationId = negotiationPath.split('/').pop()!;

  // --- the seller (another browser) sees the offer and accepts it ----------------------------------------------------
  await signIn(sp, seller, negotiationPath);
  await expect(sp.getByRole('button', { name: /Accept ฿45,000\.00/ })).toBeVisible();
  await sp.getByRole('button', { name: /Accept ฿45,000\.00/ }).click();
  await sp.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(sp.getByText(/accepted/i).first()).toBeVisible();

  // --- the buyer checks out (collects the animal) and places the order -----------------------------------------------
  await bp.goto(`/market/checkout/${negotiationId}`);
  await bp.getByLabel('I will collect the animal').check();
  await bp.getByRole('button', { name: 'Place order' }).click();
  await expect(bp).toHaveURL(/\/market\/orders\/[a-f0-9]{24}/);
  const orderPath = new URL(bp.url()).pathname;
  await expect(bp.getByText(/Order\s+FP-/)).toBeVisible();

  // --- pay with the test-mode provider -------------------------------------------------------------------------------
  await bp.getByRole('button', { name: /^Pay ฿45,000\.00/ }).click();
  await bp.getByRole('button', { name: 'Simulate successful payment' }).click();
  await expect(bp.getByText('PAID', { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  // --- the seller processes it; the buyer collects it ------------------------------------------------------------------
  await sp.goto(orderPath);
  await sp.getByRole('button', { name: 'Start processing' }).click();
  await expect(sp.getByText(/PROCESSING/i).first()).toBeVisible();
  await bp.reload();
  await bp.getByRole('button', { name: 'I collected the animal' }).click();
  await expect(bp.getByText(/DELIVERED|completed/i).first()).toBeVisible({ timeout: 15_000 });

  // --- the books: 45,000 with no commission rule configured → the seller is credited the full price, nothing is pending ---
  const walletOf = async () =>
    (await (await request.get(`${api}/api/v1/wallet`, authed(seller))).json()).wallet as {
      availableMinor: number;
      pendingMinor: number;
    };
  await expect
    .poll(async () => (await walletOf()).availableMinor, { timeout: 15_000 })
    .toBe(4_500_000);
  expect((await walletOf()).pendingMinor).toBe(0);
  const order = await (
    await request.get(`${api}/api/v1${orderPath.replace('/market', '')}`, authed(buyer))
  ).json();
  expect(order.order.status).toBe('DELIVERED');
  expect(order.order.totals.grandTotalMinor).toBe(4_500_000);

  // Confirm the completed browser flow is durable in the disposable MongoDB, not only in UI state/API DTOs.
  const db = mongoose.connection.db!;
  const orderObjectId = new mongoose.Types.ObjectId(orderPath.split('/').pop()!);
  const storedOrder = await db.collection('orders').findOne({ _id: orderObjectId });
  expect(storedOrder?.status).toBe('DELIVERED');
  expect(storedOrder?.grandTotalMinor).toBe(4_500_000);
  const appliedPayments = await db
    .collection('payments')
    .find({ orderId: orderObjectId, disposition: 'applied' })
    .toArray();
  expect(appliedPayments).toHaveLength(1);
  expect(appliedPayments[0]?.amountMinor).toBe(4_500_000);
  const journals = await db
    .collection('wallet_transactions')
    .aggregate([
      { $match: { orderId: orderObjectId } },
      { $group: { _id: '$journalKey', total: { $sum: '$amountMinor' }, lines: { $sum: 1 } } },
    ])
    .toArray();
  expect(journals.length).toBeGreaterThan(0);
  expect(journals.every((journal) => journal.total === 0 && journal.lines >= 2)).toBe(true);

  // --- the same order, seen by someone who is not a party to it ------------------------------------------------------------
  const stranger = await register(request, 'Stranger');
  const outsider = await newSession(browser);
  await signIn(outsider.page, stranger, orderPath);
  await expect(outsider.page.getByText(/Order\s+FP-/)).toHaveCount(0);
  await Promise.all([
    sellerSide.context.close(),
    buyerSide.context.close(),
    outsider.context.close(),
  ]);
});
