/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AuditLog,
  CommissionRule,
  FinancialAuditLog,
  InventoryMovement,
  Order,
  Payment,
  Product,
  Refund,
  Setting,
  Wallet,
  WalletTransaction,
  Withdrawal,
} from '../../src/models';
import { verifyAuditChain } from '../../src/modules/finance/audit';
import { signWebhook } from '../../src/modules/media/provider';
import { createWorld, type World } from '../commerce-fixtures';
import { key, payOrder, providerEvent, send, startPayment } from '../finance-helpers';
import {
  PAYMENT_SECRET,
  createStaff,
  makeFarm,
  startHarness,
  type Session,
  type Staff,
  type TestHarness,
} from '../helpers';
import { shipWebhook } from '../orders-helpers';
import { collectRoutes, installRouteRecorder } from '../qa/route-inventory';
import { createShopWorld, type ShopWorld } from '../shop-fixtures';

/**
 * Business-workflow audit, scenario groups F (payments, wallet, commission) and H (products & inventory).
 * Real API (supertest) + signed provider callbacks + database assertions, mock payment provider only.
 */
let h: TestHarness;
let w: World;
let shop: ShopWorld;
let fin: Staff;

beforeAll(async () => {
  installRouteRecorder();
  h = await startHarness();
  w = await createWorld(h);
  shop = await createShopWorld(h);
  fin = await createStaff(h.app, ['finance_admin']);
});
afterAll(() => h.stop());
afterEach(async () => {
  await CommissionRule.updateMany({}, { $set: { active: false } });
  await Setting.deleteMany({ key: { $regex: '^finance\\.|orders\\.platformFeeBps' } });
  h.payments!.failNext = null;
});

const API = '/api/v1';
const admin = (m: 'get' | 'post' | 'patch' | 'put', s: Session, path: string, body?: object) =>
  request(h.app)[m](`${API}/admin/finance${path}`).set(s.auth).send(body);

// ---------------------------------------------------------------------------
// Shared invariants
// ---------------------------------------------------------------------------
const ledgerTotal = async () =>
  ((await WalletTransaction.aggregate([{ $group: { _id: null, s: { $sum: '$amountMinor' } } }]))[0]
    ?.s as number | undefined) ?? 0;

/** Sum of all ledger lines = 0 and every wallet's projected balances equal its own ledger sums. */
async function assertLedgerInvariants() {
  expect(await ledgerTotal(), 'sum of all WalletTransaction amounts').toBe(0);
  const sums = await WalletTransaction.aggregate<{
    _id: { w: Types.ObjectId; b: string };
    s: number;
  }>([{ $group: { _id: { w: '$walletId', b: '$bucket' }, s: { $sum: '$amountMinor' } } }]);
  const by = new Map(sums.map((x) => [`${x._id.w}:${x._id.b}`, x.s]));
  for (const wal of await Wallet.find()) {
    expect(wal.pendingMinor, `${wal.kind} ${wal._id} pending`).toBe(
      by.get(`${wal._id}:pending`) ?? 0,
    );
    expect(wal.availableMinor, `${wal.kind} ${wal._id} available`).toBe(
      by.get(`${wal._id}:available`) ?? 0,
    );
  }
}

const STRUCTURAL = [
  'wallet_drift',
  'ledger_unbalanced',
  'negative_balance',
  'missing_journal',
  'audit_chain_broken',
];
/** Dry-run reconciliation: no structural problem anywhere, and nothing at all about this scenario's objects. */
async function assertReconcileClean(refs: string[]) {
  const res = await admin('post', fin, '/reconcile', {});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const issues = res.body.report.issues as { kind: string; ref: string; detail: string }[];
  expect(
    issues.filter((i) => STRUCTURAL.includes(i.kind)),
    'structural reconcile issues',
  ).toEqual([]);
  expect(
    issues.filter((i) => refs.some((r) => i.ref.includes(r))),
    'reconcile issues for this scenario',
  ).toEqual([]);
}

const RULE = {
  name: 'Audit rule',
  feeBps: 1000,
  categories: [] as string[],
  startsAt: '2020-01-01T00:00:00.000Z',
  priority: 10,
  reason: 'Audit test pricing',
};
async function makeRule(over: Record<string, unknown> = {}) {
  const res = await admin('post', fin, '/commission-rules', { ...RULE, ...over });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.rule as any;
}

const ACCOUNT = { bankCode: 'KBANK', accountNumber: '1234567890', accountName: 'Somchai Jaidee' };
const enablePayouts = (min = 10_000) =>
  Promise.all([
    Setting.updateOne(
      { key: 'finance.payoutsEnabled' },
      { $set: { value: true } },
      { upsert: true },
    ),
    Setting.updateOne(
      { key: 'finance.minWithdrawalMinor' },
      { $set: { value: min } },
      { upsert: true },
    ),
  ]);
const wd = (s: Session, amountMinor: number, k: string = key('wd')) =>
  request(h.app)
    .post(`${API}/wallet/withdrawals`)
    .set(s.auth)
    .set('idempotency-key', k)
    .send({ amountMinor });
const sellerWalletOf = async (s: Session) =>
  (await Wallet.findOne({ kind: 'seller', ownerId: s.id }))!;

/** A completed ฿40,000 pickup sale with no fee: ฿40,000 available to the seller, payout account set. */
async function fundedSeller(seller?: Session) {
  const d = await w.deal({ delivery: false, ...(seller ? { seller } : {}) });
  const o = await w.pickup(d);
  expect((await payOrder(h, d.buyer, o)).result).toBe('succeeded');
  await w.complete(d, o);
  expect((await sellerWalletOf(d.seller)).availableMinor).toBe(4_000_000);
  expect((await w.call('put', d.seller, '/wallet/payout-account', ACCOUNT)).status).toBe(200);
  return d;
}

const stockOf = async (id: string) => {
  const p = (await Product.findById(id))!;
  return { stock: p.stock, reserved: p.reserved };
};
const movementSums = async (id: string) => {
  const rows = await InventoryMovement.aggregate([
    { $match: { productId: new Types.ObjectId(id) } },
    { $group: { _id: null, s: { $sum: '$deltaStock' }, r: { $sum: '$deltaReserved' } } },
  ]);
  return { stock: rows[0]?.s ?? 0, reserved: rows[0]?.r ?? 0 };
};
const movesOf = async (id: string) =>
  (await InventoryMovement.find({ productId: id }).sort({ createdAt: 1, _id: 1 })).map(
    (m) => `${m.type}:${m.deltaStock}/${m.deltaReserved}`,
  );

// ===========================================================================
// F. Payments, wallet, commission
// ===========================================================================
describe('F1 successful and failed payment', () => {
  it('F1a a captured payment pays the order once and books one balanced capture journal (fee + shipping split)', async () => {
    await makeRule({ name: 'F1 10%', priority: 101 });
    const d = await w.deal();
    const o = await w.checkout(d);
    expect(o.totals.grandTotalMinor).toBe(4_250_000);
    const p = await payOrder(h, d.buyer, o);
    expect(p.result).toBe('succeeded');
    const order = (await Order.findById(o.id))!;
    expect(order).toMatchObject({
      status: 'PAID',
      paymentRef: p.payment.providerRef,
      platformFeeMinor: 400_000,
      sellerPayoutMinor: 3_600_000,
    });
    expect(await Payment.findById(p.payment.id)).toMatchObject({
      status: 'succeeded',
      disposition: 'applied',
      receivedMinor: 4_250_000,
    });
    const lines = await WalletTransaction.find({ journalKey: `capture:${p.payment.id}` }).sort({
      lineNo: 1,
    });
    expect(lines.map((l) => [l.walletKind, l.bucket, l.amountMinor])).toEqual([
      ['provider', 'available', -4_250_000],
      ['seller', 'pending', 3_600_000],
      ['platform', 'available', 400_000],
      ['shipping', 'available', 250_000],
    ]);
    for (const act of ['payment.created', 'payment.succeeded', 'payment.applied'])
      expect(
        await FinancialAuditLog.countDocuments({ action: act, targetId: p.payment.id }),
        act,
      ).toBe(1);
    await assertLedgerInvariants();
    await assertReconcileClean([p.payment.id, o.id]);
  });

  it('F1b a failed payment books nothing; the order stays payable and a new attempt pays it', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    const p1 = (await startPayment(h.app, d.buyer, o.id)).body.payment;
    const c1 = h.payments!.settleCharge(p1.providerRef, 'failed', 'card_declined');
    const r = await send(
      h.app,
      providerEvent('charge.failed', c1.ref, c1.amountMinor, { failureCode: 'card_declined' }),
    );
    expect(r.body.result).toBe('failed');
    expect(await Payment.findById(p1.id)).toMatchObject({
      status: 'failed',
      failureCode: 'card_declined',
      disposition: null,
    });
    expect((await Order.findById(o.id))?.status).toBe('PENDING_PAYMENT');
    expect(await WalletTransaction.countDocuments({ refId: p1.id })).toBe(0);
    expect(await Refund.countDocuments({ paymentId: p1.id })).toBe(0);
    // a new attempt (new key) is accepted and pays the order
    const p2 = await payOrder(h, d.buyer, o);
    expect(p2.result).toBe('succeeded');
    expect(p2.payment.id).not.toBe(p1.id);
    expect((await Order.findById(o.id))?.paymentRef).toBe(p2.payment.providerRef);
    expect(await Payment.countDocuments({ orderId: o.id, disposition: 'applied' })).toBe(1);
    expect(await WalletTransaction.countDocuments({ journalKey: `capture:${p2.payment.id}` })).toBe(
      2,
    ); // provider + seller (no fee, pickup)
    await assertLedgerInvariants();
    await assertReconcileClean([p1.id, p2.payment.id]);
  });
});

describe('F2 duplicate provider webhooks', () => {
  it('F2a the same event id delivered 8 times (parallel + sequential) is booked once; the shop sale is deducted once', async () => {
    const s = await shop.seller('F2 Farm');
    const prod = await shop.live(s, { stock: 10, priceMinor: 50_000 });
    const buyer = await shop.buyer();
    await shop.put(buyer, prod.id, 2);
    const o = (await shop.checkout(buyer)).body.orders[0];
    const p = (await startPayment(h.app, buyer, o.id)).body.payment;
    const c = h.payments!.settleCharge(p.providerRef, 'succeeded');
    const ev = providerEvent('charge.succeeded', c.ref, c.amountMinor, { id: `evt_f2a_${p.id}` });
    const rs = await Promise.all(Array.from({ length: 5 }, () => send(h.app, ev)));
    for (let i = 0; i < 3; i++) rs.push(await send(h.app, ev));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(rs.filter((r) => r.body.result === 'succeeded')).toHaveLength(1);
    expect(rs.filter((r) => r.body.result === 'duplicate')).toHaveLength(7);
    expect(await WalletTransaction.countDocuments({ journalKey: `capture:${p.id}` })).toBe(2);
    expect(
      await FinancialAuditLog.countDocuments({ action: 'payment.succeeded', targetId: p.id }),
    ).toBe(1);
    expect(await stockOf(prod.id)).toEqual({ stock: 8, reserved: 0 });
    expect(await InventoryMovement.countDocuments({ productId: prod.id, type: 'sale' })).toBe(1);
    await assertLedgerInvariants();
  });

  it('F2b the same payload with a NEW event id is recognised as a duplicate (state-based, not id-based)', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    const p = (await startPayment(h.app, d.buyer, o.id)).body.payment;
    const c = h.payments!.settleCharge(p.providerRef, 'succeeded');
    expect(
      (await send(h.app, providerEvent('charge.succeeded', c.ref, c.amountMinor))).body.result,
    ).toBe('succeeded');
    const seller = await sellerWalletOf(d.seller);
    const again = await Promise.all(
      Array.from({ length: 4 }, () =>
        send(h.app, providerEvent('charge.succeeded', c.ref, c.amountMinor)),
      ),
    );
    expect(again.map((r) => r.body.result)).toEqual(Array(4).fill('duplicate'));
    expect((await sellerWalletOf(d.seller)).pendingMinor).toBe(seller.pendingMinor);
    expect(await WalletTransaction.countDocuments({ journalKey: `capture:${p.id}` })).toBe(2);
    // and an out-of-order "failed" for the captured charge cannot undo it
    expect(
      (await send(h.app, providerEvent('charge.failed', c.ref, c.amountMinor))).body.result,
    ).toBe('stale');
    expect((await Payment.findById(p.id))?.status).toBe('succeeded');
    expect((await Order.findById(o.id))?.status).toBe('PAID');
    await assertLedgerInvariants();
  });
});

describe('F3 webhook authentication', () => {
  it('F3a wrong secret, stale / future timestamp, tampered body, no header → 401; malformed JSON → 400; nothing changes', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    const p = (await startPayment(h.app, d.buyer, o.id)).body.payment;
    const c = h.payments!.settleCharge(p.providerRef, 'succeeded');
    const ev = providerEvent('charge.succeeded', c.ref, c.amountMinor);
    const rejected0 = await AuditLog.countDocuments({ action: 'webhook.rejected' });
    const now = Math.floor(Date.now() / 1000);
    const wrongSecret = await request(h.app)
      .post(`${API}/webhooks/payments`)
      .set('content-type', 'application/json')
      .set(
        'webhook-signature',
        `time=${now},sig1=${signWebhook('not-the-secret-0000000000', now, JSON.stringify(ev))}`,
      )
      .send(JSON.stringify(ev));
    const stale = await send(h.app, ev, { time: now - 301 });
    const future = await send(h.app, ev, { time: now + 301 });
    const tampered = await send(h.app, ev, { tamper: true });
    const missing = await send(h.app, ev, { header: null });
    const garbage = await send(h.app, ev, { header: 'time=abc,sig1=' });
    for (const [name, r] of Object.entries({
      wrongSecret,
      stale,
      future,
      tampered,
      missing,
      garbage,
    })) {
      expect(r.status, name).toBe(401);
      expect(r.body.error.code, name).toBe('INVALID_SIGNATURE');
    }
    const raw = '{"id":"evt_broken","type":"charge.succeeded",';
    const bad = await request(h.app)
      .post(`${API}/webhooks/payments`)
      .set('content-type', 'application/json')
      .set('webhook-signature', `time=${now},sig1=${signWebhook(PAYMENT_SECRET, now, raw)}`)
      .send(raw);
    expect(bad.status).toBe(400);
    expect(await AuditLog.countDocuments({ action: 'webhook.rejected' })).toBeGreaterThanOrEqual(
      rejected0 + 6,
    );
    expect((await Payment.findById(p.id))?.status).toBe('pending');
    expect((await Order.findById(o.id))?.status).toBe('PENDING_PAYMENT');
    expect(await WalletTransaction.countDocuments({ refId: p.id })).toBe(0);
    // the genuine, correctly signed callback still works afterwards
    expect((await send(h.app, ev)).body.result).toBe('succeeded');
    await assertLedgerInvariants();
  });
});

describe('F4 amount and currency mismatch', () => {
  it('F4a an under-payment is parked in suspense, refunded for what was received; the order stays payable and a correct payment then applies', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    const suspense0 = (await Wallet.findOne({ kind: 'suspense' }))?.availableMinor ?? 0;
    const p = (await startPayment(h.app, d.buyer, o.id)).body.payment;
    const c = h.payments!.settleCharge(p.providerRef, 'succeeded');
    expect(
      (await send(h.app, providerEvent('charge.succeeded', c.ref, 3_999_999))).body.result,
    ).toBe('unapplied');
    expect(await Payment.findById(p.id)).toMatchObject({
      disposition: 'unapplied',
      unappliedReason: 'amount_mismatch',
      receivedMinor: 3_999_999,
    });
    expect((await Order.findById(o.id))?.status).toBe('PENDING_PAYMENT');
    expect((await Wallet.findOne({ kind: 'suspense' }))!.availableMinor).toBe(
      suspense0 + 3_999_999,
    );
    const refund = (await Refund.findOne({ paymentId: p.id }))!;
    expect(refund).toMatchObject({ status: 'requested', amountMinor: 3_999_999 });
    // the buyer pays again correctly
    const p2 = await payOrder(h, d.buyer, o);
    expect(p2.result).toBe('succeeded');
    expect((await Order.findById(o.id))?.status).toBe('PAID');
    // finance returns the parked money
    expect(
      (
        await admin('post', fin, `/refunds/${refund._id}/approve`, {
          confirmation: refund.refundNo,
        })
      ).status,
    ).toBe(200);
    const ref = (await Refund.findById(refund._id))!.providerRef!;
    h.payments!.settleRefund(ref, 'succeeded');
    expect((await send(h.app, providerEvent('refund.succeeded', ref, 3_999_999))).body.result).toBe(
      'succeeded',
    );
    expect((await Wallet.findOne({ kind: 'suspense' }))!.availableMinor).toBe(suspense0);
    expect((await Order.findById(o.id))?.status).toBe('PAID'); // the good payment is untouched
    expect((await Payment.findById(p2.payment.id))?.status).toBe('succeeded');
    await assertLedgerInvariants();
    await assertReconcileClean([p.id, p2.payment.id, String(refund._id)]);
  });

  it('F4b an over-payment is not applied either; the whole amount received is queued for refund', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    const p = (await startPayment(h.app, d.buyer, o.id)).body.payment;
    h.payments!.settleCharge(p.providerRef, 'succeeded');
    expect(
      (await send(h.app, providerEvent('charge.succeeded', p.providerRef, 4_000_001))).body.result,
    ).toBe('unapplied');
    expect((await Order.findById(o.id))?.status).toBe('PENDING_PAYMENT');
    expect(await Refund.findOne({ paymentId: p.id })).toMatchObject({ amountMinor: 4_000_001 });
    expect(
      (await WalletTransaction.find({ journalKey: `capture_unapplied:${p.id}` }))
        .map((l) => l.amountMinor)
        .sort((a, b) => a - b),
    ).toEqual([-4_000_001, 4_000_001]);
    await assertLedgerInvariants();
  });

  it('F4c a foreign-currency capture books nothing and is audited; the genuine THB callback then applies', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    const p = (await startPayment(h.app, d.buyer, o.id)).body.payment;
    const c = h.payments!.settleCharge(p.providerRef, 'succeeded');
    expect(
      (
        await send(
          h.app,
          providerEvent('charge.succeeded', c.ref, c.amountMinor, { currency: 'USD' }),
        )
      ).body.result,
    ).toBe('currency_mismatch');
    expect((await Payment.findById(p.id))?.status).toBe('pending');
    expect(await WalletTransaction.countDocuments({ refId: p.id })).toBe(0);
    expect(
      await FinancialAuditLog.countDocuments({
        action: 'payment.currency_mismatch',
        targetId: p.id,
      }),
    ).toBe(1);
    expect(
      (await send(h.app, providerEvent('charge.succeeded', c.ref, c.amountMinor))).body.result,
    ).toBe('succeeded');
    expect((await Order.findById(o.id))?.status).toBe('PAID');
    await assertLedgerInvariants();
  });
});

describe('F5 commission boundaries', () => {
  const preview = async (priceMinor: number, at?: string, categoryKey = 'feed') => {
    const r = await admin('post', fin, '/commission-rules/preview', {
      priceMinor,
      categoryKey,
      ...(at ? { at } : {}),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.fee as any;
  };

  it('F5a min / max / percentage / floor / base clamp / very large amounts match hand-computed values', async () => {
    const a = await makeRule({
      name: 'F5 feed 10% (5,000–100,000)',
      feeBps: 1000,
      minFeeMinor: 5_000,
      maxFeeMinor: 100_000,
      categories: ['feed'],
      priority: 300,
    });
    const cases: [number, number, string | null][] = [
      [1, 1, 'base'], // raw 0 → min 5,000 → never above the price: 1
      [4_999, 4_999, 'base'],
      [10_000, 5_000, 'min'], // raw 1,000
      [50_000, 5_000, null], // raw exactly the minimum
      [50_009, 5_000, null], // 5,000.9 floors
      [50_010, 5_001, null],
      [1_000_000, 100_000, null], // raw exactly the maximum
      [1_000_010, 100_000, 'max'], // raw 100,001
      [1_000_000_000_000, 100_000, 'max'], // the largest amount the API accepts
    ];
    for (const [price, fee, clamp] of cases) {
      const f = await preview(price);
      expect([price, f.feeMinor, f.clamp, f.ruleId], `price ${price}`).toEqual([
        price,
        fee,
        clamp,
        a.id,
      ]);
    }
    // no max: exact integer maths on a 12-digit amount (999,999,999,999 × 33.33% = 333,299,999,999.67 → floor)
    await makeRule({
      name: 'F5 tools 33.33%',
      feeBps: 3333,
      categories: ['tools_f5'],
      priority: 300,
    });
    const big = await preview(999_999_999_999, undefined, 'tools_f5');
    expect(big).toMatchObject({ rawFeeMinor: 333_299_999_999, feeMinor: 333_299_999_999 });
    // a category with no rule falls back to the platform default (0 unless configured)
    expect(await preview(1_000_000, undefined, 'no_rule_cat')).toMatchObject({
      source: 'default_setting',
      feeMinor: 0,
    });
  });

  it('F5b rule date windows: start is inclusive, end is exclusive; outside the window the lower-priority rule applies', async () => {
    const base = await makeRule({
      name: 'F5 base 10%',
      feeBps: 1000,
      categories: ['feed'],
      priority: 310,
    });
    const t1 = new Date(Date.now() + 86_400_000);
    const t2 = new Date(t1.getTime() + 86_400_000);
    const promo = await makeRule({
      name: 'F5 promo 2%',
      feeBps: 200,
      categories: ['feed'],
      priority: 320,
      startsAt: t1.toISOString(),
      endsAt: t2.toISOString(),
    });
    const at = (d: Date, ms = 0) => new Date(d.getTime() + ms).toISOString();
    expect((await preview(100_000, at(t1, -1))).ruleId).toBe(base.id);
    expect(await preview(100_000, at(t1))).toMatchObject({ ruleId: promo.id, feeMinor: 2_000 });
    expect(await preview(100_000, at(t2, -1))).toMatchObject({
      ruleId: promo.id,
      feeMinor: 2_000,
    });
    expect(await preview(100_000, at(t2))).toMatchObject({ ruleId: base.id, feeMinor: 10_000 });
  });

  it('F5c a real shop checkout applies the rule per line (1 satang line, ordinary line, ฿100M line) and the ledger splits exactly', async () => {
    await makeRule({
      name: 'F5c feed 10% (5,000–100,000)',
      feeBps: 1000,
      minFeeMinor: 5_000,
      maxFeeMinor: 100_000,
      categories: ['feed'],
      priority: 330,
    });
    const s = await shop.seller('F5 Farm');
    const x = await shop.live(s, { priceMinor: 1, stock: 5 });
    const y = await shop.live(s, { priceMinor: 30_000, stock: 5 });
    const z = await shop.live(s, { priceMinor: 10_000_000_000, stock: 1 });
    const buyer = await shop.buyer();
    await shop.put(buyer, x.id, 1);
    await shop.put(buyer, y.id, 2);
    await shop.put(buyer, z.id, 1);
    const o = (await shop.checkout(buyer)).body.orders[0];
    const order = (await Order.findById(o.id))!;
    // hand-computed: line fees 1 (base clamp) + 6,000 + 100,000 (max clamp)
    expect({
      items: order.itemsMinor,
      fee: order.platformFeeMinor,
      payout: order.sellerPayoutMinor,
      total: order.grandTotalMinor,
    }).toEqual({
      items: 10_000_060_001,
      fee: 106_001,
      payout: 9_999_954_000,
      total: 10_000_060_001,
    });
    const lineFees = (order.feeSnapshot as any).lines.map((l: any) => [
      l.baseMinor,
      l.feeMinor,
      l.clamp,
    ]);
    expect(lineFees).toEqual(
      expect.arrayContaining([
        [1, 1, 'base'],
        [60_000, 6_000, null],
        [10_000_000_000, 100_000, 'max'],
      ]),
    );
    const p = await shop.pay(buyer, o);
    expect(p.result).toBe('succeeded');
    const lines = await WalletTransaction.find({ journalKey: `capture:${p.payment.id}` }).sort({
      lineNo: 1,
    });
    expect(lines.map((l) => [l.walletKind, l.bucket, l.amountMinor])).toEqual([
      ['provider', 'available', -10_000_060_001],
      ['seller', 'pending', 9_999_954_000],
      ['platform', 'available', 106_001],
    ]);
    await assertLedgerInvariants();
  });
});

describe('F6 refunds', () => {
  async function paidThenCancelled() {
    await makeRule({ name: 'F6 5%', feeBps: 500, priority: 600 });
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    const p = await payOrder(h, d.buyer, o);
    expect(p.result).toBe('succeeded');
    expect(
      (await w.call('post', d.buyer, `/orders/${o.id}/cancel`, { reason: 'Changed my mind' }))
        .status,
    ).toBe(200);
    const refund = (await Refund.findOne({ orderId: o.id }))!;
    return { d, o, p, refund };
  }

  it('F6a full refund: approve → provider callback → order REFUNDED, payment refunded, capture reversed exactly', async () => {
    const { d, o, p, refund } = await paidThenCancelled();
    expect(refund).toMatchObject({ status: 'requested', amountMinor: 4_000_000 });
    const seller0 = await sellerWalletOf(d.seller);
    const a = await admin('post', fin, `/refunds/${refund._id}/approve`, {
      confirmation: refund.refundNo,
    });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    const ref = (await Refund.findById(refund._id))!.providerRef!;
    h.payments!.settleRefund(ref, 'succeeded');
    expect((await send(h.app, providerEvent('refund.succeeded', ref, 4_000_000))).body.result).toBe(
      'succeeded',
    );
    expect((await Order.findById(o.id))?.status).toBe('REFUNDED');
    expect((await Payment.findById(p.payment.id))?.status).toBe('refunded');
    const lines = await WalletTransaction.find({ journalKey: `refund:${refund._id}` }).sort({
      lineNo: 1,
    });
    expect(lines.map((l) => [l.walletKind, l.bucket, l.amountMinor])).toEqual([
      ['provider', 'available', 4_000_000],
      ['seller', 'pending', -3_800_000],
      ['platform', 'available', -200_000],
    ]);
    expect((await sellerWalletOf(d.seller)).pendingMinor).toBe(seller0.pendingMinor - 3_800_000);
    await assertLedgerInvariants();
    await assertReconcileClean([String(refund._id), p.payment.id]);
  });

  it('F6b partial refunds are not supported and are refused cleanly (no amount can be supplied anywhere)', async () => {
    const { refund } = await paidThenCancelled();
    const partial = await admin('post', fin, `/refunds/${refund._id}/approve`, {
      confirmation: refund.refundNo,
      amountMinor: 1_000_000,
    });
    expect(partial.status).toBe(400);
    expect(partial.body.error.code).toBe('VALIDATION_ERROR');
    const create = await admin('post', fin, '/refunds', {
      paymentId: String(refund.paymentId),
      amountMinor: 1_000,
    });
    expect([404, 405]).toContain(create.status);
    expect(await Refund.findById(refund._id)).toMatchObject({
      status: 'requested',
      amountMinor: 4_000_000,
    });
    expect(await Refund.countDocuments({ paymentId: refund.paymentId })).toBe(1);
  });

  it('F6c refund callback replay (parallel + sequential) completes once: one journal, one order transition, one audit entry', async () => {
    const { o, refund } = await paidThenCancelled();
    await admin('post', fin, `/refunds/${refund._id}/approve`, { confirmation: refund.refundNo });
    const ref = (await Refund.findById(refund._id))!.providerRef!;
    h.payments!.settleRefund(ref, 'succeeded');
    const ev = providerEvent('refund.succeeded', ref, 4_000_000, { id: `evt_f6c_${refund._id}` });
    const rs = await Promise.all(Array.from({ length: 6 }, () => send(h.app, ev)));
    rs.push(await send(h.app, ev));
    rs.push(await send(h.app, providerEvent('refund.succeeded', ref, 4_000_000))); // new event id, same payload
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(rs.filter((r) => r.body.result === 'succeeded').length).toBeGreaterThanOrEqual(1);
    expect(rs.slice(-2).map((r) => r.body.result)).toEqual(['duplicate', 'duplicate']);
    expect(await WalletTransaction.countDocuments({ journalKey: `refund:${refund._id}` })).toBe(3);
    const order = (await Order.findById(o.id))!;
    expect(order.status).toBe('REFUNDED');
    expect(order.history.filter((x: any) => x.to === 'REFUNDED')).toHaveLength(1);
    // an out-of-order failure after success changes nothing
    expect((await send(h.app, providerEvent('refund.failed', ref, 4_000_000))).body.result).toBe(
      'stale',
    );
    expect((await Refund.findById(refund._id))?.status).toBe('succeeded');
    await assertLedgerInvariants();
    expect(
      await FinancialAuditLog.countDocuments({
        action: 'refund.succeeded',
        targetId: String(refund._id),
      }),
      'refund.succeeded audit entries after 8 deliveries of the same confirmation',
    ).toBe(1);
  });
});

describe('F7 seller payouts and withdrawals', () => {
  it('F7a request → approve → paid: money held at request, settled on payout, never double-counted', async () => {
    await enablePayouts();
    const d = await fundedSeller();
    const c = (await wd(d.seller, 1_500_000)).body.withdrawal;
    expect((await sellerWalletOf(d.seller)).availableMinor).toBe(2_500_000);
    expect(
      (await admin('post', fin, `/withdrawals/${c.id}/approve`, { confirmation: c.withdrawalNo }))
        .status,
    ).toBe(200);
    const ref = (await Withdrawal.findById(c.id))!.providerRef!;
    h.payments!.settlePayout(ref, 'succeeded');
    expect((await send(h.app, providerEvent('payout.paid', ref, 1_500_000))).body.result).toBe(
      'paid',
    );
    expect((await Withdrawal.findById(c.id))?.status).toBe('paid');
    expect((await sellerWalletOf(d.seller)).availableMinor).toBe(2_500_000);
    // a late failure for a paid payout must not return the money
    expect((await send(h.app, providerEvent('payout.failed', ref, 1_500_000))).body.result).toBe(
      'stale',
    );
    expect((await sellerWalletOf(d.seller)).availableMinor).toBe(2_500_000);
    expect(await WalletTransaction.countDocuments({ journalKey: `wd_release:${c.id}` })).toBe(0);
    await assertLedgerInvariants();
    await assertReconcileClean([c.id]);
  });

  it('F7b payout failure returns the money once; a failed withdrawal cannot be "retried" — a new request is made and paid', async () => {
    await enablePayouts();
    const d = await fundedSeller();
    const c = (await wd(d.seller, 1_000_000)).body.withdrawal;
    await admin('post', fin, `/withdrawals/${c.id}/approve`, { confirmation: c.withdrawalNo });
    const ref = (await Withdrawal.findById(c.id))!.providerRef!;
    h.payments!.settlePayout(ref, 'failed', 'account_closed');
    expect(
      (
        await send(
          h.app,
          providerEvent('payout.failed', ref, 1_000_000, { failureCode: 'account_closed' }),
        )
      ).body.result,
    ).toBe('failed');
    expect((await sellerWalletOf(d.seller)).availableMinor).toBe(4_000_000);
    const retry = await admin('post', fin, `/withdrawals/${c.id}/retry`);
    expect(retry.status).toBe(409);
    expect((await sellerWalletOf(d.seller)).availableMinor).toBe(4_000_000);
    const c2 = (await wd(d.seller, 1_000_000)).body.withdrawal;
    await admin('post', fin, `/withdrawals/${c2.id}/approve`, { confirmation: c2.withdrawalNo });
    const ref2 = (await Withdrawal.findById(c2.id))!.providerRef!;
    expect(ref2).not.toBe(ref);
    h.payments!.settlePayout(ref2, 'succeeded');
    expect((await send(h.app, providerEvent('payout.paid', ref2, 1_000_000))).body.result).toBe(
      'paid',
    );
    expect((await sellerWalletOf(d.seller)).availableMinor).toBe(3_000_000);
    await assertLedgerInvariants();
    await assertReconcileClean([c.id, c2.id]);
  });

  it('F7c provider outage on approval → retry sends exactly one payout', async () => {
    await enablePayouts();
    const d = await fundedSeller();
    const c = (await wd(d.seller, 700_000)).body.withdrawal;
    h.payments!.failNext = 'payout';
    expect(
      (await admin('post', fin, `/withdrawals/${c.id}/approve`, { confirmation: c.withdrawalNo }))
        .status,
    ).toBe(502);
    expect(await Withdrawal.findById(c.id)).toMatchObject({
      status: 'processing',
      providerRef: null,
    });
    const before = h.payments!.payouts.size;
    expect((await admin('post', fin, `/withdrawals/${c.id}/retry`)).status).toBe(200);
    expect(h.payments!.payouts.size - before).toBe(1);
    expect((await sellerWalletOf(d.seller)).availableMinor).toBe(3_300_000);
    await assertLedgerInvariants();
  });

  it('F7d rejection returns the funds once; the seller (or a staff member who is the seller) cannot approve their own', async () => {
    await enablePayouts();
    const d = await fundedSeller();
    const c = (await wd(d.seller, 1_000_000)).body.withdrawal;
    const self = await admin('post', d.seller, `/withdrawals/${c.id}/approve`, {
      confirmation: c.withdrawalNo,
    });
    expect(self.status).toBe(403);
    const rej = await admin('post', fin, `/withdrawals/${c.id}/reject`, {
      reason: 'Name mismatch',
    });
    expect(rej.body.withdrawal.status).toBe('rejected');
    expect(
      (await admin('post', fin, `/withdrawals/${c.id}/reject`, { reason: 'Again again' })).status,
    ).toBe(409);
    expect(
      (await admin('post', fin, `/withdrawals/${c.id}/approve`, { confirmation: c.withdrawalNo }))
        .status,
    ).toBe(409);
    expect((await sellerWalletOf(d.seller)).availableMinor).toBe(4_000_000);
    expect(await WalletTransaction.countDocuments({ journalKey: `wd_release:${c.id}` })).toBe(2);

    const both = await createStaff(h.app, ['finance_admin', 'seller', 'farm_owner']);
    const mine = await fundedSeller(both);
    const own = (await wd(mine.seller, 1_000_000)).body.withdrawal;
    const r = await admin('post', both, `/withdrawals/${own.id}/approve`, {
      confirmation: own.withdrawalNo,
    });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('SELF_APPROVAL');
    expect((await Withdrawal.findById(own.id))?.status).toBe('requested');
    await assertLedgerInvariants();
  });

  it('F7e more than available is refused; 10 parallel requests cannot overdraw; balance never negative', async () => {
    await enablePayouts();
    const d = await fundedSeller();
    const over = await wd(d.seller, 4_000_001);
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('INSUFFICIENT_FUNDS');
    const rs = await Promise.all(Array.from({ length: 10 }, () => wd(d.seller, 1_000_000)));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(4);
    expect(
      rs.filter((r) => r.status !== 201).every((r) => r.body.error?.code === 'INSUFFICIENT_FUNDS'),
    ).toBe(true);
    const wal = await sellerWalletOf(d.seller);
    expect(wal.availableMinor).toBe(0);
    expect(
      await Withdrawal.countDocuments({
        sellerId: d.seller.id,
        status: 'requested',
      }),
    ).toBe(4);
    await assertLedgerInvariants();
  });

  it('F7f seller cancel racing finance approval: exactly one wins and the money is either paid out or returned, never both', async () => {
    await enablePayouts();
    const d = await fundedSeller();
    for (let i = 0; i < 3; i++) {
      const c = (await wd(d.seller, 500_000)).body.withdrawal;
      const before = h.payments!.calls.createPayout;
      const [a, b] = await Promise.all([
        admin('post', fin, `/withdrawals/${c.id}/approve`, { confirmation: c.withdrawalNo }),
        w.call('post', d.seller, `/wallet/withdrawals/${c.id}/cancel`),
      ]);
      expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
      const st = (await Withdrawal.findById(c.id))!;
      const released = await WalletTransaction.countDocuments({ journalKey: `wd_release:${c.id}` });
      if (st.status === 'cancelled') {
        expect(h.payments!.calls.createPayout - before).toBe(0);
        expect(released).toBe(2);
      } else {
        expect(st.status).toBe('processing');
        expect(h.payments!.calls.createPayout - before).toBe(1);
        expect(released).toBe(0);
      }
    }
    await assertLedgerInvariants();
  });
});

describe('F8 duplicate financial operation prevention', () => {
  it('F8a five parallel refund approvals → one provider refund, one journal after the callback', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    await payOrder(h, d.buyer, o);
    await w.call('post', d.buyer, `/orders/${o.id}/cancel`, { reason: 'Duplicate order' });
    const refund = (await Refund.findOne({ orderId: o.id }))!;
    const calls0 = h.payments!.calls.createRefund;
    const size0 = h.payments!.refunds.size;
    const rs = await Promise.all(
      Array.from({ length: 5 }, () =>
        admin('post', fin, `/refunds/${refund._id}/approve`, { confirmation: refund.refundNo }),
      ),
    );
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(4);
    expect(h.payments!.calls.createRefund - calls0).toBe(1);
    expect(h.payments!.refunds.size - size0).toBe(1);
    const ref = (await Refund.findById(refund._id))!.providerRef!;
    h.payments!.settleRefund(ref, 'succeeded');
    await send(h.app, providerEvent('refund.succeeded', ref, 4_000_000));
    expect(await WalletTransaction.countDocuments({ journalKey: `refund:${refund._id}` })).toBe(2);
    expect(
      await FinancialAuditLog.countDocuments({
        action: 'refund.approved',
        targetId: String(refund._id),
      }),
    ).toBe(1);
    await assertLedgerInvariants();
  });

  it('F8b five parallel withdrawal approvals → one payout; parallel paid callbacks → one settlement journal and one audit entry', async () => {
    await enablePayouts();
    const d = await fundedSeller();
    const c = (await wd(d.seller, 2_000_000)).body.withdrawal;
    const calls0 = h.payments!.calls.createPayout;
    const rs = await Promise.all(
      Array.from({ length: 5 }, () =>
        admin('post', fin, `/withdrawals/${c.id}/approve`, { confirmation: c.withdrawalNo }),
      ),
    );
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(h.payments!.calls.createPayout - calls0).toBe(1);
    const ref = (await Withdrawal.findById(c.id))!.providerRef!;
    h.payments!.settlePayout(ref, 'succeeded');
    const ev = providerEvent('payout.paid', ref, 2_000_000, { id: `evt_f8b_${c.id}` });
    const cbs = await Promise.all(Array.from({ length: 6 }, () => send(h.app, ev)));
    expect(cbs.every((r) => ['paid', 'duplicate'].includes(r.body.result))).toBe(true);
    expect(await WalletTransaction.countDocuments({ journalKey: `wd_paid:${c.id}` })).toBe(2);
    expect((await sellerWalletOf(d.seller)).availableMinor).toBe(2_000_000);
    await assertLedgerInvariants();
    expect(
      await FinancialAuditLog.countDocuments({ action: 'withdrawal.paid', targetId: c.id }),
      'withdrawal.paid audit entries after 6 parallel deliveries',
    ).toBe(1);
  });

  it('F8c parallel payout-failed callbacks return the money exactly once', async () => {
    await enablePayouts();
    const d = await fundedSeller();
    const c = (await wd(d.seller, 1_000_000)).body.withdrawal;
    await admin('post', fin, `/withdrawals/${c.id}/approve`, { confirmation: c.withdrawalNo });
    const ref = (await Withdrawal.findById(c.id))!.providerRef!;
    h.payments!.settlePayout(ref, 'failed', 'account_closed');
    const ev = providerEvent('payout.failed', ref, 1_000_000, {
      id: `evt_f8c_${c.id}`,
      failureCode: 'account_closed',
    });
    await Promise.all(Array.from({ length: 6 }, () => send(h.app, ev)));
    expect((await sellerWalletOf(d.seller)).availableMinor).toBe(4_000_000);
    expect(await WalletTransaction.countDocuments({ journalKey: `wd_release:${c.id}` })).toBe(2);
    await assertLedgerInvariants();
    expect(
      await FinancialAuditLog.countDocuments({ action: 'withdrawal.failed', targetId: c.id }),
      'withdrawal.failed audit entries after 6 parallel deliveries',
    ).toBe(1);
  });

  it('F8d parallel refund retries after a provider outage create one provider refund', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    await payOrder(h, d.buyer, o);
    await w.call('post', d.buyer, `/orders/${o.id}/cancel`, { reason: 'Outage test' });
    const refund = (await Refund.findOne({ orderId: o.id }))!;
    h.payments!.failNext = 'refund';
    expect(
      (
        await admin('post', fin, `/refunds/${refund._id}/approve`, {
          confirmation: refund.refundNo,
        })
      ).status,
    ).toBe(502);
    const size0 = h.payments!.refunds.size;
    const rs = await Promise.all(
      Array.from({ length: 4 }, () => admin('post', fin, `/refunds/${refund._id}/retry`)),
    );
    expect(rs.some((r) => r.status === 200)).toBe(true);
    expect(h.payments!.refunds.size - size0).toBe(1);
    const ref = (await Refund.findById(refund._id))!.providerRef!;
    h.payments!.settleRefund(ref, 'succeeded');
    await send(h.app, providerEvent('refund.succeeded', ref, 4_000_000));
    expect(await WalletTransaction.countDocuments({ journalKey: `refund:${refund._id}` })).toBe(2);
    await assertLedgerInvariants();
  });
});

describe('F9 ledger consistency and reconciliation after a mixed run', () => {
  it('F9a parallel mixed flows end with hand-computed balances, a zero-sum ledger, and a clean reconciliation', async () => {
    await enablePayouts();
    await makeRule({ name: 'F9 10%', feeBps: 1000, priority: 900 });
    const seller = await w.sellerUser();
    const farmId = await makeFarm(h.app, seller, 'Mixed Farm');
    const platform0 = (await Wallet.findOne({ kind: 'platform' }))?.availableMinor ?? 0;
    const deals = [];
    for (let i = 0; i < 5; i++) deals.push(await w.deal({ delivery: false, seller, farmId }));
    const orders = [];
    for (const d of deals) orders.push(await w.pickup(d));
    const refs: string[] = orders.map((o) => o.id);

    await Promise.all([
      // 0: paid with a storm of duplicate callbacks, then delivered
      (async () => {
        const p = (await startPayment(h.app, deals[0]!.buyer, orders[0].id)).body.payment;
        const c = h.payments!.settleCharge(p.providerRef, 'succeeded');
        const ev = providerEvent('charge.succeeded', c.ref, c.amountMinor);
        await Promise.all(Array.from({ length: 4 }, () => send(h.app, ev)));
        await send(h.app, providerEvent('charge.succeeded', c.ref, c.amountMinor));
        refs.push(p.id);
        await w.complete(deals[0]!, orders[0]);
      })(),
      // 1: first attempt fails, second pays, delivered
      (async () => {
        const p = (await startPayment(h.app, deals[1]!.buyer, orders[1].id)).body.payment;
        h.payments!.settleCharge(p.providerRef, 'failed');
        await send(h.app, providerEvent('charge.failed', p.providerRef, 4_000_000));
        const p2 = await payOrder(h, deals[1]!.buyer, orders[1]);
        refs.push(p.id, p2.payment.id);
        await w.complete(deals[1]!, orders[1]);
      })(),
      // 2: paid, cancelled, refunded (callback replayed)
      (async () => {
        const p = await payOrder(h, deals[2]!.buyer, orders[2]);
        await w.call('post', deals[2]!.buyer, `/orders/${orders[2].id}/cancel`, {
          reason: 'Changed my mind',
        });
        const r = (await Refund.findOne({ orderId: orders[2].id }))!;
        await admin('post', fin, `/refunds/${r._id}/approve`, { confirmation: r.refundNo });
        const ref = (await Refund.findById(r._id))!.providerRef!;
        h.payments!.settleRefund(ref, 'succeeded');
        await send(h.app, providerEvent('refund.succeeded', ref, 4_000_000));
        await send(h.app, providerEvent('refund.succeeded', ref, 4_000_000));
        refs.push(p.payment.id, String(r._id));
      })(),
      // 3: paid and delivered
      (async () => {
        const p = await payOrder(h, deals[3]!.buyer, orders[3]);
        refs.push(p.payment.id);
        await w.complete(deals[3]!, orders[3]);
      })(),
      // 4: never paid, cancelled
      w.call('post', deals[4]!.buyer, `/orders/${orders[4].id}/cancel`, { reason: 'Not needed' }),
    ]);
    expect(
      (await Order.find({ _id: { $in: orders.map((o) => o.id) } }).sort({ _id: 1 })).map(
        (o) => o.status,
      ),
    ).toEqual(['DELIVERED', 'DELIVERED', 'REFUNDED', 'DELIVERED', 'CANCELLED']);
    await w.call('put', seller, '/wallet/payout-account', ACCOUNT);
    expect((await sellerWalletOf(seller)).availableMinor).toBe(3 * 3_600_000);

    const paid = (await wd(seller, 2_000_000)).body.withdrawal;
    const failed = (await wd(seller, 1_000_000)).body.withdrawal;
    const rejected = (await wd(seller, 500_000)).body.withdrawal;
    await admin('post', fin, `/withdrawals/${paid.id}/approve`, {
      confirmation: paid.withdrawalNo,
    });
    await admin('post', fin, `/withdrawals/${failed.id}/approve`, {
      confirmation: failed.withdrawalNo,
    });
    await admin('post', fin, `/withdrawals/${rejected.id}/reject`, { reason: 'Check details' });
    const pref = (await Withdrawal.findById(paid.id))!.providerRef!;
    const fref = (await Withdrawal.findById(failed.id))!.providerRef!;
    h.payments!.settlePayout(pref, 'succeeded');
    h.payments!.settlePayout(fref, 'failed');
    await Promise.all([
      send(h.app, providerEvent('payout.paid', pref, 2_000_000)),
      send(h.app, providerEvent('payout.failed', fref, 1_000_000)),
      send(h.app, providerEvent('payout.failed', fref, 1_000_000)),
    ]);
    // 10,800,000 − 2,000,000 − 1,000,000 − 500,000 = 7,300,000 left: of 4 × 3,000,000 only 2 fit
    const race = await Promise.all(Array.from({ length: 4 }, () => wd(seller, 3_000_000)));
    expect(race.filter((r) => r.status === 201)).toHaveLength(2);
    refs.push(paid.id, failed.id, rejected.id);

    const wal = await sellerWalletOf(seller);
    expect({ pending: wal.pendingMinor, available: wal.availableMinor }).toEqual({
      pending: 0,
      available: 10_800_000 - 2_000_000 - 6_000_000,
    });
    expect((await Wallet.findOne({ kind: 'platform' }))!.availableMinor - platform0).toBe(
      3 * 400_000,
    );
    await assertLedgerInvariants();
    await assertReconcileClean(refs);
    expect((await verifyAuditChain()).ok).toBe(true);
  });
});

describe('F10 no client-side wallet mutation', () => {
  it('F10a the only non-GET wallet/finance routes are the documented ones; none accepts a balance', () => {
    const routes = collectRoutes(h.app).filter(
      (r) =>
        r.method !== 'get' &&
        (r.path.includes('/wallet') ||
          r.path.startsWith('/api/v1/admin/finance') ||
          r.path.startsWith('/api/v1/payments')),
    );
    expect(routes.map((r) => `${r.method.toUpperCase()} ${r.path}`).sort()).toEqual(
      [
        'PATCH /api/v1/admin/finance/commission-rules/:id',
        'POST /api/v1/admin/finance/commission-rules',
        'POST /api/v1/admin/finance/commission-rules/preview',
        'POST /api/v1/admin/finance/reconcile',
        'POST /api/v1/admin/finance/refunds/:id/approve',
        'POST /api/v1/admin/finance/refunds/:id/retry',
        'POST /api/v1/admin/finance/withdrawals/:id/approve',
        'POST /api/v1/admin/finance/withdrawals/:id/reject',
        'POST /api/v1/admin/finance/withdrawals/:id/retry',
        'POST /api/v1/payments',
        'POST /api/v1/payments/:id/mock-complete',
        'POST /api/v1/wallet/withdrawals',
        'POST /api/v1/wallet/withdrawals/:id/cancel',
        'PUT /api/v1/wallet/payout-account',
      ].sort(),
    );
  });

  it('F10b PATCH/PUT/POST/DELETE with balance fields on every wallet-shaped path is refused and changes nothing', async () => {
    await enablePayouts();
    const d = await fundedSeller();
    const root = await createStaff(h.app, ['super_admin']);
    const wal0 = await sellerWalletOf(d.seller);
    const tx0 = await WalletTransaction.countDocuments();
    const body = {
      availableMinor: 999_999_999,
      pendingMinor: 5,
      balance: 1,
      amountMinor: 1_000_000,
    };
    const paths = [
      '/wallet',
      '/wallet/balance',
      '/wallet/transactions',
      `/wallet/${wal0._id}`,
      '/wallet/withdrawals',
      '/admin/finance/wallets',
      `/admin/finance/wallets/${wal0._id}`,
      `/admin/finance/wallet-transactions`,
    ];
    for (const who of [d.seller, fin, root])
      for (const path of paths)
        for (const m of ['patch', 'put', 'delete'] as const) {
          const r = await request(h.app)[m](`${API}${path}`).set(who.auth).send(body);
          expect([401, 403, 404, 405], `${m} ${path}`).toContain(r.status);
        }
    // the write routes that do exist are strict: no extra fields, no negative amounts
    expect(
      (await w.call('put', d.seller, '/wallet/payout-account', { ...ACCOUNT, availableMinor: 1 }))
        .status,
    ).toBe(400);
    for (const amountMinor of [-1_000_000, 0])
      expect((await wd(d.seller, amountMinor)).status).toBe(400);
    const extra = await request(h.app)
      .post(`${API}/wallet/withdrawals`)
      .set(d.seller.auth)
      .set('idempotency-key', key('wd'))
      .send({ amountMinor: 100_000, availableMinor: 999_999_999 });
    expect(extra.status).toBe(400);
    const wal1 = await sellerWalletOf(d.seller);
    expect([wal1.pendingMinor, wal1.availableMinor]).toEqual([
      wal0.pendingMinor,
      wal0.availableMinor,
    ]);
    expect(await WalletTransaction.countDocuments()).toBe(tx0);
  });
});

// ===========================================================================
// H. Products and inventory
// ===========================================================================
describe('H1 product creation and moderation', () => {
  it('H1a draft → submit → moderator approval; invisible and unbuyable until approved; the seller cannot approve', async () => {
    const s = await shop.seller('H1 Farm');
    const p = await shop.create(s, { stock: 4 });
    expect(await Product.findById(p.id)).toMatchObject({ status: 'DRAFT', stock: 4, reserved: 0 });
    const init = await InventoryMovement.find({ productId: p.id });
    expect(init.map((m) => [m.type, m.deltaStock, String(m.actorId)])).toEqual([
      ['initial', 4, s.user.id],
    ]);
    const buyer = await shop.buyer();
    expect((await shop.get(buyer, `/shop/products/${p.id}`)).status).toBe(404);
    expect((await shop.put(buyer, p.id, 1)).status).toBe(404);
    expect(
      (await shop.call('post', s.user, `/farms/${s.farmId}/products/${p.id}/submit`)).body.product
        .status,
    ).toBe('PENDING_REVIEW');
    expect((await shop.put(buyer, p.id, 1)).status).toBe(404);
    expect(
      (await shop.call('post', s.user, `/shop/moderation/products/${p.id}/approve`)).status,
    ).toBe(403);
    const ok = await shop.call('post', shop.mod, `/shop/moderation/products/${p.id}/approve`);
    expect(ok.body.product.status).toBe('ACTIVE');
    expect((await Product.findById(p.id))?.status).toBe('ACTIVE');
    expect((await shop.get(buyer, `/shop/products/${p.id}`)).status).toBe(200);
    expect((await shop.put(buyer, p.id, 1)).status).toBe(200);
  });
});

describe('H2 inventory updates', () => {
  it('H2a adjustments are audited (actor, reason); stock can never go below what is reserved', async () => {
    const s = await shop.seller('H2 Farm');
    const p = await shop.live(s, { stock: 10 });
    const adj = (b: object) =>
      shop.call('post', s.user, `/farms/${s.farmId}/products/${p.id}/stock`, b);
    expect((await adj({ delta: 5, reason: 'Delivery from supplier' })).status).toBe(200);
    expect((await adj({ set: 12, reason: 'Stock count' })).status).toBe(200);
    const adjRows = await InventoryMovement.find({ productId: p.id, type: 'adjustment' }).sort({
      createdAt: 1,
    });
    expect(adjRows.map((m) => [m.deltaStock, m.note, String(m.actorId)])).toEqual([
      [5, 'Delivery from supplier', s.user.id],
      [-3, 'Stock count', s.user.id],
    ]);
    const buyer = await shop.buyer();
    await shop.put(buyer, p.id, 4);
    await shop.checkout(buyer);
    expect(await stockOf(p.id)).toEqual({ stock: 12, reserved: 4 });
    for (const b of [
      { set: 3, reason: 'Recount' },
      { delta: -9, reason: 'Damaged' },
    ]) {
      const r = await adj(b);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('BELOW_RESERVED');
    }
    expect(await stockOf(p.id)).toEqual({ stock: 12, reserved: 4 });
    expect(await movementSums(p.id)).toEqual({ stock: 12, reserved: 4 });
  });

  it('H2b parallel adjustments and checkouts keep stock ≥ reserved and the movement log equal to the product', async () => {
    const s = await shop.seller('H2b Farm');
    const p = await shop.live(s, { stock: 10 });
    const buyers = await Promise.all(Array.from({ length: 6 }, () => shop.buyer()));
    await Promise.all(buyers.map((b) => shop.put(b, p.id, 2)));
    const carts = await Promise.all(buyers.map((b) => shop.cartOf(b)));
    const results = await Promise.all([
      ...buyers.map((b, i) =>
        shop.call('post', b, '/shop/cart/checkout', {
          fulfillment: 'pickup',
          expected: shop.expectedOf(carts[i]),
        }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        shop.call('post', s.user, `/farms/${s.farmId}/products/${p.id}/stock`, {
          delta: i % 2 === 0 ? 1 : -1,
          reason: 'Parallel recount',
        }),
      ),
    ]);
    expect(results.every((r) => r.status < 500)).toBe(true);
    const now = await stockOf(p.id);
    expect(now.stock).toBeGreaterThanOrEqual(now.reserved);
    expect(await movementSums(p.id)).toEqual(now);
    const placed = results.slice(0, 6).filter((r) => r.status === 201).length;
    expect(now.reserved).toBe(placed * 2);
  });
});

describe('H3 concurrent purchases', () => {
  it('H3a 20 buyers race for 5 units: 5 orders, no oversell; paying all of them sells exactly 5; movements agree', async () => {
    const s = await shop.seller('H3 Farm');
    const p = await shop.live(s, { stock: 5 });
    const buyers = await Promise.all(Array.from({ length: 20 }, () => shop.buyer()));
    await Promise.all(buyers.map((b) => shop.put(b, p.id, 1)));
    const carts = await Promise.all(buyers.map((b) => shop.cartOf(b)));
    const rs = await Promise.all(
      buyers.map((b, i) =>
        shop.call('post', b, '/shop/cart/checkout', {
          fulfillment: 'pickup',
          expected: shop.expectedOf(carts[i]),
        }),
      ),
    );
    const ok = rs.map((r, i) => ({ r, b: buyers[i]! })).filter((x) => x.r.status === 201);
    expect(ok).toHaveLength(5);
    expect(
      rs
        .filter((r) => r.status !== 201)
        .every(
          (r) =>
            r.status === 409 &&
            ['INSUFFICIENT_STOCK', 'CART_HAS_PROBLEMS'].includes(r.body.error.code),
        ),
    ).toBe(true);
    expect(await stockOf(p.id)).toEqual({ stock: 5, reserved: 5 });
    expect(await movementSums(p.id)).toEqual({ stock: 5, reserved: 5 });
    const pays = await Promise.all(ok.map((x) => shop.pay(x.b, x.r.body.orders[0])));
    expect(pays.map((x) => x.result)).toEqual(Array(5).fill('succeeded'));
    expect(await stockOf(p.id)).toEqual({ stock: 0, reserved: 0 });
    expect(await movementSums(p.id)).toEqual({ stock: 0, reserved: 0 });
    const sold = await InventoryMovement.aggregate([
      { $match: { productId: new Types.ObjectId(p.id), type: 'sale' } },
      { $group: { _id: null, n: { $sum: 1 }, s: { $sum: '$deltaStock' } } },
    ]);
    expect([sold[0].n, -sold[0].s]).toEqual([5, 5]);
    await assertLedgerInvariants();
  });

  it('H3b the same buyer submitting the same cart checkout twice in parallel gets ONE order and one reservation', async () => {
    const s = await shop.seller('H3b Farm');
    const p = await shop.live(s, { stock: 10 });
    const buyer = await shop.buyer();
    await shop.put(buyer, p.id, 3);
    const body = { fulfillment: 'pickup', expected: shop.expectedOf(await shop.cartOf(buyer)) };
    const rs = await Promise.all([
      shop.call('post', buyer, '/shop/cart/checkout', body),
      shop.call('post', buyer, '/shop/cart/checkout', body),
    ]);
    const orders = await Order.find({ buyerId: buyer.id, kind: 'product' });
    const observed = {
      statuses: rs.map((r) => r.status),
      orders: orders.length,
      orderNos: orders.map((o) => o.orderNo),
      ...(await stockOf(p.id)),
      reserveMovements: await InventoryMovement.countDocuments({
        productId: p.id,
        type: 'reserve',
      }),
    };
    expect(observed, JSON.stringify(observed)).toMatchObject({
      orders: 1,
      reserved: 3,
      reserveMovements: 1,
    });
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
  });
});

describe('H4 out-of-stock behaviour', () => {
  it('H4a an out-of-stock or over-quantity line is flagged in the cart and checkout refuses without reserving anything', async () => {
    const s = await shop.seller('H4 Farm');
    const empty = await shop.live(s, { stock: 0 });
    const two = await shop.live(s, { stock: 2 });
    const buyer = await shop.buyer();
    expect((await shop.put(buyer, empty.id, 1)).status).toBe(200);
    expect((await shop.put(buyer, two.id, 3)).status).toBe(200);
    const cart = await shop.cartOf(buyer);
    const problems = Object.fromEntries(
      cart.groups.flatMap((g: any) => g.lines).map((l: any) => [l.productId, l.problems]),
    );
    expect(problems[empty.id]).toContain('out_of_stock');
    expect(problems[two.id]).toContain('insufficient_stock');
    const r = await shop.call('post', buyer, '/shop/cart/checkout', {
      fulfillment: 'pickup',
      expected: shop.expectedOf(cart),
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('CART_HAS_PROBLEMS');
    expect(await stockOf(two.id)).toEqual({ stock: 2, reserved: 0 });
    expect(await Order.countDocuments({ buyerId: buyer.id })).toBe(0);
  });

  it('H4b units sold out between viewing the cart and checking out: refused, nothing reserved, cart kept', async () => {
    const s = await shop.seller('H4b Farm');
    const p = await shop.live(s, { stock: 2 });
    const [a, b] = [await shop.buyer(), await shop.buyer()];
    await shop.put(a, p.id, 2);
    await shop.put(b, p.id, 2);
    const seenByA = await shop.cartOf(a);
    await shop.checkout(b);
    const r = await shop.call('post', a, '/shop/cart/checkout', {
      fulfillment: 'pickup',
      expected: shop.expectedOf(seenByA),
    });
    expect(r.status).toBe(409);
    expect(['CART_HAS_PROBLEMS', 'INSUFFICIENT_STOCK']).toContain(r.body.error.code);
    expect(await stockOf(p.id)).toEqual({ stock: 2, reserved: 2 });
    expect(await Order.countDocuments({ buyerId: a.id })).toBe(0);
    expect((await shop.cartOf(a)).groups[0].lines).toHaveLength(1);
  });
});

describe('H5 price changes', () => {
  it('H5a a price change between cart and checkout → 409 PRICE_CHANGED, nothing reserved; after checkout the order keeps its snapshot', async () => {
    const s = await shop.seller('H5 Farm');
    const p = await shop.live(s, { stock: 10, priceMinor: 120_000 });
    const buyer = await shop.buyer();
    await shop.put(buyer, p.id, 2);
    const seen = await shop.cartOf(buyer);
    expect(
      (
        await shop.call('patch', s.user, `/farms/${s.farmId}/products/${p.id}`, {
          priceMinor: 125_000,
        })
      ).status,
    ).toBe(200);
    const r = await shop.call('post', buyer, '/shop/cart/checkout', {
      fulfillment: 'pickup',
      expected: shop.expectedOf(seen),
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('PRICE_CHANGED');
    expect(await stockOf(p.id)).toEqual({ stock: 10, reserved: 0 });
    expect(await Order.countDocuments({ buyerId: buyer.id })).toBe(0);
    // checkout at the new price, then the seller changes it again
    const o = (await shop.checkout(buyer)).body.orders[0];
    await shop.call('patch', s.user, `/farms/${s.farmId}/products/${p.id}`, { priceMinor: 1 });
    const stored = (await Order.findById(o.id))!;
    expect([stored.items[0]!.unitPriceMinor, stored.itemsMinor, stored.grandTotalMinor]).toEqual([
      125_000, 250_000, 250_000,
    ]);
    const pay = await shop.pay(buyer, o);
    expect(pay.result).toBe('succeeded');
    expect((await Payment.findById(pay.payment.id))?.amountMinor).toBe(250_000);
  });
});

describe('H6 product restrictions', () => {
  it('H6a closed/regulated category and prohibited terms are refused on create and on edit of a live product', async () => {
    const s = await shop.seller('H6 Farm');
    const med = await shop.call('post', s.user, `/farms/${s.farmId}/products`, {
      ...(await import('../shop-fixtures')).PRODUCT,
      sku: `H6-${Date.now()}`,
      categoryKey: 'medicines',
    });
    expect(med.status).toBe(409);
    expect(med.body.error.code).toBe('CATEGORY_DISABLED');
    const banned = await shop.call('post', s.user, `/farms/${s.farmId}/products`, {
      ...(await import('../shop-fixtures')).PRODUCT,
      sku: `H6b-${Date.now()}`,
      title: 'Clenbuterol growth booster',
    });
    expect(banned.status).toBe(422);
    expect(banned.body.error.code).toBe('PROHIBITED_PRODUCT');
    expect(await Product.countDocuments({ farmId: s.farmId })).toBe(0);
    const live = await shop.live(s, { stock: 3 });
    const edit = await shop.call('patch', s.user, `/farms/${s.farmId}/products/${live.id}`, {
      description: 'Now with ractopamine for lean gain',
    });
    expect(edit.status).toBe(422);
    expect(await Product.findById(live.id)).toMatchObject({ status: 'ACTIVE' });
    expect((await Product.findById(live.id))!.description).not.toMatch(/ractopamine/i);
  });
});

describe('H7 refund and cancellation effects on inventory', () => {
  it('H7a unpaid cancel releases the reservation once; a second cancel is refused', async () => {
    const s = await shop.seller('H7 Farm');
    const p = await shop.live(s, { stock: 10 });
    const buyer = await shop.buyer();
    await shop.put(buyer, p.id, 3);
    const o = (await shop.checkout(buyer)).body.orders[0];
    expect(await stockOf(p.id)).toEqual({ stock: 10, reserved: 3 });
    expect(
      (await shop.call('post', buyer, `/orders/${o.id}/cancel`, { reason: 'Never mind' })).status,
    ).toBe(200);
    expect(
      (await shop.call('post', buyer, `/orders/${o.id}/cancel`, { reason: 'Never mind' })).status,
    ).toBe(409);
    expect(await stockOf(p.id)).toEqual({ stock: 10, reserved: 0 });
    expect(await movesOf(p.id)).toEqual(['initial:10/0', 'reserve:0/3', 'release:0/-3']);
  });

  it('H7b paid cancel → restock once; the refund completing (and its replay) never restocks again', async () => {
    const s = await shop.seller('H7b Farm');
    const p = await shop.live(s, { stock: 10 });
    const buyer = await shop.buyer();
    await shop.put(buyer, p.id, 4);
    const o = (await shop.checkout(buyer)).body.orders[0];
    await shop.pay(buyer, o);
    expect(await stockOf(p.id)).toEqual({ stock: 6, reserved: 0 });
    await shop.call('post', buyer, `/orders/${o.id}/cancel`, { reason: 'Changed my mind' });
    expect(await stockOf(p.id)).toEqual({ stock: 10, reserved: 0 });
    const refund = (await Refund.findOne({ orderId: o.id }))!;
    await admin('post', fin, `/refunds/${refund._id}/approve`, { confirmation: refund.refundNo });
    const ref = (await Refund.findById(refund._id))!.providerRef!;
    h.payments!.settleRefund(ref, 'succeeded');
    const ev = providerEvent('refund.succeeded', ref, refund.amountMinor);
    await send(h.app, ev);
    await send(h.app, ev);
    expect((await Order.findById(o.id))?.status).toBe('REFUNDED');
    expect(await stockOf(p.id)).toEqual({ stock: 10, reserved: 0 });
    expect(await movesOf(p.id)).toEqual([
      'initial:10/0',
      'reserve:0/4',
      'sale:-4/-4',
      'restock:4/0',
    ]);
    await assertLedgerInvariants();
  });

  it('H7c a returned shipment restocks once and the follow-up refund leaves stock alone', async () => {
    const s = await shop.seller('H7c Farm');
    const p = await shop.live(s, { stock: 5 });
    const buyer = await shop.buyer();
    await shop.put(buyer, p.id, 2);
    const o = (await shop.checkout(buyer, { delivery: true })).body.orders[0];
    await shop.pay(buyer, o);
    await shop.call('post', s.user, `/orders/${o.id}/process`);
    const sh = (
      await shop.call('post', s.user, `/orders/${o.id}/ship`, {
        carrier: 'Own truck',
        trackingNumber: `H7C-${Date.now()}`,
      })
    ).body.order.shipments[0];
    const cb = (status: string) =>
      shipWebhook(h.app, {
        type: 'shipment.status',
        carrier: sh.carrier,
        trackingNumber: sh.trackingNumber,
        status,
      });
    await cb('failed');
    await cb('returned');
    await cb('returned');
    expect((await Order.findById(o.id))?.status).toBe('REFUND_PENDING');
    expect(await stockOf(p.id)).toEqual({ stock: 5, reserved: 0 });
    const refund = (await Refund.findOne({ orderId: o.id }))!;
    expect(refund.amountMinor).toBe(o.totals.grandTotalMinor);
    await admin('post', fin, `/refunds/${refund._id}/approve`, { confirmation: refund.refundNo });
    const ref = (await Refund.findById(refund._id))!.providerRef!;
    h.payments!.settleRefund(ref, 'succeeded');
    await send(h.app, providerEvent('refund.succeeded', ref, refund.amountMinor));
    expect((await Order.findById(o.id))?.status).toBe('REFUNDED');
    expect(await stockOf(p.id)).toEqual({ stock: 5, reserved: 0 });
    expect(await InventoryMovement.countDocuments({ productId: p.id, type: 'restock' })).toBe(1);
    await assertLedgerInvariants();
  });
});

// ---------------------------------------------------------------------------
// Adversarial probes that may leave half-finished state behind run last, so they cannot disturb the checks above.
// ---------------------------------------------------------------------------
describe('F4 (probe) a signed capture of 0 satang', () => {
  it('F4d is handled without a server error and leaves nothing half-applied', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    const p = (await startPayment(h.app, d.buyer, o.id)).body.payment;
    const res = await send(h.app, providerEvent('charge.succeeded', p.providerRef, 0));
    const observed = {
      status: res.status,
      result: res.body.result ?? res.body.error?.code,
      payment: (await Payment.findById(p.id))!.toObject() as any,
      order: (await Order.findById(o.id))?.status,
    };
    expect
      .soft(
        {
          status: observed.status,
          order: observed.order,
          disposition:
            observed.payment.status === 'succeeded' ? observed.payment.disposition : 'n/a',
        },
        JSON.stringify({
          status: observed.status,
          result: observed.result,
          paymentStatus: observed.payment.status,
          disposition: observed.payment.disposition,
          order: observed.order,
        }),
      )
      .toEqual({
        status: 200,
        order: 'PENDING_PAYMENT',
        disposition: observed.payment.status === 'succeeded' ? 'unapplied' : 'n/a',
      });
    await assertLedgerInvariants();
    const rec = await admin('post', fin, '/reconcile', {});
    expect
      .soft(
        rec.body.report.issues.filter(
          (i: any) => i.ref.includes(p.id) && i.kind === 'missing_journal',
        ),
        'reconcile issues left by the 0-satang capture',
      )
      .toEqual([]);
    const repair = await admin('post', fin, '/reconcile', { repair: true, confirmation: 'REPAIR' });
    expect
      .soft(repair.status, `reconcile repair: ${JSON.stringify(repair.body).slice(0, 200)}`)
      .toBe(200);
    // the redelivered callback (providers retry on 5xx) must not keep failing either
    const again = await send(h.app, providerEvent('charge.succeeded', p.providerRef, 0));
    expect.soft(again.status, 'redelivery of the same 0-satang callback').toBe(200);
  });
});
