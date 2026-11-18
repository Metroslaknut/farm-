import { expect, test } from '@playwright/test';
import mongoose from 'mongoose';
import {
  authed,
  closeDb,
  grantRoles,
  newSession,
  register,
  sellerWithListing,
  signIn,
} from '../helpers';

test.afterAll(closeDb);

test('buyer and seller chat live in two browsers: unread badges, realtime delivery, escaping, blocking, reconnection, privacy', async ({
  browser,
  request,
}) => {
  const { seller, listingId } = await sellerWithListing(request);
  const buyer = await register(request, 'Nok Buyer');
  const intruder = await register(request, 'Intruder');
  await grantRoles(buyer.id, []);

  const sellerSide = await newSession(browser);
  const buyerSide = await newSession(browser);
  const sp = sellerSide.page;
  const bp = buyerSide.page;
  const pwned: string[] = [];
  for (const p of [sp, bp]) p.on('dialog', (d) => (pwned.push(d.message()), void d.dismiss()));

  // The seller is already looking at the site (any page with the header) when the buyer writes.
  await signIn(sp, seller, '/market');
  await expect(sp.getByRole('link', { name: /Messages, 0 unread/ })).toBeVisible();

  // --- the buyer contacts the seller from the listing page ---------------------------------------------------------
  await signIn(bp, buyer, `/market/listing/${listingId}`);
  await bp.getByRole('button', { name: 'Message seller' }).click();
  await bp.getByLabel('Your message').fill('Is the buffalo still available?');
  await bp.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(bp).toHaveURL(/\/messages\/[a-f0-9]{24}/);
  const threadUrl = bp.url();
  await expect(bp.getByRole('log', { name: 'Messages' })).toContainText(
    'Is the buffalo still available?',
  );

  // --- the seller's header badge updates by itself (Socket.IO), without a reload ----------------------------------
  await expect(sp.getByRole('link', { name: /Messages, 1 unread/ })).toBeVisible();
  await expect(sp.getByRole('link', { name: /Notifications, 1 unread/ })).toBeVisible();
  const persistedNotifications = await (
    await request.get(`${process.env['E2E_API']}/api/v1/notifications`, authed(seller))
  ).json();
  expect(persistedNotifications.items.some((n: { type: string }) => n.type === 'message.new')).toBe(
    true,
  );
  const db = mongoose.connection.db!;
  expect(
    await db.collection('notifications').findOne({
      userId: new mongoose.Types.ObjectId(seller.id),
      type: 'message.new',
    }),
  ).toBeTruthy();

  // --- the seller opens the conversation: read, and replies; the buyer receives it live ----------------------------
  await sp.getByRole('link', { name: /Messages, 1 unread/ }).click();
  await sp.getByRole('link', { name: /Nok Buyer/ }).click();
  await expect(sp.getByRole('log', { name: 'Messages' })).toContainText(
    'Is the buffalo still available?',
  );
  await expect(sp.getByRole('link', { name: /Messages, 0 unread/ })).toBeVisible();
  await sp.getByLabel('Write a message').fill('Yes! Come and see her on Sunday.');
  await sp.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(bp.getByRole('log', { name: 'Messages' })).toContainText(
    'Yes! Come and see her on Sunday.',
  );
  await expect(bp.getByRole('log', { name: 'Messages' })).toContainText('Read'); // the seller had read the first message

  // --- hostile text is displayed, never executed -------------------------------------------------------------------
  const hostile = '<img src=x onerror="window.__pwned=1"> <script>window.__pwned=2</script>';
  await bp.getByLabel('Write a message').fill(hostile);
  await bp.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(sp.getByRole('log', { name: 'Messages' })).toContainText('<img src=x onerror=');
  expect(
    await sp.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
  ).toBeUndefined();
  expect(await sp.locator('[role="log"] img, [role="log"] script').count()).toBe(0);
  expect(pwned).toEqual([]);

  // --- a dropped connection recovers by itself and catches up on what it missed ---------------------------------------
  await buyerSide.context.setOffline(true);
  await sp.getByLabel('Write a message').fill('Sent while you were offline.');
  await sp.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(sp.getByRole('log', { name: 'Messages' })).toContainText(
    'Sent while you were offline.',
  );
  await buyerSide.context.setOffline(false);
  await expect(bp.getByRole('log', { name: 'Messages' })).toContainText(
    'Sent while you were offline.',
    { timeout: 30_000 },
  );

  // --- somebody who is not in the conversation cannot open it -----------------------------------------------------
  const intruderSide = await newSession(browser);
  await signIn(intruderSide.page, intruder, new URL(threadUrl).pathname);
  await expect(intruderSide.page.getByRole('log', { name: 'Messages' })).toHaveCount(0);
  await expect(intruderSide.page.getByRole('alert')).toContainText(
    /not found|no longer have access/i,
  );
  await expect(intruderSide.page.getByText('Is the buffalo still available?')).toHaveCount(0);

  // --- the seller blocks the conversation: the buyer can no longer send ---------------------------------------------
  await sp.getByRole('button', { name: 'Block' }).click();
  await expect(sp.getByText(/You blocked this conversation/)).toBeVisible();
  await bp.reload();
  await expect(bp.getByText(/cannot be sent in this conversation/)).toBeVisible();
  await expect(bp.getByLabel('Write a message')).toBeDisabled();
  await expect(bp.getByText(/blocked/i)).toHaveCount(0); // the buyer is not told who blocked, or even the word

  await Promise.all([
    sellerSide.context.close(),
    buyerSide.context.close(),
    intruderSide.context.close(),
  ]);
});
