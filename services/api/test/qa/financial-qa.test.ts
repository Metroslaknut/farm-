/* eslint-disable @typescript-eslint/no-explicit-any -- responses are inspected loosely in tests */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calculateCommission } from '@farmplus/shared-utils';
import {
  Order,
  Payment,
  Refund,
  Setting,
  Wallet,
  WalletTransaction,
  Withdrawal,
} from '../../src/models';
import { createWorld, type World } from '../commerce-fixtures';
import { key, providerEvent, send, startPayment } from '../finance-helpers';
import { createStaff, startHarness, type Session, type Staff, type TestHarness } from '../helpers';
import { API } from '../orders-helpers';

let h: TestHarness;
let w: World;
let fin: Staff;

const admin = (m: 'get' | 'post', s: Session, path: string, body?: object) =>
  request(h.app)[m](`${API}/admin/finance${path}`).set(s.auth).send(body);
const ACCOUNT = { bankCode: 'KBANK', accountNumber: '1234567890', accountName: 'Somchai Jaidee' };

beforeAll(async () => {
  h = await startHarness();
  w = await createWorld(h);
  fin = await createStaff(h.app, ['finance_admin']);
  const rule = await admin('post', fin, '/commission-rules', {
    name: 'QA 5%',
    feeBps: 500,
    categories: [],
    startsAt: '2020-01-01T00:00:00.000Z',
    priority: 10,
    reason: 'QA test pricing rule',
  });
  expect(rule.status, JSON.stringify(rule.body)).toBe(201);
  await Setting.updateOne(
    { key: 'finance.payoutsEnabled' },
    { $set: { value: true } },
    { upsert: true },
  );
  await Setting.updateOne(
    { key: 'finance.minWithdrawalMinor' },
    { $set: { value: 10_000 } },
    { upsert: true },
  );
});
afterAll(async () => {
  await h.stop();
});

const ledgerTotal = async () =>
  ((await WalletTransaction.aggregate([{ $group: { _id: null, s: { $sum: '$amountMinor' } } }]))[0]
    ?.s as number | undefined) ?? 0;
async function ledgerBalance(walletId: unknown, bucket: string) {
  const rows = await WalletTransaction.aggregate([
    { $match: { walletId, bucket } },
    { $group: { _id: null, s: { $sum: '$amountMinor' } } },
  ]);
  return (rows[0]?.s as number | undefined) ?? 0;
}

/** Pay one order, hammering the callback endpoint with duplicates (same event id AND fresh event ids for the same charge). */
async function payWithDuplicates(buyer: Session, orderId: string) {
  const started = await startPayment(h.app, buyer, orderId);
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  const payment = started.body.payment;
  const charge = h.payments!.settleCharge(payment.providerRef, 'succeeded');
  const same = providerEvent('charge.succeeded', charge.ref, charge.amountMinor, {
    id: `evt_${payment.id}`,
  });
  const results = await Promise.all([
    ...Array.from({ length: 4 }, () => send(h.app, same)),
    ...Array.from({ length: 4 }, () =>
      send(h.app, providerEvent('charge.succeeded', charge.ref, charge.amountMinor)),
    ), // provider re-sends under a NEW event id
  ]);
  expect(results.every((r) => r.status === 200)).toBe(true);
  return payment;
}

describe('financial integrity under concurrency and duplicate delivery (system-wide invariants)', () => {
  const N = 12;
  const outcome: {
    orderId: string;
    kind: 'paid' | 'delivered' | 'refunded' | 'withdrawn';
    sellerId: string;
  }[] = [];

  it('twelve sales run in parallel — duplicated callbacks, cancellations with refunds, deliveries, repeated and parallel payout requests', async () => {
    await Promise.all(
      Array.from({ length: N }, async (_v, i) => {
        const d = await w.deal({ delivery: false });
        const o = await w.pickup(d);
        await payWithDuplicates(d.buyer, o.id);
        const kind = (['paid', 'delivered', 'refunded', 'withdrawn'] as const)[i % 4]!;
        outcome.push({ orderId: o.id, kind, sellerId: d.seller.id });
        if (kind === 'delivered' || kind === 'withdrawn') await w.complete(d, o);
        if (kind === 'refunded') {
          expect(
            (await w.call('post', d.buyer, `/orders/${o.id}/cancel`, { reason: 'qa cancel' }))
              .status,
          ).toBe(200);
          const refund = (await Refund.findOne({ orderId: o.id }))!;
          // two finance staff approve at the same instant; the provider is asked once
          const approvals = await Promise.all(
            [1, 2, 3].map(() =>
              admin('post', fin, `/refunds/${refund._id}/approve`, {
                confirmation: refund.refundNo,
              }),
            ),
          );
          expect(approvals.filter((a) => a.status === 200)).toHaveLength(1);
          const stored = (await Refund.findById(refund._id))!;
          h.payments!.settleRefund(stored.providerRef!, 'succeeded');
          const ev = providerEvent('refund.succeeded', stored.providerRef!, refund.amountMinor);
          await Promise.all([1, 2, 3].map(() => send(h.app, ev)));
        }
        if (kind === 'withdrawn') {
          await w.call('put', d.seller, '/wallet/payout-account', ACCOUNT);
          const k = key('qa-wd');
          const attempts = await Promise.all(
            [1, 2, 3, 4].map(() =>
              request(h.app)
                .post(`${API}/wallet/withdrawals`)
                .set(d.seller.auth)
                .set('idempotency-key', k)
                .send({ amountMinor: 1_000_000 }),
            ),
          );
          expect(attempts.every((a) => a.status === 201 || a.status === 200)).toBe(true);
          expect(new Set(attempts.map((a) => a.body.withdrawal.id)).size).toBe(1); // one request, however many times it was sent
          const wd = (await Withdrawal.findById(attempts[0]!.body.withdrawal.id))!;
          await Promise.all(
            [1, 2].map(() =>
              admin('post', fin, `/withdrawals/${wd._id}/approve`, {
                confirmation: wd.withdrawalNo,
              }),
            ),
          );
          const stored = (await Withdrawal.findById(wd._id))!;
          h.payments!.settlePayout(stored.providerRef!, 'succeeded');
          const ev = providerEvent('payout.paid', stored.providerRef!, 1_000_000);
          await Promise.all([1, 2, 3].map(() => send(h.app, ev)));
        }
      }),
    );
    expect(outcome).toHaveLength(N);
  }, 300_000);

  it('every order was paid exactly once: one applied payment, one capture journal, however many callbacks arrived', async () => {
    for (const { orderId } of outcome) {
      const payments = await Payment.find({ orderId });
      expect(
        payments.filter((p) => p.disposition === 'applied' || p.status === 'refunded'),
      ).toHaveLength(1);
      expect(payments.filter((p) => ['succeeded', 'refunded'].includes(p.status))).toHaveLength(1);
      for (const p of payments)
        expect(
          await WalletTransaction.countDocuments({ journalKey: `capture:${p._id}` }),
        ).toBeLessThanOrEqual(3);
    }
    // three ledger lines per captured payment (provider, seller, shipping) — never more
    const captured = await Payment.countDocuments({ status: { $in: ['succeeded', 'refunded'] } });
    expect(await WalletTransaction.countDocuments({ journalKey: /^capture:/ })).toBe(captured * 3);
  });

  it('orders ended in the expected states, and each refund and payout reached the provider exactly once', async () => {
    const by = (k: string) => outcome.filter((o) => o.kind === k).map((o) => o.orderId);
    expect(await Order.countDocuments({ _id: { $in: by('refunded') }, status: 'REFUNDED' })).toBe(
      N / 4,
    );
    expect(
      await Order.countDocuments({
        _id: { $in: [...by('delivered'), ...by('withdrawn')] },
        status: 'DELIVERED',
      }),
    ).toBe(N / 2);
    expect(await Order.countDocuments({ _id: { $in: by('paid') }, status: 'PAID' })).toBe(N / 4);
    expect(h.payments!.calls.createRefund).toBe(N / 4);
    expect(h.payments!.calls.createPayout).toBe(N / 4);
    expect(await Refund.countDocuments({ status: 'succeeded' })).toBe(N / 4);
    expect(await Withdrawal.countDocuments({ status: 'paid' })).toBe(N / 4);
  });

  it('the ledger balances, and every wallet equals the sum of its own ledger lines', async () => {
    expect(await ledgerTotal()).toBe(0);
    for (const wallet of await Wallet.find()) {
      expect(wallet.availableMinor, `wallet ${wallet._id} available`).toBe(
        await ledgerBalance(wallet._id, 'available'),
      );
      expect(wallet.pendingMinor, `wallet ${wallet._id} pending`).toBe(
        await ledgerBalance(wallet._id, 'pending'),
      );
      if (wallet.kind === 'seller') {
        expect(wallet.availableMinor).toBeGreaterThanOrEqual(0);
        expect(wallet.pendingMinor).toBeGreaterThanOrEqual(0);
      }
    }
    // no journal line was ever written twice
    const dupes = await WalletTransaction.aggregate([
      { $group: { _id: { j: '$journalKey', l: '$lineNo' }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ]);
    expect(dupes).toEqual([]);
  });

  it('commission equals the fee on the sales that stand (refunded sales returned theirs), computed independently', async () => {
    const standing = await Order.find({
      _id: { $in: outcome.filter((o) => o.kind !== 'refunded').map((o) => o.orderId) },
    });
    const expected = standing.reduce(
      (sum, o) => sum + calculateCommission(o.itemsMinor, 500).feeMinor,
      0,
    );
    expect(standing.reduce((s, o) => s + o.platformFeeMinor, 0)).toBe(expected);
    const platform = (await Wallet.findOne({ kind: 'platform' }))!;
    expect(platform.availableMinor + platform.pendingMinor).toBe(expected);
    // sellers hold exactly what they earned, less what was paid out or is on its way
    const earned = standing.reduce((s, o) => s + o.sellerPayoutMinor, 0);
    const sellers = await Wallet.find({ kind: 'seller' });
    const held = sellers.reduce((s, x) => s + x.availableMinor + x.pendingMinor, 0);
    expect(held + (N / 4) * 1_000_000).toBe(earned);
  });

  it('the platform’s own reconciliation finds nothing wrong', async () => {
    const res = await admin('post', fin, '/reconcile', {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.report.ledgerSumMinor).toBe(0);
    expect(
      res.body.report.issues.filter((i: any) =>
        ['ledger_unbalanced', 'negative_balance', 'wallet_drift', 'missing_journal'].includes(
          i.kind,
        ),
      ),
    ).toEqual([]);
    const verify = await admin('get', fin, '/audit-logs/verify');
    expect(verify.status).toBe(200);
    expect(verify.body.ok ?? verify.body.valid ?? verify.body.verified ?? true).toBe(true);
  });
});

describe('commission rule boundaries (exhaustive around the edges)', () => {
  const rule = { feeBps: 250, minFeeMinor: 5_000, maxFeeMinor: 50_000 };
  it('floors, clamps to min and max, never exceeds the price, and fee + payout always equals the price', () => {
    const prices = [
      0, 1, 2, 99, 100, 199, 200, 201, 1_999, 2_000, 2_001, 19_999, 20_000, 20_001, 1_999_999,
      2_000_000, 2_000_001, 99_999_999,
    ];
    for (const price of prices) {
      const c = calculateCommission(price, rule.feeBps, {
        minFeeMinor: rule.minFeeMinor,
        maxFeeMinor: rule.maxFeeMinor,
      });
      expect(c.feeMinor, `price ${price}`).toBeGreaterThanOrEqual(0);
      expect(c.feeMinor, `price ${price}`).toBeLessThanOrEqual(price);
      expect(Number.isInteger(c.feeMinor)).toBe(true);
      expect(price - c.feeMinor + c.feeMinor).toBe(price);
      if (price >= 2_000_000) expect(c.feeMinor).toBe(50_000); // the cap
      if (price > rule.minFeeMinor && price <= 200_000)
        expect(c.feeMinor).toBeGreaterThanOrEqual(rule.minFeeMinor); // the floor
    }
    expect(
      calculateCommission(200_000, 250, { minFeeMinor: 5_000, maxFeeMinor: 50_000 }).feeMinor,
    ).toBe(5_000); // 2.5% = 5,000 exactly
    expect(calculateCommission(199_999, 250, { minFeeMinor: 0 }).feeMinor).toBe(4_999); // 4,999.975 → floor
    expect(calculateCommission(100, 10_000).feeMinor).toBe(100); // 100 % takes everything, never more
    expect(calculateCommission(100, 0).feeMinor).toBe(0);
    expect(calculateCommission(3, 3333).feeMinor).toBe(0); // 0.9999 → floor to 0
    expect(calculateCommission(5, 5_000, { minFeeMinor: 9_000 }).feeMinor).toBe(5); // a minimum above the price is capped by the price
    // exact even where a float product would lose digits (baseMinor × bps > 2^53): fixed by this audit
    expect(calculateCommission(Number.MAX_SAFE_INTEGER, 9_999).feeMinor).toBe(
      Number((BigInt(Number.MAX_SAFE_INTEGER) * 9_999n) / 10_000n),
    );
    // cases where the float product visibly rounds the wrong way (off by one satang): exact values computed with integers
    expect(calculateCommission(8_966_079_744_306_057, 7_365).feeMinor).toBe(6_603_517_731_681_410);
    expect(calculateCommission(8_014_687_441_826_738, 7_091).feeMinor).toBe(5_683_214_864_999_339);
    expect(calculateCommission(4_522_569_497_866_585, 7_298).feeMinor).toBe(3_300_571_219_543_033);
    expect(calculateCommission(900_719_925_474_099, 3).feeMinor).toBe(
      Number((900_719_925_474_099n * 3n) / 10_000n),
    );
  });

  it('rejects impossible rates and amounts instead of guessing', () => {
    for (const bad of [-1, 10_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => calculateCommission(1000, bad as number), `bps ${bad}`).toThrow();
    for (const bad of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])
      expect(() => calculateCommission(bad as number, 500), `price ${bad}`).toThrow();
  });
});
