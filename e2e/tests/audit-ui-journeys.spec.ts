import { createHmac, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import mongoose from 'mongoose';
import {
  authed,
  closeDb,
  grantRoles,
  newSession,
  PASSWORD,
  register,
  signIn,
  type User,
} from '../helpers';

test.afterAll(closeDb);

/**
 * Audit journeys: every journey drives the REAL web UI, then checks the outcome through the API and directly in the
 * disposable MongoDB. Preconditions (accounts, staff MFA, a paid order) are set up through the API / test database,
 * exactly like the other specs; every user decision under test is made in the browser.
 */
const api = () => process.env['E2E_API']!;
const oid = (id: string) => new mongoose.Types.ObjectId(id);
const db = () => mongoose.connection.db!;
/** helpers.grantRoles opens the shared mongoose connection; an empty grant just connects. */
const connectDb = async (u: User) => grantRoles(u.id, []);

// ---------------------------------------------------------------------------------------------------------------
// Staff with MFA: enrol through the real API (setup → TOTP → enable), sign in to the admin UI with a recovery code.
// ---------------------------------------------------------------------------------------------------------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input.replace(/=+$/, '').toUpperCase()) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totp(secret: string, now = Date.now()): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

interface Staff extends User {
  recoveryCodes: string[];
}
async function staffWithMfa(
  request: APIRequestContext,
  roles: string[],
  name: string,
): Promise<Staff> {
  const u = await register(request, name);
  const setup = await request.post(`${api()}/api/v1/auth/mfa/setup`, authed(u));
  expect(setup.status(), await setup.text()).toBe(200);
  const { secret } = await setup.json();
  const enable = await request.post(`${api()}/api/v1/auth/mfa/enable`, {
    ...authed(u),
    data: { code: totp(secret) },
  });
  expect(enable.status(), await enable.text()).toBe(200);
  const { recoveryCodes } = await enable.json();
  await grantRoles(u.id, roles);
  return { ...u, recoveryCodes: [...recoveryCodes] };
}

async function adminSignIn(page: Page, staff: Staff, then: string): Promise<void> {
  await page.goto('/admin/login');
  await page.getByLabel('Email or phone').fill(staff.email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Authenticator code or recovery code').fill(staff.recoveryCodes.shift()!);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).not.toHaveURL(/\/admin\/login/);
  await page.goto(then);
}

async function setSetting(key: string, value: unknown): Promise<void> {
  await db().collection('settings').updateOne({ key }, { $set: { key, value } }, { upsert: true });
}

// ---------------------------------------------------------------------------------------------------------------
// A PAID shop order (pickup or delivery) created through the API with the mock provider, as the other specs do.
// ---------------------------------------------------------------------------------------------------------------
const ADDRESS = {
  recipientName: 'Nok Buyer',
  phone: '0812345678',
  line1: '99 Moo 4 Synthetic Road',
  district: 'Mueang',
  province: 'Chiang Mai',
  postalCode: '50000',
};
async function paidShopOrder(
  request: APIRequestContext,
  opts: { delivery: boolean; priceMinor: number; quantity?: number; label: string },
) {
  const seller = await register(request, `${opts.label} Seller`);
  await connectDb(seller);
  await grantRoles(seller.id, ['farm_owner', 'seller']);
  const farm = await request.post(`${api()}/api/v1/farms`, {
    ...authed(seller),
    data: { name: `${opts.label} Farm` },
  });
  expect(farm.status(), await farm.text()).toBe(201);
  const farmId = (await farm.json()).farm.id as string;
  const title = `${opts.label} feed ${randomBytes(2).toString('hex')}`;
  const created = await request.post(`${api()}/api/v1/farms/${farmId}/products`, {
    ...authed(seller),
    data: {
      categoryKey: 'feed',
      title,
      description: 'Balanced pellet feed for lactating cattle.',
      sku: `SKU-${randomBytes(3).toString('hex')}`,
      unit: 'bag',
      priceMinor: opts.priceMinor,
      stock: 10,
      photos: [{ url: 'https://cdn.example.test/p1.jpg' }],
      deliveryOptions: opts.delivery ? ['delivery'] : ['pickup'],
      ...(opts.delivery
        ? { shipping: { mode: 'flat', flatPriceMinor: 10_000, estimatedDays: { min: 1, max: 3 } } }
        : {}),
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const productId = (await created.json()).product.id as string;
  // Same precondition as WF-UI-H03: product moderation approval is outside this journey.
  await db()
    .collection('products')
    .updateOne(
      { _id: oid(productId) },
      { $set: { status: 'ACTIVE', 'review.approvedAt': new Date() } },
    );

  const buyer = await register(request, `${opts.label} Buyer`);
  const put = await request.put(`${api()}/api/v1/shop/cart/items/${productId}`, {
    ...authed(buyer),
    data: { quantity: opts.quantity ?? 1 },
  });
  expect(put.status(), await put.text()).toBe(200);
  const cartRes = await request.get(
    `${api()}/api/v1/shop/cart${opts.delivery ? `?province=${encodeURIComponent(ADDRESS.province)}` : ''}`,
    authed(buyer),
  );
  const cart = (await cartRes.json()).cart;
  const checkout = await request.post(`${api()}/api/v1/shop/cart/checkout`, {
    ...authed(buyer),
    data: {
      fulfillment: opts.delivery ? 'delivery' : 'pickup',
      ...(opts.delivery ? { address: ADDRESS } : {}),
      expected: cart.groups.map(
        (g: { farmId: string; itemsMinor: number; shipping?: { shippingMinor?: number } }) => ({
          farmId: g.farmId,
          itemsMinor: g.itemsMinor,
          shippingMinor: opts.delivery ? (g.shipping?.shippingMinor ?? 0) : 0,
        }),
      ),
    },
  });
  expect(checkout.status(), await checkout.text()).toBe(201);
  const order = (await checkout.json()).orders[0];
  const orderId = order.id as string;

  const pay = await request.post(`${api()}/api/v1/payments`, {
    ...authed(buyer),
    headers: {
      ...authed(buyer).headers,
      'Idempotency-Key': `e2e-${randomBytes(8).toString('hex')}`,
    },
    data: { orderId },
  });
  expect(pay.status(), await pay.text()).toBe(201);
  const paymentId = (await pay.json()).payment.id as string;
  const done = await request.post(`${api()}/api/v1/payments/${paymentId}/mock-complete`, {
    ...authed(buyer),
    data: { outcome: 'succeeded' },
  });
  expect(done.status(), await done.text()).toBe(200);
  const orderOf = async () =>
    (await (await request.get(`${api()}/api/v1/orders/${orderId}`, authed(buyer))).json()).order;
  await expect.poll(async () => (await orderOf()).status, { timeout: 15_000 }).toBe('PAID');
  const total = (await orderOf()).totals.grandTotalMinor as number;
  return { seller, buyer, farmId, productId, orderId, paymentId, total, title, orderOf };
}

/** Every journal touching these ids balances to zero and has ≥ 2 lines. */
async function journalsBalance(match: Record<string, unknown>) {
  const journals = await db()
    .collection('wallet_transactions')
    .aggregate([
      { $match: match },
      { $group: { _id: '$journalKey', total: { $sum: '$amountMinor' }, lines: { $sum: 1 } } },
    ])
    .toArray();
  expect(journals.length).toBeGreaterThan(0);
  for (const j of journals) {
    expect(j.total, `journal ${j._id} must balance`).toBe(0);
    expect(j.lines).toBeGreaterThanOrEqual(2);
  }
  return journals.map((j) => String(j._id));
}

/** The wallet projection equals the sum of its ledger lines per bucket. */
async function walletMatchesLedger(walletId: mongoose.Types.ObjectId) {
  const wallet = await db().collection('wallets').findOne({ _id: walletId });
  const sums = await db()
    .collection('wallet_transactions')
    .aggregate([
      { $match: { walletId } },
      { $group: { _id: '$bucket', total: { $sum: '$amountMinor' } } },
    ])
    .toArray();
  const of = (b: string) => sums.find((s) => s._id === b)?.total ?? 0;
  expect(wallet?.availableMinor).toBe(of('available'));
  expect(wallet?.pendingMinor).toBe(of('pending'));
  return wallet!;
}

// ---------------------------------------------------------------------------------------------------------------
// CSV parsing (RFC 4180, BOM-aware)
// ---------------------------------------------------------------------------------------------------------------
function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && src[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** `YYYY-MM-DD`, n days before today (UTC calendar; all chosen dates are well away from "today"). */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

// =================================================================================================================
test('UI-I05 farm analytics: owner filters the dashboard by dates and downloads the Costs CSV; it matches the API export and the DB; a viewer and a stranger cannot export it', async ({
  page,
  browser,
  request,
}) => {
  const owner = await register(request, 'Analytics Owner');
  await connectDb(owner);
  await grantRoles(owner.id, ['farm_owner']);
  const farm = await request.post(`${api()}/api/v1/farms`, {
    ...authed(owner),
    data: { name: 'Analytics Farm' },
  });
  expect(farm.status(), await farm.text()).toBe(201);
  const farmId = (await farm.json()).farm.id as string;

  const from = daysAgo(40);
  const to = daysAgo(20);
  // Two inside on the exact boundaries, one in the middle, two just outside.
  const expenses = [
    { expenseDate: daysAgo(41), amount: 999.99, category: 'feed', description: 'Before range' },
    { expenseDate: from, amount: 1250.5, category: 'feed', description: 'Rice straw, first day' },
    {
      expenseDate: daysAgo(30),
      amount: 800,
      category: 'veterinary',
      description: 'Vet visit, mid range',
    },
    { expenseDate: to, amount: 49.5, category: 'other', description: 'Rope "heavy", last day' },
    { expenseDate: daysAgo(19), amount: 77.77, category: 'labor', description: 'After range' },
  ];
  for (const e of expenses) {
    const r = await request.post(`${api()}/api/v1/farms/${farmId}/expenses`, {
      ...authed(owner),
      data: e,
    });
    expect(r.status(), await r.text()).toBe(201);
  }

  // --- UI: owner applies the date range and downloads the Costs CSV --------------------------------------------
  await signIn(page, owner, `/farms/${farmId}/dashboard`);
  await expect(page.getByRole('heading', { name: 'Farm dashboard' })).toBeVisible();
  await page.getByLabel('From', { exact: true }).fill(from);
  await page.getByLabel('To', { exact: true }).fill(to);
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(new RegExp(`from=${from}.*to=${to}`));
  const costsButton = page.getByRole('button', { name: 'Costs', exact: true });
  await expect(costsButton).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), costsButton.click()]);
  expect(download.suggestedFilename()).toBe(`costs_${from}_${to}.csv`);
  const uiBytes = await readFile((await download.path())!);
  await expect(page.getByRole('status').filter({ hasText: 'saved' })).toBeVisible();

  // --- API: the same export -------------------------------------------------------------------------------------
  const apiRes = await request.get(
    `${api()}/api/v1/farms/${farmId}/dashboard/export?section=costs&from=${from}&to=${to}`,
    authed(owner),
  );
  expect(apiRes.status()).toBe(200);
  expect(apiRes.headers()['content-type']).toContain('text/csv');
  const apiBytes = await apiRes.body();
  // The browser file is byte-identical to the API file (including the UTF-8 BOM for Excel).
  expect(uiBytes.subarray(0, 3).toString('hex')).toBe('efbbbf');
  expect(uiBytes.equals(apiBytes)).toBe(true);

  const rows = parseCsv(uiBytes.toString('utf8'));
  expect(rows[0]).toEqual([
    'Date',
    'Category',
    'Amount (THB)',
    'Animal code',
    'Assigned to an animal',
    'Description',
    'Supplier',
  ]);
  const body = rows.slice(1);

  // --- DB: the source records ---------------------------------------------------------------------------------------
  const start = new Date(`${from}T00:00:00+07:00`);
  const endExclusive = new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86_400_000);
  const source = await db()
    .collection('farm_expenses')
    .find({ farmId: oid(farmId), voided: false, expenseDate: { $gte: start, $lt: endExclusive } })
    .sort({ expenseDate: 1 })
    .toArray();
  expect(source).toHaveLength(3);
  expect(body).toHaveLength(source.length);
  body.forEach((r, i) => {
    const s = source[i]!;
    expect(r[0]).toBe((s.expenseDate as Date).toISOString().slice(0, 10));
    expect(r[1]).toBe(s.category);
    expect(Number(r[2])).toBe(s.amountMinor / 100);
    expect(r[5]).toBe(s.description);
  });
  expect(body.map((r) => r[5])).toEqual([
    'Rice straw, first day',
    'Vet visit, mid range',
    'Rope "heavy", last day',
  ]);
  const csvTotalMinor = body.reduce((a, r) => a + Math.round(Number(r[2]) * 100), 0);
  const dbTotalMinor = source.reduce((a, s) => a + (s.amountMinor as number), 0);
  expect(csvTotalMinor).toBe(210_000);
  expect(csvTotalMinor).toBe(dbTotalMinor);
  // …and the dashboard's own KPI for the same range agrees.
  const dash = await (
    await request.get(
      `${api()}/api/v1/farms/${farmId}/dashboard?from=${from}&to=${to}`,
      authed(owner),
    )
  ).json();
  expect(dash.sections.costs.metrics.recordedCostMinor).toBe(dbTotalMinor);
  expect(dash.sections.costs.metrics.expenseRecords).toBe(3);
  // The export is audited.
  const audit = await db()
    .collection('audit_logs')
    .find({ action: 'analytics.export', actorId: oid(owner.id), targetId: farmId })
    .toArray();
  expect(audit.length).toBeGreaterThanOrEqual(2);
  expect(audit.every((a) => a.metadata?.section === 'costs' && a.metadata?.rows === 3)).toBe(true);

  // --- a farm VIEWER: sees the dashboard but has no Costs export, and the API refuses it --------------------------
  const viewer = await register(request, 'Farm Viewer');
  const add = await request.post(`${api()}/api/v1/farms/${farmId}/members`, {
    ...authed(owner),
    data: { email: viewer.email, role: 'viewer' },
  });
  expect(add.status(), await add.text()).toBe(201);
  const v = await newSession(browser);
  await signIn(v.page, viewer, `/farms/${farmId}/dashboard?from=${from}&to=${to}`);
  await expect(v.page.getByRole('heading', { name: 'Farm dashboard' })).toBeVisible();
  await expect(v.page.getByText('Download CSV:')).toBeVisible();
  await expect(v.page.getByRole('button', { name: 'Costs', exact: true })).toHaveCount(0);
  const viewerRes = await request.get(
    `${api()}/api/v1/farms/${farmId}/dashboard/export?section=costs&from=${from}&to=${to}`,
    authed(viewer),
  );
  expect(viewerRes.status()).toBe(403);
  expect((await viewerRes.json()).error.code).toBe('EXPORT_FORBIDDEN');

  // --- an unrelated user: no dashboard, no export of any section -------------------------------------------------
  const stranger = await register(request, 'Analytics Stranger');
  const s = await newSession(browser);
  await signIn(s.page, stranger, `/farms/${farmId}/dashboard`);
  await expect(s.page.getByRole('heading', { name: 'Farm dashboard' })).toBeVisible();
  await expect(s.page.getByText('Download CSV:')).toHaveCount(0);
  for (const section of ['costs', 'animals', 'growth']) {
    const r = await request.get(
      `${api()}/api/v1/farms/${farmId}/dashboard/export?section=${section}`,
      authed(stranger),
    );
    expect([403, 404]).toContain(r.status());
    expect(await r.text()).not.toContain('Vet visit');
  }
  const strangerAudit = await db()
    .collection('audit_logs')
    .countDocuments({ action: 'analytics.export', actorId: oid(stranger.id) });
  expect(strangerAudit).toBe(0);
  await Promise.all([v.context.close(), s.context.close()]);
});

// =================================================================================================================
test('UI-F05 seller withdrawal: the seller adds a payout account and requests a withdrawal in the Wallet UI; a finance admin (MFA) approves it in the admin UI; DB and seller UI agree', async ({
  browser,
  request,
}) => {
  // Precondition: earnings from a completed (paid → processing → collected) pickup order.
  const o = await paidShopOrder(request, { delivery: false, priceMinor: 250_000, label: 'Payout' });
  const { seller, buyer, orderId, total } = o;
  expect(total).toBe(250_000);
  expect(
    (await request.post(`${api()}/api/v1/orders/${orderId}/process`, authed(seller))).status(),
  ).toBe(200);
  expect(
    (
      await request.post(`${api()}/api/v1/orders/${orderId}/confirm-delivery`, authed(buyer))
    ).status(),
  ).toBe(200);
  await expect
    .poll(
      async () =>
        (await (await request.get(`${api()}/api/v1/wallet`, authed(seller))).json()).wallet
          .availableMinor,
      {
        timeout: 15_000,
      },
    )
    .toBe(250_000);
  await setSetting('finance.payoutsEnabled', true);
  await setSetting('finance.minWithdrawalMinor', 10_000);

  // --- seller: payout account + withdrawal in the Wallet UI ------------------------------------------------------
  const sellerSide = await newSession(browser);
  const sp = sellerSide.page;
  await signIn(sp, seller, '/market/wallet');
  await expect(sp.getByRole('heading', { name: 'My earnings' })).toBeVisible();
  await expect(sp.getByText('฿2,500.00').first()).toBeVisible();
  await expect(sp.getByText('Add a payout account to withdraw.')).toBeVisible();
  const accountForm = sp.getByRole('form', { name: 'Payout account' });
  await accountForm.getByLabel('Bank code (e.g. KBANK, SCB)').fill('kbank');
  await accountForm.getByLabel('Account number').fill('123-4-56789-0');
  await accountForm.getByLabel('Account holder name').fill('Somchai Synthetic');
  await accountForm.getByRole('button', { name: 'Save payout account' }).click();
  await expect(sp.getByText('Somchai Synthetic · KBANK · ••••7890')).toBeVisible();

  const wdForm = sp.getByRole('form', { name: 'Request a withdrawal' });
  await wdForm.getByLabel('Amount (฿)').fill('1000');
  await wdForm.getByRole('button', { name: 'Request withdrawal' }).click();
  const wdRow = sp.getByRole('listitem').filter({ hasText: '฿1,000.00' });
  await expect(wdRow.getByText('Requested')).toBeVisible();

  const wd = await db()
    .collection('withdrawals')
    .findOne({ sellerId: oid(seller.id) });
  expect(wd).toBeTruthy();
  expect(wd!.status).toBe('requested');
  expect(wd!.amountMinor).toBe(100_000);
  expect(wd!.bankCode).toBe('KBANK');
  expect(wd!.accountLast4).toBe('7890');
  expect(String(wd!.destinationEnc)).not.toContain('1234567890');
  const sellerWallet = await db()
    .collection('wallets')
    .findOne({ ownerId: oid(seller.id) });
  expect(sellerWallet!.payoutAccountEnc).toBeTruthy();
  expect(String(sellerWallet!.payoutAccountEnc)).not.toContain('1234567890');
  expect(sellerWallet!.availableMinor).toBe(150_000); // held at request time

  // --- finance admin (MFA) approves in the admin UI --------------------------------------------------------------
  const finance = await staffWithMfa(request, ['finance_admin'], 'Finance Admin');
  const adminSide = await newSession(browser);
  const ap = adminSide.page;
  await adminSignIn(ap, finance, '/admin/withdrawals');
  await expect(ap.getByRole('heading', { name: 'Withdrawals' })).toBeVisible();
  const row = ap.getByRole('row').filter({ hasText: wd!.withdrawalNo });
  await expect(row).toBeVisible();
  await expect(row).toContainText('฿1,000.00');
  await expect(row).toContainText('••••7890');
  await expect(row).not.toContainText('1234567890');
  await row.getByRole('button', { name: 'Approve' }).click();
  const dialog = ap.getByRole('dialog', { name: 'Approve withdrawal' });
  const confirm = dialog.getByRole('button', { name: 'Approve and pay' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/Type .* to confirm/).fill(wd!.withdrawalNo);
  await confirm.click();
  await expect(dialog).toBeHidden();
  await expect(row).toHaveCount(0); // gone from the "requested" queue

  // --- API -----------------------------------------------------------------------------------------------------------
  const mine = await (
    await request.get(`${api()}/api/v1/wallet/withdrawals`, authed(seller))
  ).json();
  expect(mine.items[0]).toMatchObject({
    withdrawalNo: wd!.withdrawalNo,
    status: 'paid',
    amountMinor: 100_000,
  });
  const walletApi = (await (await request.get(`${api()}/api/v1/wallet`, authed(seller))).json())
    .wallet;
  expect(walletApi.availableMinor).toBe(150_000);
  expect(walletApi.pendingMinor).toBe(0);

  // --- DB --------------------------------------------------------------------------------------------------------------
  const after = await db().collection('withdrawals').findOne({ _id: wd!._id });
  expect(after!.status).toBe('paid');
  expect(String(after!.decidedBy)).toBe(finance.id);
  expect(after!.paidAt).toBeTruthy();
  const wallet = await walletMatchesLedger(sellerWallet!._id);
  expect(wallet.availableMinor).toBe(150_000);
  const keys = await journalsBalance({ refType: 'withdrawal', refId: String(wd!._id) });
  expect(keys.sort()).toEqual([`wd_hold:${wd!._id}`, `wd_paid:${wd!._id}`].sort());
  const sellerLines = await db()
    .collection('wallet_transactions')
    .find({ walletId: sellerWallet!._id, refId: String(wd!._id) })
    .toArray();
  expect(sellerLines.map((l) => [l.type, l.bucket, l.amountMinor])).toEqual([
    ['withdrawal_hold', 'available', -100_000],
  ]);
  const finAudit = await db()
    .collection('financial_audit_logs')
    .find({ targetId: String(wd!._id) })
    .toArray();
  expect(finAudit.map((a) => a.action)).toEqual(
    expect.arrayContaining(['withdrawal.requested', 'withdrawal.approved', 'withdrawal.paid']),
  );

  // --- the seller's UI shows the new state -------------------------------------------------------------------------
  await sp.reload();
  await expect(
    sp.getByRole('listitem').filter({ hasText: wd!.withdrawalNo }).getByText('Paid'),
  ).toBeVisible();
  await expect(sp.getByText('฿1,500.00').first()).toBeVisible();
  await Promise.all([sellerSide.context.close(), adminSide.context.close()]);
});

// =================================================================================================================
test('UI-F04 refund approval: the buyer cancels a paid order in the UI, a finance admin (MFA) approves the refund in the admin UI; Refund, Order and ledger agree', async ({
  browser,
  request,
}) => {
  const o = await paidShopOrder(request, { delivery: false, priceMinor: 120_000, label: 'Refund' });
  const { buyer, seller, orderId, paymentId, total } = o;

  // --- buyer cancels in the UI -------------------------------------------------------------------------------------
  const buyerSide = await newSession(browser);
  const bp = buyerSide.page;
  await signIn(bp, buyer, `/market/orders/${orderId}`);
  await expect(bp.getByText(/Order\s+FP-/)).toBeVisible();
  await bp.getByRole('button', { name: 'Cancel order' }).click();
  const cancel = bp.getByRole('dialog', { name: 'Cancel this order?' });
  await expect(cancel).toContainText('฿1,200.00');
  await cancel.getByLabel('Reason').fill('Changed my mind, ordered by mistake');
  await cancel.getByRole('button', { name: 'Cancel order' }).click();
  await expect(bp.getByText('A refund of ฿1,200.00 is pending.', { exact: false })).toBeVisible();

  const refund = await db()
    .collection('refunds')
    .findOne({ orderId: oid(orderId) });
  expect(refund).toBeTruthy();
  expect(refund!.status).toBe('requested');
  expect(refund!.amountMinor).toBe(total);
  expect(String(refund!.buyerId)).toBe(buyer.id);
  expect(
    (await db()
      .collection('orders')
      .findOne({ _id: oid(orderId) }))!.status,
  ).toBe('REFUND_PENDING');

  // --- finance admin approves --------------------------------------------------------------------------------------
  const finance = await staffWithMfa(request, ['finance_admin'], 'Refund Finance');
  const adminSide = await newSession(browser);
  const ap = adminSide.page;
  await adminSignIn(ap, finance, '/admin/refunds');
  await expect(ap.getByRole('heading', { name: 'Refunds' })).toBeVisible();
  const row = ap.getByRole('row').filter({ hasText: refund!.refundNo });
  await expect(row).toContainText('฿1,200.00');
  await row.getByRole('button', { name: 'Approve' }).click();
  const dialog = ap.getByRole('dialog', { name: 'Approve refund' });
  await dialog.getByLabel(/Type .* to confirm/).fill(refund!.refundNo);
  await dialog.getByRole('button', { name: 'Approve and refund' }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toHaveCount(0);

  // --- API ---------------------------------------------------------------------------------------------------------
  await expect.poll(async () => (await o.orderOf()).status, { timeout: 15_000 }).toBe('REFUNDED');
  // The finance admin's API session was MFA-verified when MFA was enabled, so it may read the refund.
  const adminRefund = await request.get(
    `${api()}/api/v1/admin/finance/refunds/${refund!._id}`,
    authed(finance),
  );
  expect(adminRefund.status(), await adminRefund.text()).toBe(200);
  expect((await adminRefund.json()).refund).toMatchObject({
    refundNo: refund!.refundNo,
    status: 'succeeded',
    amountMinor: total,
  });

  // --- DB --------------------------------------------------------------------------------------------------------------
  const r2 = await db().collection('refunds').findOne({ _id: refund!._id });
  expect(r2!.status).toBe('succeeded');
  expect(String(r2!.approvedBy)).toBe(finance.id);
  expect(r2!.completedAt).toBeTruthy();
  const order = await db()
    .collection('orders')
    .findOne({ _id: oid(orderId) });
  expect(order!.status).toBe('REFUNDED');
  const payment = await db()
    .collection('payments')
    .findOne({ _id: oid(paymentId) });
  expect(payment!.status).toBe('refunded');
  const keys = await journalsBalance({ orderId: oid(orderId) });
  expect(keys).toEqual(expect.arrayContaining([`capture:${paymentId}`, `refund:${refund!._id}`]));
  const sellerWallet = await db()
    .collection('wallets')
    .findOne({ ownerId: oid(seller.id) });
  const w = await walletMatchesLedger(sellerWallet!._id);
  expect(w.pendingMinor).toBe(0);
  expect(w.availableMinor).toBe(0);
  const finAudit = await db()
    .collection('financial_audit_logs')
    .find({ targetId: String(refund!._id) })
    .toArray();
  expect(finAudit.map((a) => a.action)).toEqual(expect.arrayContaining(['refund.approved']));

  // --- buyer UI ------------------------------------------------------------------------------------------------------
  await bp.reload();
  await expect(bp.getByText('This order was refunded.')).toBeVisible();
  await Promise.all([buyerSide.context.close(), adminSide.context.close()]);
});

// =================================================================================================================
test('UI-E05 shipment progression: the seller ships a paid delivery order with carrier + tracking; the buyer sees tracking and confirms receipt; Order and Shipment agree in DB', async ({
  browser,
  request,
}) => {
  const o = await paidShopOrder(request, { delivery: true, priceMinor: 90_000, label: 'Ship' });
  const { seller, buyer, orderId } = o;
  const tracking = `TH${randomBytes(5).toString('hex').toUpperCase()}`;

  const sellerSide = await newSession(browser);
  const sp = sellerSide.page;
  await signIn(sp, seller, `/market/orders/${orderId}`);
  await sp.getByRole('button', { name: 'Start processing' }).click();
  await expect(sp.getByRole('button', { name: 'Mark as shipped' })).toBeVisible();
  await sp.getByRole('button', { name: 'Mark as shipped' }).click();
  const dialog = sp.getByRole('dialog', { name: 'Mark as shipped' });
  await dialog.getByLabel('Carrier or how it is sent').fill('Kerry Express');
  await dialog.getByLabel('Tracking number (optional)').fill(tracking);
  await dialog.getByLabel('Expected days — from (optional)').fill('1');
  await dialog.getByLabel('Expected days — to').fill('3');
  await dialog.getByRole('button', { name: 'Mark as shipped' }).click();
  await expect(sp.getByRole('heading', { name: 'Tracking — In transit' })).toBeVisible();

  const shippedOrder = await db()
    .collection('orders')
    .findOne({ _id: oid(orderId) });
  expect(shippedOrder!.status).toBe('SHIPPED');
  const ship1 = await db()
    .collection('shipments')
    .findOne({ orderId: oid(orderId) });
  expect(ship1).toMatchObject({
    status: 'in_transit',
    carrier: 'Kerry Express',
    trackingNumber: tracking,
  });
  expect(ship1!.expectedDays).toMatchObject({ min: 1, max: 3 });

  // --- buyer sees tracking and confirms receipt -------------------------------------------------------------------
  const buyerSide = await newSession(browser);
  const bp = buyerSide.page;
  await signIn(bp, buyer, `/market/orders/${orderId}`);
  await expect(bp.getByRole('heading', { name: 'Tracking — In transit' })).toBeVisible();
  await expect(bp.getByText(`Kerry Express · ${tracking}`)).toBeVisible();
  const apiOrder = await o.orderOf();
  expect(apiOrder.status).toBe('SHIPPED');
  expect(apiOrder.shipments.at(-1)).toMatchObject({
    carrier: 'Kerry Express',
    trackingNumber: tracking,
  });
  await bp.getByRole('button', { name: 'I received the order' }).click();
  await expect(bp.getByRole('heading', { name: 'Tracking — Delivered' })).toBeVisible();

  // --- API + DB ----------------------------------------------------------------------------------------------------
  await expect.poll(async () => (await o.orderOf()).status, { timeout: 15_000 }).toBe('DELIVERED');
  const order = await db()
    .collection('orders')
    .findOne({ _id: oid(orderId) });
  expect(order!.status).toBe('DELIVERED');
  const shipments = await db()
    .collection('shipments')
    .find({ orderId: oid(orderId) })
    .toArray();
  expect(shipments).toHaveLength(1);
  expect(shipments[0]!.status).toBe('delivered');
  expect(shipments[0]!.deliveredAt).toBeTruthy();
  expect(shipments[0]!.events.map((e: { status: string }) => e.status)).toEqual([
    'in_transit',
    'delivered',
  ]);
  // the seller's earnings moved from pending to available
  const sellerWallet = await db()
    .collection('wallets')
    .findOne({ ownerId: oid(seller.id) });
  const w = await walletMatchesLedger(sellerWallet!._id);
  expect(w.pendingMinor).toBe(0);
  // Documented split (docs/architecture/finance.md): seller gets items − fee; the shipping charge is held in the
  // `shipping` system account (carrier settlement is out of scope), so it is NOT part of the seller's earnings.
  expect(order!.shippingMinor).toBe(10_000);
  expect(order!.sellerPayoutMinor + order!.platformFeeMinor + order!.shippingMinor).toBe(o.total);
  expect(w.availableMinor).toBe(order!.sellerPayoutMinor);
  const capture = await db()
    .collection('wallet_transactions')
    .find({ orderId: oid(orderId), type: 'capture' })
    .toArray();
  expect(capture.find((l) => l.walletKind === 'shipping')?.amountMinor).toBe(10_000);
  await journalsBalance({ orderId: oid(orderId) });
  await Promise.all([sellerSide.context.close(), buyerSide.context.close()]);
});

// =================================================================================================================
test('UI-C07 moderation: a member reports a post in the UI; a moderator (MFA) hides it in the admin UI; it leaves the feed for others; DB status and audit row', async ({
  browser,
  request,
}) => {
  const author = await register(request, 'Spam Author');
  await connectDb(author);
  const text = `Buy cheap miracle feed now ${randomBytes(3).toString('hex')}`;
  const created = await request.post(`${api()}/api/v1/posts`, {
    ...authed(author),
    data: { body: text, visibility: 'public' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const postId = (await created.json()).post.id as string;
  // A control post by someone else, which must stay visible in the feed.
  const neighbour = await register(request, 'Good Neighbour');
  const controlText = `Healthy calves this week ${randomBytes(3).toString('hex')}`;
  const control = await request.post(`${api()}/api/v1/posts`, {
    ...authed(neighbour),
    data: { body: controlText, visibility: 'public' },
  });
  expect(control.status(), await control.text()).toBe(201);

  // --- a member reports it in the UI -------------------------------------------------------------------------------
  const reporter = await register(request, 'Careful Reporter');
  const r = await newSession(browser);
  await signIn(r.page, reporter, `/community/posts/${postId}`);
  const article = r.page.getByRole('article', { name: 'Post by Spam Author' });
  await expect(article.getByText(text)).toBeVisible();
  await article.getByRole('button', { name: 'Post actions' }).click();
  await r.page.getByRole('menuitem', { name: 'Report' }).click();
  const dlg = r.page.getByRole('dialog', { name: 'Report this post' });
  await dlg.getByLabel('Reason').selectOption('spam');
  await dlg.getByLabel('Details (optional)').fill('Advertising a fake product');
  await dlg.getByRole('button', { name: 'Send report' }).click();
  await expect(r.page.getByText('Thanks — the moderators will take a look.')).toBeVisible();
  const report = await db()
    .collection('content_reports')
    .findOne({ targetId: oid(postId) });
  expect(report).toMatchObject({ status: 'open', reason: 'spam', targetType: 'post' });
  expect(String(report!.reporterId)).toBe(reporter.id);

  // --- moderator hides it ------------------------------------------------------------------------------------------
  const moderator = await staffWithMfa(request, ['moderator'], 'Mod Erator');
  const m = await newSession(browser);
  await adminSignIn(m.page, moderator, '/admin/moderation');
  await expect(m.page.getByRole('heading', { name: 'Content moderation' })).toBeVisible();
  const card = m.page.getByRole('region', { name: 'Report on post' }).filter({ hasText: text });
  await expect(card).toContainText('Careful Reporter');
  await expect(card).toContainText('Advertising a fake product');
  await card.getByRole('button', { name: 'Hide' }).click();
  const confirm = m.page.getByRole('dialog', { name: 'Hide content' });
  await confirm.getByLabel('Reason (recorded in the audit log)').fill('Commercial spam');
  await confirm.getByRole('button', { name: 'Hide' }).click();
  await expect(confirm).toBeHidden();
  await expect(card).toHaveCount(0);

  // --- DB ----------------------------------------------------------------------------------------------------------
  const post = await db()
    .collection('posts')
    .findOne({ _id: oid(postId) });
  expect(post!.status).toBe('hidden');
  const settled = await db().collection('content_reports').findOne({ _id: report!._id });
  expect(settled!.status).toBe('actioned');
  expect(String(settled!.resolvedBy)).toBe(moderator.id);
  expect(settled!.resolution).toMatchObject({ action: 'hide', note: 'Commercial spam' });
  const audit = await db()
    .collection('audit_logs')
    .findOne({ action: 'report.resolved', targetId: postId, actorId: oid(moderator.id) });
  expect(audit).toBeTruthy();
  expect(audit!.metadata).toMatchObject({ reportId: String(report!._id), action: 'hide' });

  // --- the post is gone for other users (API + feed UI); the author still sees it with a notice -------------------
  const other = await register(request, 'Another Member');
  const feed = await (await request.get(`${api()}/api/v1/posts?limit=50`, authed(other))).json();
  expect(feed.items.some((p: { id: string }) => p.id === postId)).toBe(false);
  expect((await request.get(`${api()}/api/v1/posts/${postId}`, authed(other))).status()).toBe(404);
  const oth = await newSession(browser);
  await signIn(oth.page, other, '/community');
  await expect(oth.page.getByText(controlText)).toBeVisible();
  await expect(oth.page.getByText(text)).toHaveCount(0);
  await r.page.goto('/community');
  await expect(r.page.getByText(controlText)).toBeVisible();
  await expect(r.page.getByText(text)).toHaveCount(0);
  await Promise.all([r.context.close(), m.context.close(), oth.context.close()]);
});
