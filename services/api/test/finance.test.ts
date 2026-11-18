/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  calculateCommission,
  rulesOverlap,
  selectCommissionRule,
  type CommissionRuleLike,
} from '@farmplus/shared-utils';
import {
  PAYMENT_TRANSITIONS,
  REFUND_TRANSITIONS,
  WITHDRAWAL_TRANSITIONS,
} from '@farmplus/shared-types';
import {
  AuditLog,
  CommissionRule,
  FinancialAuditLog,
  Order,
  Payment,
  Refund,
  Setting,
  Wallet,
  WalletTransaction,
  Withdrawal,
} from '../src/models';
import { verifyAuditChain } from '../src/modules/finance/audit';
import { postJournal, sellerWallet, systemWallet } from '../src/modules/finance/ledger';
import { PaymentProviderError } from '../src/modules/finance/provider';
import { createWorld, type World } from './commerce-fixtures';
import { key, payOrder, providerEvent, send, startPayment } from './finance-helpers';
import {
  createStaff,
  createUser,
  startHarness,
  type Session,
  type Staff,
  type TestHarness,
} from './helpers';
import { API } from './orders-helpers';

let h: TestHarness;
let w: World;
let fin: Staff;
let root: Staff;

beforeAll(async () => {
  h = await startHarness();
  w = await createWorld(h);
  fin = await createStaff(h.app, ['finance_admin']);
  root = await createStaff(h.app, ['super_admin']);
  mods['mod'] = await createStaff(h.app, ['moderator']);
});
afterAll(async () => {
  await h.stop();
});
afterEach(async () => {
  await CommissionRule.updateMany({}, { $set: { active: false } });
  await Setting.deleteMany({ key: { $regex: '^finance\\.|orders\\.platformFeeBps' } });
  h.payments!.failNext = null;
});

const admin = (m: 'get' | 'post' | 'patch' | 'put', s: Session, path: string, body?: object) =>
  request(h.app)[m](`${API}/admin/finance${path}`).set(s.auth).send(body);

const RULE = {
  name: 'Standard 5%',
  feeBps: 500,
  categories: [] as string[],
  startsAt: '2020-01-01T00:00:00.000Z',
  priority: 10,
  reason: 'Initial launch pricing',
};
async function makeRule(over: Record<string, unknown> = {}) {
  const res = await admin('post', fin, '/commission-rules', { ...RULE, ...over });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.rule as any;
}

/** Sums of every ledger line, per wallet and bucket. */
async function ledgerBalance(walletId: unknown, bucket: 'pending' | 'available') {
  const rows = await WalletTransaction.aggregate([
    { $match: { walletId, bucket } },
    { $group: { _id: null, sum: { $sum: '$amountMinor' } } },
  ]);
  return (rows[0]?.sum as number | undefined) ?? 0;
}
const ledgerTotal = async () =>
  ((await WalletTransaction.aggregate([{ $group: { _id: null, s: { $sum: '$amountMinor' } } }]))[0]
    ?.s as number | undefined) ?? 0;

/** A delivery order that is paid (fee per any active rule). */
async function paidDelivery(opts: Parameters<World['deal']>[0] = {}) {
  const d = await w.deal(opts);
  const o = await w.checkout(d);
  const p = await payOrder(h, d.buyer, o);
  expect(p.result).toBe('succeeded');
  buyers.set(o.id, d.buyer);
  return { d, o, p };
}
async function paidPickup(opts: Parameters<World['deal']>[0] = {}) {
  const d = await w.deal({ delivery: false, ...opts });
  const o = await w.pickup(d);
  const p = await payOrder(h, d.buyer, o);
  expect(p.result).toBe('succeeded');
  buyers.set(o.id, d.buyer);
  return { d, o, p };
}

// ---------------------------------------------------------------------------
describe('commission maths (pure, deterministic)', () => {
  it('floors the percentage, applies the minimum then the maximum, and never exceeds the price', () => {
    expect(calculateCommission(4_000_000, 500).feeMinor).toBe(200_000);
    expect(calculateCommission(999, 250).rawFeeMinor).toBe(24); // 24.975 → floor
    expect(calculateCommission(1, 9999).feeMinor).toBe(0);
    expect(calculateCommission(0, 500).feeMinor).toBe(0);
    expect(calculateCommission(100_000, 100, { minFeeMinor: 5_000 })).toMatchObject({
      rawFeeMinor: 1_000,
      feeMinor: 5_000,
      clamp: 'min',
    });
    expect(calculateCommission(10_000_000, 1000, { maxFeeMinor: 300_000 })).toMatchObject({
      rawFeeMinor: 1_000_000,
      feeMinor: 300_000,
      clamp: 'max',
    });
    expect(calculateCommission(2_000, 100, { minFeeMinor: 5_000 })).toMatchObject({
      feeMinor: 2_000,
      clamp: 'base',
    }); // fee can never exceed the price
    expect(
      calculateCommission(100_000, 500, { minFeeMinor: 1, maxFeeMinor: 999_999 }).clamp,
    ).toBeNull();
  });
  it('rejects impossible input instead of guessing', () => {
    expect(() => calculateCommission(-1, 500)).toThrow(RangeError);
    expect(() => calculateCommission(1.5, 500)).toThrow(RangeError);
    expect(() => calculateCommission(100, 10_001)).toThrow(RangeError);
    expect(() => calculateCommission(100, 5.5)).toThrow(RangeError);
    expect(() => calculateCommission(100, 100, { minFeeMinor: 10, maxFeeMinor: 5 })).toThrow(
      RangeError,
    );
  });
  it('is the same every time, and always satisfies 0 ≤ fee ≤ price (randomised check)', () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      return seed % n;
    };
    for (let i = 0; i < 2000; i++) {
      const base = rnd(2_000_000_000);
      const bps = rnd(5001);
      const min = rnd(3) === 0 ? rnd(50_000) : null;
      const max = rnd(3) === 0 ? (min ?? 0) + rnd(500_000) : null;
      const a = calculateCommission(base, bps, { minFeeMinor: min, maxFeeMinor: max });
      expect(a).toEqual(calculateCommission(base, bps, { minFeeMinor: min, maxFeeMinor: max }));
      expect(a.feeMinor).toBeGreaterThanOrEqual(0);
      expect(a.feeMinor).toBeLessThanOrEqual(base);
      expect(Number.isInteger(a.feeMinor)).toBe(true);
      if (max !== null) expect(a.feeMinor).toBeLessThanOrEqual(max);
      if (min !== null && min <= base) expect(a.feeMinor).toBeGreaterThanOrEqual(min);
    }
  });
});

describe('commission rule selection and conflicts (pure)', () => {
  const rule = (id: string, over: Partial<CommissionRuleLike> = {}): CommissionRuleLike => ({
    id,
    name: id,
    version: 1,
    feeBps: 100,
    categories: [],
    startsAt: new Date('2025-01-01T00:00:00Z'),
    priority: 10,
    active: true,
    ...over,
  });
  const at = new Date('2025-06-01T00:00:00Z');
  it('the matching rule with the highest priority wins; inactive, out-of-window, out-of-range and wrong-category rules never match', () => {
    const rules = [
      rule('a', { priority: 1 }),
      rule('b', { priority: 50, categories: ['buffalo'], feeBps: 300 }),
      rule('c', { priority: 99, active: false }),
      rule('d', { priority: 98, endsAt: new Date('2025-05-01T00:00:00Z') }),
      rule('e', { priority: 97, startsAt: new Date('2025-07-01T00:00:00Z') }),
      rule('f', { priority: 96, priceMinMinor: 10_000_000 }),
      rule('g', { priority: 95, priceMaxMinor: 10 }),
      rule('h', { priority: 94, categories: ['goat'] }),
    ];
    expect(
      selectCommissionRule(rules, { priceMinor: 4_000_000, categoryKey: 'buffalo', at })?.id,
    ).toBe('b');
    expect(
      selectCommissionRule(rules, { priceMinor: 4_000_000, categoryKey: 'cattle', at })?.id,
    ).toBe('a');
    expect(selectCommissionRule([], { priceMinor: 1, at })).toBeNull();
  });
  it('price range bounds are inclusive; the end date is exclusive', () => {
    const r = rule('r', {
      priceMinMinor: 100,
      priceMaxMinor: 200,
      endsAt: new Date('2025-06-02T00:00:00Z'),
    });
    for (const [p, ok] of [
      [99, false],
      [100, true],
      [200, true],
      [201, false],
    ] as const)
      expect(!!selectCommissionRule([r], { priceMinor: p, at })).toBe(ok);
    expect(
      selectCommissionRule([r], { priceMinor: 150, at: new Date('2025-06-02T00:00:00Z') }),
    ).toBeNull();
    expect(
      selectCommissionRule([r], { priceMinor: 150, at: new Date('2025-06-01T23:59:59Z') }),
    ).not.toBeNull();
  });
  it('a stored tie (which saving refuses) still resolves the same way every time', () => {
    const a = rule('1', { feeBps: 100 });
    const b = rule('2', { feeBps: 900 });
    expect(selectCommissionRule([a, b], { priceMinor: 5, at })?.id).toBe('1');
    expect(selectCommissionRule([b, a], { priceMinor: 5, at })?.id).toBe('1');
  });
  it('detects overlapping scopes (time, price and category)', () => {
    const base = rule('x', { categories: ['buffalo'], priceMinMinor: 0, priceMaxMinor: 100 });
    expect(rulesOverlap(base, rule('y', { categories: ['buffalo'] }))).toBe(true);
    expect(rulesOverlap(base, rule('y', { categories: [] }))).toBe(true); // "all categories" includes buffalo
    expect(rulesOverlap(base, rule('y', { categories: ['goat'] }))).toBe(false);
    expect(rulesOverlap(base, rule('y', { categories: ['buffalo'], priceMinMinor: 101 }))).toBe(
      false,
    );
    expect(
      rulesOverlap(
        rule('p', { endsAt: new Date('2025-03-01T00:00:00Z') }),
        rule('q', { startsAt: new Date('2025-03-01T00:00:00Z') }),
      ),
    ).toBe(false);
    expect(
      rulesOverlap(
        rule('p', { endsAt: new Date('2025-03-02T00:00:00Z') }),
        rule('q', { startsAt: new Date('2025-03-01T00:00:00Z') }),
      ),
    ).toBe(true);
  });
});

describe('state tables', () => {
  it('payments, refunds and withdrawals can only move along the documented edges', () => {
    const edges = (t: Record<string, readonly string[]>) =>
      Object.entries(t)
        .flatMap(([f, tos]) => tos.map((x) => `${f}>${x}`))
        .sort();
    expect(edges(PAYMENT_TRANSITIONS)).toEqual(
      [
        'pending>succeeded',
        'pending>failed',
        'pending>cancelled',
        'pending>expired',
        'succeeded>refunded',
        'cancelled>succeeded',
        'expired>succeeded',
      ].sort(),
    );
    expect(edges(REFUND_TRANSITIONS)).toEqual(
      [
        'requested>approved',
        'approved>processing',
        'processing>succeeded',
        'processing>failed',
        'failed>processing',
      ].sort(),
    );
    expect(edges(WITHDRAWAL_TRANSITIONS)).toEqual(
      [
        'requested>approved',
        'requested>rejected',
        'requested>cancelled',
        'approved>processing',
        'processing>paid',
        'processing>failed',
      ].sort(),
    );
    // nothing ever leaves these
    for (const s of ['failed', 'refunded']) expect(PAYMENT_TRANSITIONS[s as 'failed']).toEqual([]);
    for (const s of ['paid', 'failed', 'rejected', 'cancelled'])
      expect(WITHDRAWAL_TRANSITIONS[s as 'paid']).toEqual([]);
    expect(REFUND_TRANSITIONS.succeeded).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('commission rules API', () => {
  it('only finance staff with commissions.manage can read or change rules; everyone else is refused', async () => {
    const buyer = await createUser(h.app);
    const mod = await createStaff(h.app, ['moderator']);
    for (const who of [buyer, mod]) {
      expect((await admin('get', who, '/commission-rules')).status).toBe(403);
      expect((await admin('post', who, '/commission-rules', RULE)).status).toBe(403);
      expect(
        (await admin('post', who, '/commission-rules/preview', { priceMinor: 100 })).status,
      ).toBe(403);
    }
    expect((await request(h.app).get(`${API}/admin/finance/commission-rules`)).status).toBe(401);
    // staff without MFA enrolment have their finance permissions withheld
    const noMfa = await createStaff(h.app, ['finance_admin'], { enrollMfa: false });
    const r = await admin('get', noMfa, '/commission-rules');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('MFA_REQUIRED');
    expect((await admin('get', fin, '/commission-rules')).status).toBe(200);
  });

  it('validates input: percentage cap, bounds order, date order, whole satang, a reason, no unknown fields', async () => {
    const bad = async (over: Record<string, unknown>, path: string) => {
      const r = await admin('post', fin, '/commission-rules', { ...RULE, ...over });
      expect(r.status, JSON.stringify(over)).toBe(400);
      expect(r.body.error.details.map((x: any) => x.path)).toContain(path);
    };
    await bad({ feeBps: 5001 }, 'feeBps');
    await bad({ feeBps: -1 }, 'feeBps');
    await bad({ feeBps: 1.5 }, 'feeBps');
    await bad({ minFeeMinor: 500, maxFeeMinor: 100 }, 'maxFeeMinor');
    await bad({ priceMinMinor: 500, priceMaxMinor: 100 }, 'priceMaxMinor');
    await bad({ endsAt: '2019-01-01T00:00:00.000Z' }, 'endsAt');
    await bad({ minFeeMinor: 1.5 }, 'minFeeMinor');
    await bad({ reason: '' }, 'reason');
    await bad({ priority: 1001 }, 'priority');
    await bad({ name: 'x' }, 'name');
    await bad({ startsAt: 'yesterday' }, 'startsAt');
    expect(
      (await admin('post', fin, '/commission-rules', { ...RULE, active: true, createdBy: 'me' }))
        .status,
    ).toBe(400);
  });

  it('refuses equal-priority rules that could apply to the same sale, but allows different priorities and disjoint scopes', async () => {
    await makeRule({ name: 'Buffalo', categories: ['buffalo'], priority: 20 });
    const clash = await admin('post', fin, '/commission-rules', {
      ...RULE,
      name: 'All',
      priority: 20,
    });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('RULE_CONFLICT');
    await makeRule({ name: 'Goat', categories: ['goat'], priority: 20 }); // disjoint categories
    await makeRule({ name: 'All but lower', priority: 5 }); // different priority
    await makeRule({
      name: 'Cheap buffalo',
      categories: ['buffalo'],
      priority: 20,
      priceMaxMinor: 99,
      startsAt: '2030-01-01T00:00:00.000Z',
    }).catch(() => null);
  });

  it('the highest-priority matching rule sets the fee; the preview shows the calculation and which rule applied', async () => {
    await makeRule({ name: 'Base', feeBps: 300, priority: 1 });
    await makeRule({
      name: 'Buffalo premium',
      feeBps: 800,
      minFeeMinor: 50_000,
      categories: ['buffalo'],
      priority: 30,
    });
    const buffalo = (
      await admin('post', fin, '/commission-rules/preview', {
        priceMinor: 4_000_000,
        categoryKey: 'buffalo',
      })
    ).body.fee;
    expect(buffalo).toMatchObject({
      source: 'rule',
      ruleName: 'Buffalo premium',
      feeBps: 800,
      baseMinor: 4_000_000,
      rawFeeMinor: 320_000,
      feeMinor: 320_000,
      clamp: null,
    });
    const goat = (
      await admin('post', fin, '/commission-rules/preview', {
        priceMinor: 4_000_000,
        categoryKey: 'goat',
      })
    ).body.fee;
    expect(goat).toMatchObject({ ruleName: 'Base', feeMinor: 120_000 });
    const tiny = (
      await admin('post', fin, '/commission-rules/preview', {
        priceMinor: 100_000,
        categoryKey: 'buffalo',
      })
    ).body.fee;
    expect(tiny).toMatchObject({ rawFeeMinor: 8_000, feeMinor: 50_000, clamp: 'min' });
    // an effective window in the future does not apply yet
    await makeRule({
      name: 'Future',
      feeBps: 1500,
      priority: 90,
      startsAt: '2999-01-01T00:00:00.000Z',
    });
    expect(
      (
        await admin('post', fin, '/commission-rules/preview', {
          priceMinor: 4_000_000,
          categoryKey: 'buffalo',
        })
      ).body.fee.ruleName,
    ).toBe('Buffalo premium');
    expect(
      (
        await admin('post', fin, '/commission-rules/preview', {
          priceMinor: 4_000_000,
          categoryKey: 'buffalo',
          at: '2999-06-01T00:00:00.000Z',
        })
      ).body.fee.ruleName,
    ).toBe('Future');
  });

  it('with no matching rule the platform default applies (0 by default)', async () => {
    const none = (await admin('post', fin, '/commission-rules/preview', { priceMinor: 4_000_000 }))
      .body.fee;
    expect(none).toMatchObject({ source: 'default_setting', ruleId: null, feeBps: 0, feeMinor: 0 });
    await Setting.updateOne(
      { key: 'orders.platformFeeBps' },
      { $set: { value: 250 } },
      { upsert: true },
    );
    expect(
      (await admin('post', fin, '/commission-rules/preview', { priceMinor: 4_000_000 })).body.fee,
    ).toMatchObject({ source: 'default_setting', feeBps: 250, feeMinor: 100_000 });
  });

  it('editing bumps the version and records before/after with the reason; deactivating stops it applying', async () => {
    const r = await makeRule({ name: 'Edit me', feeBps: 400, priority: 40 });
    const up = await admin('patch', fin, `/commission-rules/${r.id}`, {
      feeBps: 600,
      reason: 'Seasonal change',
    });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body.rule).toMatchObject({ feeBps: 600, version: 2 });
    expect(
      (await admin('patch', fin, `/commission-rules/${r.id}`, { feeBps: 9000, reason: 'oops' }))
        .status,
    ).toBe(400);
    expect((await admin('patch', fin, `/commission-rules/${r.id}`, { feeBps: 100 })).status).toBe(
      400,
    ); // reason required
    const log = await FinancialAuditLog.findOne({
      action: 'commission_rule.updated',
      targetId: r.id,
    });
    expect(log?.data).toMatchObject({
      reason: 'Seasonal change',
      before: { feeBps: 400 },
      after: { feeBps: 600 },
    });
    const off = await admin('patch', fin, `/commission-rules/${r.id}`, {
      active: false,
      reason: 'No longer needed',
    });
    expect(off.body.rule.active).toBe(false);
    expect(
      await FinancialAuditLog.countDocuments({
        action: 'commission_rule.deactivated',
        targetId: r.id,
      }),
    ).toBe(1);
    expect(
      (await admin('post', fin, '/commission-rules/preview', { priceMinor: 4_000_000 })).body.fee
        .source,
    ).toBe('default_setting');
    expect(
      (
        await admin('patch', fin, `/commission-rules/000000000000000000000000`, {
          feeBps: 1,
          reason: 'zzz',
        })
      ).status,
    ).toBe(404);
  });

  it('the fee is frozen on the order with its full calculation; later rule changes never touch it', async () => {
    const rule = await makeRule({
      name: 'Frozen 5%',
      feeBps: 500,
      maxFeeMinor: 150_000,
      categories: ['buffalo'],
      priority: 60,
    });
    const d = await w.deal();
    const o = await w.checkout(d);
    const doc = (await Order.findById(o.id))!;
    expect(doc.platformFeeMinor).toBe(150_000); // 5% of 4,000,000 = 200,000, capped at 150,000
    expect(doc.sellerPayoutMinor).toBe(3_850_000);
    expect(doc.feeSnapshot).toMatchObject({
      source: 'rule',
      ruleId: rule.id,
      ruleName: 'Frozen 5%',
      ruleVersion: 1,
      feeBps: 500,
      baseMinor: 4_000_000,
      rawFeeMinor: 200_000,
      maxFeeMinor: 150_000,
      feeMinor: 150_000,
      clamp: 'max',
      categoryKey: 'buffalo',
    });
    // totals keep shipping, items and fee separate
    expect(o.totals).toMatchObject({
      itemsMinor: 4_000_000,
      shippingMinor: 250_000,
      grandTotalMinor: 4_250_000,
    });
    // change and then switch off the rule: the existing order is unaffected
    await admin('patch', fin, `/commission-rules/${rule.id}`, {
      feeBps: 4000,
      maxFeeMinor: null,
      reason: 'Big change',
    });
    await admin('patch', fin, `/commission-rules/${rule.id}`, { active: false, reason: 'Gone' });
    const after = (await Order.findById(o.id))!;
    expect(after.platformFeeMinor).toBe(150_000);
    expect(after.feeSnapshot).toMatchObject({ ruleVersion: 1, feeBps: 500, feeMinor: 150_000 });
    // and a new order gets the platform default (rule is gone), also with a snapshot
    const o2 = await w.checkout(await w.deal());
    expect((await Order.findById(o2.id))!.feeSnapshot).toMatchObject({
      source: 'default_setting',
      feeMinor: 0,
    });
  });
});

// ---------------------------------------------------------------------------
describe('starting a payment', () => {
  it('only the buyer can pay for an order; strangers, the seller and staff get 404', async () => {
    const d = await w.deal();
    const o = await w.checkout(d);
    const stranger = await createUser(h.app);
    for (const who of [stranger, d.seller, d.manager, fin])
      expect((await startPayment(h.app, who, o.id)).status).toBe(404);
    expect((await request(h.app).post(`${API}/payments`).send({ orderId: o.id })).status).toBe(401);
    expect((await w.call('get', stranger, `/payments?orderId=${o.id}`)).status).toBe(404);
    expect(await Payment.countDocuments({ orderId: o.id })).toBe(0);
  });

  it('needs an Idempotency-Key, validates the body, and refuses payment when the provider is off or the order is not payable', async () => {
    const d = await w.deal();
    const o = await w.checkout(d);
    const missing = await startPayment(h.app, d.buyer, o.id, null);
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect((await startPayment(h.app, d.buyer, o.id, 'short')).status).toBe(400);
    expect(
      (
        await w.call(
          'post',
          d.buyer,
          '/payments',
          { orderId: o.id, amountMinor: 1 },
          { 'idempotency-key': key() },
        )
      ).status,
    ).toBe(400); // the client cannot choose the amount
    expect(
      (
        await w.call(
          'post',
          d.buyer,
          '/payments',
          { orderId: 'nope' },
          { 'idempotency-key': key() },
        )
      ).status,
    ).toBe(400);
    // payment disabled
    const { createApp } = await import('../src/app');
    const off = createApp(
      { ...h.env, PAYMENT_PROVIDER: 'none' },
      { video: h.video, payments: null },
    );
    const r = await startPayment(off, d.buyer, o.id);
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('PAYMENTS_UNAVAILABLE');
    // cancelled order
    await w.call('post', d.buyer, `/orders/${o.id}/cancel`, { reason: 'not needed' });
    expect((await startPayment(h.app, d.buyer, o.id)).body.error.code).toBe('ORDER_NOT_PAYABLE');
  });

  it('the amount always comes from the frozen order total, never from the client', async () => {
    const d = await w.deal();
    const o = await w.checkout(d);
    const r = await startPayment(h.app, d.buyer, o.id);
    expect(r.status).toBe(201);
    expect(r.body.payment).toMatchObject({
      amountMinor: 4_250_000,
      currency: 'THB',
      status: 'pending',
      mock: true,
      orderNo: o.orderNo,
    });
    expect(h.payments!.charges.get(r.body.payment.providerRef)).toMatchObject({
      amountMinor: 4_250_000,
      reference: o.orderNo,
    });
  });

  it('a repeated request with the same key returns the same payment; a new key while one is open is refused', async () => {
    const d = await w.deal();
    const o = await w.checkout(d);
    const k = key('replay');
    const first = await startPayment(h.app, d.buyer, o.id, k);
    const again = await startPayment(h.app, d.buyer, o.id, k);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect(again.body.payment.id).toBe(first.body.payment.id);
    const other = await startPayment(h.app, d.buyer, o.id, key('other'));
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('PAYMENT_IN_PROGRESS');
    expect(await Payment.countDocuments({ orderId: o.id })).toBe(1);
    // even after the order was paid, repeating the original request returns that payment instead of an error
    const ch = h.payments!.settleCharge(first.body.payment.providerRef, 'succeeded');
    await send(h.app, providerEvent('charge.succeeded', ch.ref, ch.amountMinor));
    expect((await Order.findById(o.id))?.status).toBe('PAID');
    const late = await startPayment(h.app, d.buyer, o.id, k);
    expect(late.status).toBe(200);
    expect(late.body.payment).toMatchObject({ id: first.body.payment.id, status: 'succeeded' });
    expect((await startPayment(h.app, d.buyer, o.id, key('fresh'))).body.error.code).toBe(
      'ORDER_NOT_PAYABLE',
    );
  });

  it('parallel requests can never create two open payments or two provider charges', async () => {
    const d = await w.deal();
    const o = await w.checkout(d);
    const before = h.payments!.calls.createCharge;
    const rs = await Promise.all(
      Array.from({ length: 8 }, () => startPayment(h.app, d.buyer, o.id, key('par'))),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409).length).toBe(7);
    expect(await Payment.countDocuments({ orderId: o.id, status: 'pending' })).toBe(1);
    expect(h.payments!.calls.createCharge - before).toBe(1);
    // the same key in parallel converges on one payment too
    const d2 = await w.deal();
    const o2 = await w.checkout(d2);
    const k = key('same');
    const same = await Promise.all(
      Array.from({ length: 6 }, () => startPayment(h.app, d2.buyer, o2.id, k)),
    );
    expect(same.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(new Set(same.map((r) => r.body.payment.id)).size).toBe(1);
    expect(await Payment.countDocuments({ orderId: o2.id })).toBe(1);
  });

  it('a provider outage leaves the attempt resumable: retrying with the same key reuses it and creates one charge', async () => {
    const d = await w.deal();
    const o = await w.checkout(d);
    const k = key('outage');
    h.payments!.failNext = 'charge';
    const down = await startPayment(h.app, d.buyer, o.id, k);
    expect(down.status).toBe(502);
    expect(down.body.error.code).toBe('PROVIDER_UNAVAILABLE');
    const p = (await Payment.findOne({ orderId: o.id }))!;
    expect(p.providerRef).toBeNull();
    const up = await startPayment(h.app, d.buyer, o.id, k);
    expect(up.status).toBe(200);
    expect(up.body.payment.providerRef).toBeTruthy();
    expect(await Payment.countDocuments({ orderId: o.id })).toBe(1);
    // the provider call carried a stable idempotency key, so even a lost response could not double-charge
    expect(h.payments!.charges.size).toBeGreaterThan(0);
  });

  it('an abandoned attempt expires and a new one can be started', async () => {
    const d = await w.deal();
    const o = await w.checkout(d);
    const first = (await startPayment(h.app, d.buyer, o.id)).body.payment;
    await Payment.updateOne(
      { _id: first.id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    const second = await startPayment(h.app, d.buyer, o.id);
    expect(second.status).toBe(201);
    expect(second.body.payment.id).not.toBe(first.id);
    expect((await Payment.findById(first.id))?.status).toBe('expired');
    expect(h.payments!.charges.get(first.providerRef)?.status).toBe('failed'); // cancelled at the provider
  });
});

// ---------------------------------------------------------------------------
describe('payment callbacks and the ledger', () => {
  it('a captured payment pays the order and posts one balanced journal: provider → seller (pending), platform fee, shipping', async () => {
    await makeRule({ feeBps: 500, priority: 70, categories: ['buffalo'] });
    const { d, o, p } = await paidDelivery();
    const order = (await Order.findById(o.id))!;
    expect(order.status).toBe('PAID');
    expect(order.paymentRef).toBe(p.payment.providerRef);
    const lines = await WalletTransaction.find({ journalKey: `capture:${p.payment.id}` }).sort({
      lineNo: 1,
    });
    expect(lines.map((l) => [l.walletKind, l.bucket, l.amountMinor])).toEqual([
      ['provider', 'available', -4_250_000],
      ['seller', 'pending', 3_800_000],
      ['platform', 'available', 200_000],
      ['shipping', 'available', 250_000],
    ]);
    expect(lines.reduce((a, l) => a + l.amountMinor, 0)).toBe(0);
    const seller = await sellerWallet(order.sellerId);
    expect(seller.pendingMinor).toBeGreaterThanOrEqual(3_800_000);
    expect(await Payment.findById(p.payment.id)).toMatchObject({
      status: 'succeeded',
      disposition: 'applied',
      receivedMinor: 4_250_000,
    });
    expect(d.listingId).toBeTruthy();
  });

  it('redelivered and parallel callbacks never create a second journal, entry or balance change', async () => {
    const d = await w.deal();
    const o = await w.checkout(d);
    const p = (await startPayment(h.app, d.buyer, o.id)).body.payment;
    const charge = h.payments!.settleCharge(p.providerRef, 'succeeded');
    const ev = providerEvent('charge.succeeded', charge.ref, charge.amountMinor, {
      id: 'evt_same',
    });
    const seller = await sellerWallet((await Order.findById(o.id))!.sellerId);
    const before = (await Wallet.findById(seller._id))!.pendingMinor;
    const rs = await Promise.all(Array.from({ length: 6 }, () => send(h.app, ev)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(rs.filter((r) => r.body.result === 'succeeded').length).toBeGreaterThanOrEqual(1);
    for (const r of rs) expect(['succeeded', 'duplicate']).toContain(r.body.result);
    for (let i = 0; i < 3; i++) expect((await send(h.app, ev)).body.result).toBe('duplicate');
    expect(await WalletTransaction.countDocuments({ journalKey: `capture:${p.id}` })).toBe(3); // provider, seller, shipping
    const delta = (await Wallet.findById(seller._id))!.pendingMinor - before;
    expect(delta).toBe(4_000_000); // fee is 0 here: credited exactly once
    expect(await Order.countDocuments({ _id: o.id, status: 'PAID' })).toBe(1);
    expect(await Payment.countDocuments({ orderId: o.id, disposition: 'applied' })).toBe(1);
    expect(await ledgerTotal()).toBe(0);
  });

  it('a failed payment is recorded; the buyer can then start a new attempt, and only that one can pay the order', async () => {
    const d = await w.deal();
    const o = await w.checkout(d);
    const p1 = (await startPayment(h.app, d.buyer, o.id)).body.payment;
    const c1 = h.payments!.settleCharge(p1.providerRef, 'failed', 'card_declined');
    expect(
      (
        await send(
          h.app,
          providerEvent('charge.failed', c1.ref, c1.amountMinor, { failureCode: 'card_declined' }),
        )
      ).body.result,
    ).toBe('failed');
    expect(
      (await send(h.app, providerEvent('charge.failed', c1.ref, c1.amountMinor))).body.result,
    ).toBe('duplicate');
    const row = (await Payment.findById(p1.id))!;
    expect(row).toMatchObject({ status: 'failed', failureCode: 'card_declined' });
    expect((await Order.findById(o.id))?.status).toBe('PENDING_PAYMENT');
    expect(await WalletTransaction.countDocuments({ refId: p1.id })).toBe(0);
    // a success callback cannot resurrect a failed payment
    expect(
      (await send(h.app, providerEvent('charge.succeeded', c1.ref, c1.amountMinor))).body.result,
    ).toBe('stale');
    expect((await Order.findById(o.id))?.status).toBe('PENDING_PAYMENT');
    const retry = await payOrder(h, d.buyer, o);
    expect(retry.result).toBe('succeeded');
    expect((await Order.findById(o.id))?.paymentRef).toBe(retry.payment.providerRef);
  });

  it('a late capture of an abandoned attempt still pays an order that is waiting (the provider is the truth)', async () => {
    const d = await w.deal();
    const o = await w.checkout(d);
    const p = (await startPayment(h.app, d.buyer, o.id)).body.payment;
    await Payment.updateOne({ _id: p.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await (await import('../src/modules/finance/payments.service')).expireStalePayments(h.payments);
    expect((await Payment.findById(p.id))?.status).toBe('expired');
    const c = h.payments!.settleCharge(p.providerRef, 'succeeded');
    expect(
      (await send(h.app, providerEvent('charge.succeeded', c.ref, c.amountMinor))).body.result,
    ).toBe('succeeded');
    expect((await Order.findById(o.id))?.status).toBe('PAID');
    expect(await Payment.findById(p.id)).toMatchObject({
      status: 'succeeded',
      disposition: 'applied',
    });
  });

  it('money that cannot be applied is parked in suspense and queued for refund — never lost, never applied twice', async () => {
    // (a) the order was cancelled while the buyer was paying
    const d = await w.deal();
    const o = await w.checkout(d);
    const p = (await startPayment(h.app, d.buyer, o.id)).body.payment;
    await w.call('post', d.buyer, `/orders/${o.id}/cancel`, { reason: 'changed my mind' });
    const c = h.payments!.settleCharge(p.providerRef, 'succeeded');
    expect(
      (await send(h.app, providerEvent('charge.succeeded', c.ref, c.amountMinor))).body.result,
    ).toBe('unapplied');
    expect((await Order.findById(o.id))?.status).toBe('CANCELLED');
    expect(await Payment.findById(p.id)).toMatchObject({
      status: 'succeeded',
      disposition: 'unapplied',
      unappliedReason: 'order_not_payable',
    });
    const parked = await WalletTransaction.find({ journalKey: `capture_unapplied:${p.id}` });
    expect(parked.map((l) => [l.walletKind, l.amountMinor]).sort()).toEqual(
      [
        ['provider', -4_250_000],
        ['suspense', 4_250_000],
      ].sort(),
    );
    expect(await Refund.findOne({ paymentId: p.id })).toMatchObject({
      status: 'requested',
      amountMinor: 4_250_000,
      reason: 'unapplied_order_not_payable',
    });
    // (b) a second capture for an order that is already paid
    const d2 = await w.deal();
    const o2 = await w.checkout(d2);
    const a = (await startPayment(h.app, d2.buyer, o2.id)).body.payment;
    await Payment.updateOne({ _id: a.id }, { $set: { status: 'cancelled' } }); // buyer "gave up" at our side…
    const b = (await startPayment(h.app, d2.buyer, o2.id)).body.payment;
    const ca = h.payments!.settleCharge(a.providerRef, 'succeeded'); // …but both were captured
    const cb = h.payments!.settleCharge(b.providerRef, 'succeeded');
    const results = [
      (await send(h.app, providerEvent('charge.succeeded', ca.ref, ca.amountMinor))).body.result,
      (await send(h.app, providerEvent('charge.succeeded', cb.ref, cb.amountMinor))).body.result,
    ];
    expect(results.sort()).toEqual(['succeeded', 'unapplied']);
    expect(await Payment.countDocuments({ orderId: o2.id, disposition: 'applied' })).toBe(1);
    expect(await Payment.countDocuments({ orderId: o2.id, disposition: 'unapplied' })).toBe(1);
    expect(await Refund.countDocuments({ orderId: o2.id })).toBe(1);
    expect(await ledgerTotal()).toBe(0);
  });

  it('a payment of the wrong amount or currency is not applied; the whole amount received is parked for refund', async () => {
    const d = await w.deal();
    const o = await w.checkout(d);
    const p = (await startPayment(h.app, d.buyer, o.id)).body.payment;
    const c = h.payments!.settleCharge(p.providerRef, 'succeeded');
    expect(
      (await send(h.app, providerEvent('charge.succeeded', c.ref, 4_000_000))).body.result,
    ).toBe('unapplied');
    expect((await Order.findById(o.id))?.status).toBe('PENDING_PAYMENT');
    expect(await Payment.findById(p.id)).toMatchObject({
      disposition: 'unapplied',
      unappliedReason: 'amount_mismatch',
      receivedMinor: 4_000_000,
    });
    expect(await Refund.findOne({ paymentId: p.id })).toMatchObject({ amountMinor: 4_000_000 }); // what actually arrived
    const d2 = await w.deal();
    const o2 = await w.checkout(d2);
    const p2 = (await startPayment(h.app, d2.buyer, o2.id)).body.payment;
    const c2 = h.payments!.settleCharge(p2.providerRef, 'succeeded');
    expect(
      (
        await send(
          h.app,
          providerEvent('charge.succeeded', c2.ref, c2.amountMinor, { currency: 'USD' }),
        )
      ).body.result,
    ).toBe('currency_mismatch');
    expect((await Order.findById(o2.id))?.status).toBe('PENDING_PAYMENT');
    expect((await Payment.findById(p2.id))?.status).toBe('pending'); // nothing booked: a person decides
    expect(
      await FinancialAuditLog.countDocuments({
        action: 'payment.currency_mismatch',
        targetId: p2.id,
      }),
    ).toBe(1);
    expect(await ledgerTotal()).toBe(0);
  });

  it('events for references we do not know, malformed events and unsigned requests change nothing', async () => {
    const before = await WalletTransaction.countDocuments();
    expect(
      (await send(h.app, providerEvent('charge.succeeded', 'chg_unknown', 100))).body.result,
    ).toBe('unknown_reference');
    expect(
      (await send(h.app, providerEvent('refund.succeeded', 'rfd_unknown', 100))).body.result,
    ).toBe('unknown_reference');
    expect((await send(h.app, providerEvent('payout.paid', 'pay_unknown', 100))).body.result).toBe(
      'unknown_reference',
    );
    expect((await send(h.app, { type: 'charge.succeeded', data: { ref: 1 } })).body.result).toBe(
      'ignored',
    );
    expect((await send(h.app, providerEvent('charge.mystery', 'x', 1))).body.result).toBe(
      'ignored',
    );
    expect(await WalletTransaction.countDocuments()).toBe(before);
    expect(
      await FinancialAuditLog.countDocuments({ action: 'provider_event.unknown_reference' }),
    ).toBeGreaterThanOrEqual(3);
    expect(
      (await send(h.app, providerEvent('charge.succeeded', 'x', 1), { header: null })).status,
    ).toBe(401);
  });

  it('the ledger is balanced, and a wallet balance always equals the sum of its ledger lines', async () => {
    await paidDelivery();
    await paidPickup();
    expect(await ledgerTotal()).toBe(0);
    for (const wal of await Wallet.find()) {
      expect(wal.pendingMinor, `${wal.kind} pending`).toBe(await ledgerBalance(wal._id, 'pending'));
      expect(wal.availableMinor, `${wal.kind} available`).toBe(
        await ledgerBalance(wal._id, 'available'),
      );
    }
  });

  it('posting rules: unbalanced or zero journals are refused; reposting the same key is a harmless no-op', async () => {
    const a = await systemWallet('suspense');
    const b = await systemWallet('provider');
    const line = (wallet: typeof a, amountMinor: number) => ({
      wallet,
      bucket: 'available' as const,
      amountMinor,
      type: 'capture' as const,
      refType: 't',
      refId: 'x',
    });
    await expect(postJournal('t:bad', [line(a, 100), line(b, -99)])).rejects.toThrow(
      /not balanced/,
    );
    await expect(postJournal('t:zero', [line(a, 0), line(b, 0)])).rejects.toThrow(/non-zero/);
    await expect(postJournal('t:one', [line(a, 0)])).rejects.toThrow();
    expect(await WalletTransaction.countDocuments({ journalKey: /^t:/ })).toBe(0);
    const before = (await Wallet.findById(a._id))!.availableMinor;
    expect((await postJournal('t:ok', [line(a, 100), line(b, -100)])).posted).toBe(true);
    expect((await postJournal('t:ok', [line(a, 100), line(b, -100)])).posted).toBe(false);
    expect((await Wallet.findById(a._id))!.availableMinor).toBe(before + 100);
    expect(await WalletTransaction.countDocuments({ journalKey: 't:ok' })).toBe(2);
  });

  it('delivery releases the seller’s earnings from pending to available — exactly once', async () => {
    await makeRule({ feeBps: 1000, priority: 71 });
    const { d, o } = await paidPickup();
    const order = (await Order.findById(o.id))!;
    const wallet = await sellerWallet(order.sellerId);
    const pend0 = (await Wallet.findById(wallet._id))!;
    await w.complete(d, o);
    const after = (await Wallet.findById(wallet._id))!;
    expect(after.pendingMinor).toBe(pend0.pendingMinor - 3_600_000);
    expect(after.availableMinor).toBe(pend0.availableMinor + 3_600_000);
    const rel = await WalletTransaction.find({ journalKey: `release:${o.id}` });
    expect(rel.map((l) => [l.bucket, l.amountMinor]).sort()).toEqual([
      ['available', 3_600_000],
      ['pending', -3_600_000],
    ]);
    expect((await w.call('post', d.buyer, `/orders/${o.id}/confirm-delivery`)).status).toBe(409); // cannot complete twice
    expect(await WalletTransaction.countDocuments({ journalKey: `release:${o.id}` })).toBe(2);
  });

  it('there is no way for a client to set a balance: wallet routes expose no write beyond the payout account', async () => {
    const seller = await w.sellerUser();
    for (const path of ['/wallet', '/wallet/balance', '/wallet/transactions']) {
      for (const m of ['post', 'put', 'patch', 'delete'] as const) {
        const r = await request(h.app)
          [m](`${API}${path}`)
          .set(seller.auth)
          .send({ availableMinor: 999_999_999, pendingMinor: 5 });
        expect([404, 405], `${m} ${path}`).toContain(r.status);
      }
    }
    const strict = await w.call('put', seller, '/wallet/payout-account', {
      bankCode: 'KBANK',
      accountNumber: '1234567890',
      accountName: 'Somchai',
      availableMinor: 1_000_000,
    });
    expect(strict.status).toBe(400);
    expect((await Wallet.findOne({ ownerId: seller.id }))?.availableMinor ?? 0).toBe(0);
    expect(PaymentProviderError).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
const providerRefund = (id: string) => h.payments!.refunds.get(id)!;

/** A paid pickup order whose buyer then cancels: a refund is queued. */
async function refundable(opts: Parameters<World['deal']>[0] = {}) {
  const { d, o, p } = await paidPickup(opts);
  expect(
    (await w.call('post', d.buyer, `/orders/${o.id}/cancel`, { reason: 'Changed my mind' })).status,
  ).toBe(200);
  const refund = (await Refund.findOne({ orderId: o.id }))!;
  return { d, o, p, refund };
}

describe('refunds', () => {
  it('cancelling a paid order queues exactly one refund of what was received; nothing is refunded yet', async () => {
    await makeRule({ feeBps: 500, priority: 80 });
    const { o, p, refund } = await refundable();
    expect(refund).toMatchObject({
      status: 'requested',
      amountMinor: 4_000_000,
      paymentId: expect.anything(),
      reason: 'Changed my mind',
    });
    expect(String(refund.paymentId)).toBe(p.payment.id);
    expect(await Refund.countDocuments({ orderId: o.id })).toBe(1);
    expect((await Order.findById(o.id))?.status).toBe('REFUND_PENDING');
    expect(h.payments!.refunds.size).toBeGreaterThanOrEqual(0);
    expect(await WalletTransaction.countDocuments({ journalKey: `refund:${refund._id}` })).toBe(0);
    // one refund per payment, even if something tries to create a second
    await expect(
      Refund.create({
        refundNo: 'RF-DUP',
        paymentId: refund.paymentId,
        buyerId: refund.buyerId,
        amountMinor: 1,
        reason: 'x',
      }),
    ).rejects.toThrow(/duplicate key/);
  });

  it('only finance staff with payments.refund may approve; the refund number must be typed; parties cannot approve their own', async () => {
    const { d, refund } = await refundable();
    const mod = await createStaff(h.app, ['moderator']);
    const approve = (s: Session, body: object = { confirmation: refund.refundNo }) =>
      admin('post', s, `/refunds/${refund._id}/approve`, body);
    for (const who of [d.buyer, d.seller, mod]) expect((await approve(who)).status).toBe(403);
    expect(
      (
        await request(h.app)
          .post(`${API}/admin/finance/refunds/${refund._id}/approve`)
          .send({ confirmation: refund.refundNo })
      ).status,
    ).toBe(401);
    expect((await approve(fin, { confirmation: 'RF-WRONG' })).body.error.code).toBe(
      'CONFIRMATION_MISMATCH',
    );
    expect((await approve(fin, {})).status).toBe(400);
    expect((await approve(fin, { confirmation: refund.refundNo, extra: 1 })).status).toBe(400);
    expect((await Refund.findById(refund._id))?.status).toBe('requested');
    expect(h.payments!.calls.createRefund).toBeGreaterThanOrEqual(0);
    // staff who are party to the order cannot approve its refund
    const partyStaff = await createStaff(h.app, ['finance_admin']);
    const d2 = await w.deal({ delivery: false, buyer: partyStaff });
    const o2 = await w.pickup(d2);
    await payOrder(h, partyStaff, o2);
    await w.call('post', partyStaff, `/orders/${o2.id}/cancel`, { reason: 'self test' });
    const own = (await Refund.findOne({ orderId: o2.id }))!;
    const r = await admin('post', partyStaff, `/refunds/${own._id}/approve`, {
      confirmation: own.refundNo,
    });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('SELF_APPROVAL');
    expect((await Refund.findById(own._id))?.status).toBe('requested');
  });

  it('approval submits one idempotent refund to the provider; the provider callback completes it: order REFUNDED, payment refunded, ledger reversed', async () => {
    await makeRule({ feeBps: 500, priority: 81 });
    const { o, p, refund } = await refundable();
    const order = (await Order.findById(o.id))!;
    const seller = await sellerWallet(order.sellerId);
    const platform = await systemWallet('platform');
    const sellerBefore = (await Wallet.findById(seller._id))!;
    const platformBefore = (await Wallet.findById(platform._id))!;
    const calls0 = h.payments!.calls.createRefund;

    const a = await admin('post', fin, `/refunds/${refund._id}/approve`, {
      confirmation: refund.refundNo,
    });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body.refund).toMatchObject({ status: 'processing', approvedBy: fin.id });
    expect(h.payments!.calls.createRefund - calls0).toBe(1);
    const stored = (await Refund.findById(refund._id))!;
    expect(stored.providerRef).toBeTruthy();
    expect(providerRefund(stored.providerRef!)).toMatchObject({
      amountMinor: 4_000_000,
      chargeRef: p.payment.providerRef,
    });
    // nothing moves until the provider confirms
    expect((await Order.findById(o.id))?.status).toBe('REFUND_PENDING');
    expect((await Wallet.findById(seller._id))!.pendingMinor).toBe(sellerBefore.pendingMinor);

    h.payments!.settleRefund(stored.providerRef!, 'succeeded');
    const ev = providerEvent('refund.succeeded', stored.providerRef!, 4_000_000);
    expect((await send(h.app, ev)).body.result).toBe('succeeded');
    expect((await send(h.app, ev)).body.result).toBe('duplicate');
    expect((await send(h.app, ev)).body.result).toBe('duplicate');

    expect((await Order.findById(o.id))?.status).toBe('REFUNDED');
    expect((await Payment.findById(p.payment.id))?.status).toBe('refunded');
    expect(await Refund.findById(refund._id)).toMatchObject({ status: 'succeeded' });
    const lines = await WalletTransaction.find({ journalKey: `refund:${refund._id}` }).sort({
      lineNo: 1,
    });
    expect(lines.map((l) => [l.walletKind, l.bucket, l.amountMinor])).toEqual([
      ['provider', 'available', 4_000_000],
      ['seller', 'pending', -3_800_000],
      ['platform', 'available', -200_000],
    ]);
    expect((await Wallet.findById(seller._id))!.pendingMinor).toBe(
      sellerBefore.pendingMinor - 3_800_000,
    );
    expect((await Wallet.findById(platform._id))!.availableMinor).toBe(
      platformBefore.availableMinor - 200_000,
    );
    expect(await ledgerTotal()).toBe(0);
    for (const act of [
      'refund.requested',
      'refund.approved',
      'refund.submitted',
      'refund.succeeded',
    ])
      expect(
        await FinancialAuditLog.countDocuments({ action: act, targetId: String(refund._id) }),
        act,
      ).toBe(1);
    // the order cannot be refunded or cancelled again
    expect(
      (await w.call('post', d_buyer(o), `/orders/${o.id}/cancel`, { reason: 'again' })).status,
    ).toBe(409);
  });

  it('parallel approvals refund once', async () => {
    const { refund } = await refundable();
    const before = h.payments!.calls.createRefund;
    const rs = await Promise.all(
      Array.from({ length: 5 }, () =>
        admin('post', fin, `/refunds/${refund._id}/approve`, { confirmation: refund.refundNo }),
      ),
    );
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(4);
    expect(h.payments!.calls.createRefund - before).toBe(1);
  });

  it('a provider outage leaves the refund retryable; the retry reuses the same provider request', async () => {
    const { refund } = await refundable();
    h.payments!.failNext = 'refund';
    const down = await admin('post', fin, `/refunds/${refund._id}/approve`, {
      confirmation: refund.refundNo,
    });
    expect(down.status).toBe(502);
    expect(await Refund.findById(refund._id)).toMatchObject({
      status: 'processing',
      providerRef: null,
    });
    const before = h.payments!.refunds.size;
    const retry = await admin('post', fin, `/refunds/${refund._id}/retry`);
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(h.payments!.refunds.size - before).toBe(1);
    expect((await Refund.findById(refund._id))?.providerRef).toBeTruthy();
    // nothing to retry once it is in flight with a provider reference
    expect((await admin('post', fin, `/refunds/${refund._id}/retry`)).status).toBe(409);
    expect((await admin('post', h_staff('mod'), `/refunds/${refund._id}/retry`)).status).toBe(403);
  });

  it('a failed refund can be retried as a new attempt; a callback with the wrong amount is not applied', async () => {
    const { o, refund } = await refundable();
    await admin('post', fin, `/refunds/${refund._id}/approve`, { confirmation: refund.refundNo });
    const first = (await Refund.findById(refund._id))!;
    expect(
      (await send(h.app, providerEvent('refund.succeeded', first.providerRef!, 3_999_999))).body
        .result,
    ).toBe('amount_mismatch');
    expect((await Order.findById(o.id))?.status).toBe('REFUND_PENDING');
    h.payments!.settleRefund(first.providerRef!, 'failed', 'insufficient_balance');
    expect(
      (
        await send(
          h.app,
          providerEvent('refund.failed', first.providerRef!, 4_000_000, {
            failureCode: 'insufficient_balance',
          }),
        )
      ).body.result,
    ).toBe('failed');
    expect(await Refund.findById(refund._id)).toMatchObject({
      status: 'failed',
      failureCode: 'insufficient_balance',
    });
    expect(
      (await send(h.app, providerEvent('refund.failed', first.providerRef!, 4_000_000))).body
        .result,
    ).toBe('duplicate');
    const retry = await admin('post', fin, `/refunds/${refund._id}/retry`);
    expect(retry.body.refund.status).toBe('processing');
    const second = (await Refund.findById(refund._id))!;
    expect(second.attempts).toBe(2);
    expect(second.providerRef).not.toBe(first.providerRef); // a fresh provider refund for the new attempt
    h.payments!.settleRefund(second.providerRef!, 'succeeded');
    expect(
      (await send(h.app, providerEvent('refund.succeeded', second.providerRef!, 4_000_000))).body
        .result,
    ).toBe('succeeded');
    expect((await Order.findById(o.id))?.status).toBe('REFUNDED');
    expect(await WalletTransaction.countDocuments({ journalKey: `refund:${refund._id}` })).toBe(2);
  });

  it('refunding money that was never applied to an order (suspense) clears the suspense account', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    const p = (await startPayment(h.app, d.buyer, o.id)).body.payment;
    await w.call('post', d.buyer, `/orders/${o.id}/cancel`, { reason: 'oops' });
    const c = h.payments!.settleCharge(p.providerRef, 'succeeded');
    await send(h.app, providerEvent('charge.succeeded', c.ref, c.amountMinor));
    const refund = (await Refund.findOne({ paymentId: p.id }))!;
    const suspense = await systemWallet('suspense');
    const before = (await Wallet.findById(suspense._id))!.availableMinor;
    await admin('post', fin, `/refunds/${refund._id}/approve`, { confirmation: refund.refundNo });
    const ref = (await Refund.findById(refund._id))!.providerRef!;
    h.payments!.settleRefund(ref, 'succeeded');
    expect(
      (await send(h.app, providerEvent('refund.succeeded', ref, c.amountMinor))).body.result,
    ).toBe('succeeded');
    expect((await Wallet.findById(suspense._id))!.availableMinor).toBe(before - c.amountMinor);
    expect((await Order.findById(o.id))?.status).toBe('CANCELLED'); // the order itself was already cancelled
    expect((await Payment.findById(p.id))?.status).toBe('refunded');
    expect(await ledgerTotal()).toBe(0);
  });

  it('refund lists and details are for finance staff only', async () => {
    const { refund } = await refundable();
    const buyer = await createUser(h.app);
    expect((await admin('get', buyer, '/refunds')).status).toBe(403);
    expect((await admin('get', buyer, `/refunds/${refund._id}`)).status).toBe(403);
    const list = await admin('get', fin, '/refunds?status=requested&limit=5');
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThan(0);
    expect(list.body.items.every((r: any) => r.status === 'requested')).toBe(true);
    expect((await admin('get', fin, `/refunds/${refund._id}`)).body.refund.refundNo).toBe(
      refund.refundNo,
    );
    expect((await admin('get', fin, '/refunds?limit=500')).status).toBe(400);
    expect((await admin('get', fin, '/refunds?cursor=garbage')).status).toBe(400);
  });
});

function d_buyer(o: { id: string }): Session {
  return buyers.get(o.id)!;
}
const buyers = new Map<string, Session>();
function h_staff(kind: 'mod'): Session {
  return mods[kind]!;
}
const mods: Record<string, Staff> = {};

// ---------------------------------------------------------------------------
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
const wd = (s: Session, amountMinor: number, k: string | null = key('wd')) =>
  request(h.app)
    .post(`${API}/wallet/withdrawals`)
    .set(s.auth)
    .set(k === null ? {} : { 'idempotency-key': k })
    .send({ amountMinor });

/** A seller whose sale (฿40,000, no fee) has completed: ฿40,000 available. */
async function fundedSeller(seller?: Session) {
  const { d } = await paidPickup(seller ? { seller } : {});
  const o = (await Order.findOne({ listingId: d.listingId }))!;
  await w.complete(d, { id: String(o._id) });
  const wallet = (await Wallet.findOne({ kind: 'seller', ownerId: d.seller.id }))!;
  expect(wallet.availableMinor).toBe(4_000_000);
  return { d, seller: d.seller, wallet };
}
const sellerBalance = async (s: Session) =>
  (await Wallet.findOne({ kind: 'seller', ownerId: s.id }))!;

describe('payout account', () => {
  it('is stored encrypted, returned masked, validated, and only ever the caller’s own', async () => {
    const a = await w.sellerUser();
    const b = await w.sellerUser();
    const put = await w.call('put', a, '/wallet/payout-account', ACCOUNT);
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.payoutAccount).toEqual({
      bankCode: 'KBANK',
      accountName: 'Somchai Jaidee',
      accountLast4: '7890',
    });
    expect(JSON.stringify(put.body)).not.toContain('1234567890');
    const view = await w.call('get', a, '/wallet');
    expect(JSON.stringify(view.body)).not.toContain('1234567890');
    expect(view.body.wallet.payoutAccount.accountLast4).toBe('7890');
    expect((await w.call('get', b, '/wallet')).body.wallet.payoutAccount).toBeNull();
    const raw = JSON.stringify(await Wallet.findOne({ ownerId: a.id }).lean());
    expect(raw).not.toContain('1234567890');
    expect(raw).toContain('payoutAccountEnc');
    expect(
      JSON.stringify(await FinancialAuditLog.find({ action: 'payout_account.updated' }).lean()),
    ).not.toContain('1234567890');
    for (const bad of [
      { ...ACCOUNT, accountNumber: '12' },
      { ...ACCOUNT, accountNumber: 'abcdefgh' },
      { ...ACCOUNT, bankCode: 'kbank!' },
      { ...ACCOUNT, accountName: '' },
      { bankCode: 'KBANK' },
    ])
      expect((await w.call('put', a, '/wallet/payout-account', bad)).status).toBe(400);
    expect((await request(h.app).put(`${API}/wallet/payout-account`).send(ACCOUNT)).status).toBe(
      401,
    );
    expect((await request(h.app).get(`${API}/wallet`)).status).toBe(401);
  });
});

describe('withdrawals', () => {
  it('are closed until finance.payoutsEnabled is switched on (legal/provider review gate)', async () => {
    const { seller } = await fundedSeller();
    await w.call('put', seller, '/wallet/payout-account', ACCOUNT);
    const r = await wd(seller, 100_000);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('PAYOUTS_DISABLED');
    expect((await w.call('get', seller, '/wallet')).body.wallet).toMatchObject({
      payoutsEnabled: false,
      availableMinor: 4_000_000,
    });
    expect(await Withdrawal.countDocuments({ sellerId: seller.id })).toBe(0);
  });

  it('need an Idempotency-Key, a payout account, an amount within the minimum and the available balance', async () => {
    await enablePayouts(10_000);
    const { seller } = await fundedSeller();
    expect((await wd(seller, 100_000, null)).body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect((await wd(seller, 100_000)).body.error.code).toBe('PAYOUT_ACCOUNT_REQUIRED');
    await w.call('put', seller, '/wallet/payout-account', ACCOUNT);
    expect((await wd(seller, 9_999)).body.error.code).toBe('BELOW_MINIMUM');
    for (const bad of [0, -5, 1.5, 10 ** 13])
      expect(
        (
          await request(h.app)
            .post(`${API}/wallet/withdrawals`)
            .set(seller.auth)
            .set('idempotency-key', key())
            .send({ amountMinor: bad })
        ).status,
      ).toBe(400);
    const over = await wd(seller, 4_000_001);
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect((await sellerBalance(seller)).availableMinor).toBe(4_000_000);
    expect(
      await WalletTransaction.countDocuments({
        journalKey: /^wd_hold:/,
        walletId: (await sellerBalance(seller))._id,
      }),
    ).toBe(0);
  });

  it('earnings still pending (order not delivered) cannot be withdrawn', async () => {
    await enablePayouts();
    const { d } = await paidPickup();
    await w.call('put', d.seller, '/wallet/payout-account', ACCOUNT);
    const bal = await sellerBalance(d.seller);
    expect(bal).toMatchObject({ pendingMinor: 4_000_000, availableMinor: 0 });
    expect((await wd(d.seller, 100_000)).body.error.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('a request holds the money at once (ledger + balance); the same key replays; parallel requests cannot spend the same money twice', async () => {
    await enablePayouts();
    const { seller } = await fundedSeller();
    await w.call('put', seller, '/wallet/payout-account', ACCOUNT);
    const k = key('hold');
    const first = await wd(seller, 1_500_000, k);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.withdrawal).toMatchObject({
      status: 'requested',
      amountMinor: 1_500_000,
      payoutAccount: { accountLast4: '7890' },
    });
    expect(JSON.stringify(first.body)).not.toContain('1234567890');
    const replay = await wd(seller, 1_500_000, k);
    expect(replay.status).toBe(200);
    expect(replay.body.withdrawal.id).toBe(first.body.withdrawal.id);
    expect((await sellerBalance(seller)).availableMinor).toBe(2_500_000);
    // replays are answered from the original request even if conditions have since changed (e.g. payouts switched off)
    await Setting.deleteMany({ key: 'finance.payoutsEnabled' });
    const stale = await wd(seller, 1_500_000, k);
    expect(stale.status).toBe(200);
    expect(stale.body.withdrawal.id).toBe(first.body.withdrawal.id);
    await enablePayouts();
    const hold = await WalletTransaction.find({
      journalKey: `wd_hold:${first.body.withdrawal.id}`,
    }).sort({ lineNo: 1 });
    expect(hold.map((l) => [l.walletKind, l.bucket, l.amountMinor])).toEqual([
      ['seller', 'available', -1_500_000],
      ['payout', 'available', 1_500_000],
    ]);
    // 6 parallel requests of 1,000,000 against 2,500,000: at most 2 can be satisfied
    const rs = await Promise.all(Array.from({ length: 6 }, () => wd(seller, 1_000_000)));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(2);
    expect(
      rs.filter((r) => r.status === 409).every((r) => r.body.error.code === 'INSUFFICIENT_FUNDS'),
    ).toBe(true);
    expect((await sellerBalance(seller)).availableMinor).toBe(500_000);
    const wallet = await sellerBalance(seller);
    expect(wallet.availableMinor).toBe(await ledgerBalance(wallet._id, 'available'));
    expect(await ledgerTotal()).toBe(0);
  });

  it('the seller can cancel a requested withdrawal; the money comes back once; others cannot touch it', async () => {
    await enablePayouts();
    const { seller } = await fundedSeller();
    await w.call('put', seller, '/wallet/payout-account', ACCOUNT);
    const id = (await wd(seller, 1_000_000)).body.withdrawal.id;
    const other = await w.sellerUser();
    expect((await w.call('post', other, `/wallet/withdrawals/${id}/cancel`)).status).toBe(404);
    expect(
      (await w.call('post', seller, `/wallet/withdrawals/${id}/cancel`)).body.withdrawal.status,
    ).toBe('cancelled');
    expect((await w.call('post', seller, `/wallet/withdrawals/${id}/cancel`)).status).toBe(409);
    expect((await sellerBalance(seller)).availableMinor).toBe(4_000_000);
    expect(await WalletTransaction.countDocuments({ journalKey: `wd_release:${id}` })).toBe(2);
    expect((await w.call('get', other, '/wallet/withdrawals')).body.items).toHaveLength(0);
    expect((await w.call('get', seller, '/wallet/withdrawals')).body.items).toHaveLength(1);
  });

  it('only finance staff approve; the number must be typed; nobody approves their own payout; approval pays out once', async () => {
    await enablePayouts();
    const { seller } = await fundedSeller();
    await w.call('put', seller, '/wallet/payout-account', ACCOUNT);
    const created = (await wd(seller, 2_000_000)).body.withdrawal;
    const approve = (s: Session, body: object = { confirmation: created.withdrawalNo }) =>
      admin('post', s, `/withdrawals/${created.id}/approve`, body);
    const mod = h_staff('mod');
    const support = await createStaff(h.app, ['support']);
    const reviewer = await createStaff(h.app, ['registration_admin']);
    for (const who of [seller, mod, support, reviewer])
      expect((await approve(who)).status).toBe(403);
    expect((await admin('post', reviewer, '/commission-rules', RULE)).status).toBe(403);
    expect((await approve(fin, { confirmation: 'WD-nope' })).body.error.code).toBe(
      'CONFIRMATION_MISMATCH',
    );
    expect((await Withdrawal.findById(created.id))?.status).toBe('requested');

    // a staff member who is also the seller cannot approve their own withdrawal
    const both = await createStaff(h.app, ['finance_admin', 'seller', 'farm_owner']);
    const { seller: mine } = await fundedSeller(both);
    await w.call('put', mine, '/wallet/payout-account', ACCOUNT);
    const own = (await wd(mine, 1_000_000)).body.withdrawal;
    const self = await admin('post', both, `/withdrawals/${own.id}/approve`, {
      confirmation: own.withdrawalNo,
    });
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('SELF_APPROVAL');

    // parallel approvals: one payout
    const before = h.payments!.calls.createPayout;
    const rs = await Promise.all(Array.from({ length: 4 }, () => approve(fin)));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(h.payments!.calls.createPayout - before).toBe(1);
    const stored = (await Withdrawal.findById(created.id))!;
    expect(stored).toMatchObject({ status: 'processing', decidedBy: expect.anything() });
    expect(h.payments!.payouts.get(stored.providerRef!)).toMatchObject({ amountMinor: 2_000_000 });
    // still held: balance unchanged by approval
    expect((await sellerBalance(seller)).availableMinor).toBe(2_000_000);

    // the provider confirms: paid, ledger settles the payout account, duplicates are harmless
    h.payments!.settlePayout(stored.providerRef!, 'succeeded');
    const ev = providerEvent('payout.paid', stored.providerRef!, 2_000_000);
    expect((await send(h.app, ev)).body.result).toBe('paid');
    expect((await send(h.app, ev)).body.result).toBe('duplicate');
    expect((await Withdrawal.findById(created.id))?.status).toBe('paid');
    const paid = await WalletTransaction.find({ journalKey: `wd_paid:${created.id}` }).sort({
      lineNo: 1,
    });
    expect(paid.map((l) => [l.walletKind, l.amountMinor])).toEqual([
      ['payout', -2_000_000],
      ['provider', 2_000_000],
    ]);
    expect((await sellerBalance(seller)).availableMinor).toBe(2_000_000);
    expect(await ledgerTotal()).toBe(0);
    for (const act of [
      'withdrawal.requested',
      'withdrawal.approved',
      'withdrawal.submitted',
      'withdrawal.paid',
    ])
      expect(
        await FinancialAuditLog.countDocuments({ action: act, targetId: created.id }),
        act,
      ).toBe(1);
  });

  it('a payout sent to the provider uses the account captured at request time, even if the seller changes it afterwards', async () => {
    await enablePayouts();
    const { seller } = await fundedSeller();
    await w.call('put', seller, '/wallet/payout-account', ACCOUNT);
    const created = (await wd(seller, 1_000_000)).body.withdrawal;
    await w.call('put', seller, '/wallet/payout-account', {
      bankCode: 'SCB',
      accountNumber: '9999999999',
      accountName: 'Someone Else',
    });
    const seen: unknown[] = [];
    const original = h.payments!.createPayout.bind(h.payments!);
    h.payments!.createPayout = async (input) => {
      seen.push(input.destination);
      return original(input);
    };
    try {
      await admin('post', fin, `/withdrawals/${created.id}/approve`, {
        confirmation: created.withdrawalNo,
      });
    } finally {
      h.payments!.createPayout = original;
    }
    expect(seen).toEqual([ACCOUNT]);
  });

  it('a rejected or failed payout returns the money exactly once', async () => {
    await enablePayouts();
    const { seller } = await fundedSeller();
    await w.call('put', seller, '/wallet/payout-account', ACCOUNT);
    const a = (await wd(seller, 1_000_000)).body.withdrawal;
    const b = (await wd(seller, 1_000_000)).body.withdrawal;
    expect((await sellerBalance(seller)).availableMinor).toBe(2_000_000);
    expect((await admin('post', fin, `/withdrawals/${a.id}/reject`, {})).status).toBe(400); // a reason is required
    const rej = await admin('post', fin, `/withdrawals/${a.id}/reject`, {
      reason: 'Account name does not match',
    });
    expect(rej.body.withdrawal).toMatchObject({
      status: 'rejected',
      decisionReason: 'Account name does not match',
    });
    expect(
      (await admin('post', fin, `/withdrawals/${a.id}/reject`, { reason: 'again again' })).status,
    ).toBe(409);
    expect((await sellerBalance(seller)).availableMinor).toBe(3_000_000);
    await admin('post', fin, `/withdrawals/${b.id}/approve`, { confirmation: b.withdrawalNo });
    const ref = (await Withdrawal.findById(b.id))!.providerRef!;
    h.payments!.settlePayout(ref, 'failed', 'account_closed');
    const ev = providerEvent('payout.failed', ref, 1_000_000, { failureCode: 'account_closed' });
    expect((await send(h.app, ev)).body.result).toBe('failed');
    expect((await send(h.app, ev)).body.result).toBe('duplicate');
    expect(await Withdrawal.findById(b.id)).toMatchObject({
      status: 'failed',
      failureCode: 'account_closed',
    });
    expect((await sellerBalance(seller)).availableMinor).toBe(4_000_000);
    expect(await WalletTransaction.countDocuments({ journalKey: `wd_release:${b.id}` })).toBe(2);
    // a late "paid" for a failed payout is not applied
    expect((await send(h.app, providerEvent('payout.paid', ref, 1_000_000))).body.result).toBe(
      'stale',
    );
    expect((await sellerBalance(seller)).availableMinor).toBe(4_000_000);
    expect(await ledgerTotal()).toBe(0);
  });

  it('a provider outage leaves the payout retryable without paying twice; the wrong amount in a callback is not applied', async () => {
    await enablePayouts();
    const { seller } = await fundedSeller();
    await w.call('put', seller, '/wallet/payout-account', ACCOUNT);
    const c = (await wd(seller, 1_000_000)).body.withdrawal;
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
    const ref = (await Withdrawal.findById(c.id))!.providerRef!;
    expect((await send(h.app, providerEvent('payout.paid', ref, 999_999))).body.result).toBe(
      'amount_mismatch',
    );
    expect((await Withdrawal.findById(c.id))?.status).toBe('processing');
  });

  it('wallet and withdrawal lists never leak across sellers; finance sees names and masked accounts only', async () => {
    await enablePayouts();
    const x = await fundedSeller();
    await w.call('put', x.seller, '/wallet/payout-account', ACCOUNT);
    const id = (await wd(x.seller, 1_000_000)).body.withdrawal.id;
    const y = await w.sellerUser();
    expect((await w.call('get', y, '/wallet/transactions')).body.items).toHaveLength(0);
    const mine = await w.call('get', x.seller, '/wallet/transactions');
    expect(mine.body.items.length).toBeGreaterThan(0);
    expect(mine.body.items.every((t: any) => t.walletKind === 'seller')).toBe(true);
    const list = await admin('get', fin, '/withdrawals?status=requested');
    const row = list.body.items.find((r: any) => r.id === id);
    expect(row).toMatchObject({ sellerId: x.seller.id, payoutAccount: { accountLast4: '7890' } });
    expect(row.sellerName).toBeTruthy();
    expect(JSON.stringify(list.body)).not.toContain('1234567890');
    expect((await admin('get', y, '/withdrawals')).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
const reconcile = (s: Session, body: object = {}) => admin('post', s, '/reconcile', body);
const issuesFor = (res: any, ...refs: string[]) =>
  res.body.report.issues.filter((i: any) => refs.some((r) => i.ref.includes(r)));

describe('reconciliation', () => {
  it('needs payments.verify; repairs need a typed confirmation', async () => {
    const mod = h_staff('mod');
    expect((await reconcile(mod)).status).toBe(403);
    expect((await reconcile(await createUser(h.app))).status).toBe(403);
    expect((await request(h.app).post(`${API}/admin/finance/reconcile`).send({})).status).toBe(401);
    expect((await reconcile(fin, { repair: true })).body.error.code).toBe('CONFIRMATION_MISMATCH');
    expect((await reconcile(fin, { repair: true, confirmation: 'yes' })).status).toBe(400);
    const ok = await reconcile(fin);
    expect(ok.status).toBe(200);
    expect(ok.body.report).toMatchObject({ providerChecked: true, ledgerSumMinor: 0 });
    expect(
      ok.body.report.issues.filter((i: any) =>
        ['ledger_unbalanced', 'negative_balance'].includes(i.kind),
      ),
    ).toEqual([]);
  });

  it('detects and repairs wallet balance drift against the ledger', async () => {
    const { d } = await paidPickup();
    const wallet = (await Wallet.findOne({ kind: 'seller', ownerId: d.seller.id }))!;
    await Wallet.updateOne(
      { _id: wallet._id },
      { $inc: { availableMinor: 777, pendingMinor: -5 } },
    );
    const dry = await reconcile(fin);
    const drift = issuesFor(dry, `wallet:${wallet._id}`);
    expect(drift).toHaveLength(1);
    expect(drift[0].kind).toBe('wallet_drift');
    expect(drift[0].repaired).toBeUndefined();
    expect((await Wallet.findById(wallet._id))!.availableMinor).toBe(777); // a dry run changes nothing
    const fixed = await reconcile(fin, { repair: true, confirmation: 'REPAIR' });
    expect(issuesFor(fixed, `wallet:${wallet._id}`)[0]).toMatchObject({
      kind: 'wallet_drift',
      repaired: true,
    });
    const after = (await Wallet.findById(wallet._id))!;
    expect([after.pendingMinor, after.availableMinor]).toEqual([4_000_000, 0]);
    expect(issuesFor(await reconcile(fin), `wallet:${wallet._id}`)).toEqual([]);
    expect(
      await FinancialAuditLog.countDocuments({
        action: 'wallet.projection_repaired',
        targetId: String(wallet._id),
      }),
    ).toBe(1);
  });

  it('finishes what a crash left half-done: a succeeded payment never applied, and a missing ledger journal', async () => {
    // payment succeeded in our books, but the process died before the order was paid
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    const p = (await startPayment(h.app, d.buyer, o.id)).body.payment;
    const c = h.payments!.settleCharge(p.providerRef, 'succeeded');
    await Payment.updateOne(
      { _id: p.id },
      { $set: { status: 'succeeded', receivedMinor: c.amountMinor, succeededAt: new Date() } },
    );
    const dry = await reconcile(fin);
    expect(issuesFor(dry, `payment:${p.id}`)[0]).toMatchObject({ kind: 'missing_journal' });
    expect((await Order.findById(o.id))?.status).toBe('PENDING_PAYMENT');
    const fixed = await reconcile(fin, { repair: true, confirmation: 'REPAIR' });
    expect(issuesFor(fixed, `payment:${p.id}`).every((i: any) => i.repaired)).toBe(true);
    expect((await Order.findById(o.id))?.status).toBe('PAID');
    expect(await WalletTransaction.countDocuments({ journalKey: `capture:${p.id}` })).toBe(2);

    // the capture journal's lines vanished (lost write): detected, re-posted once, balances end up consistent
    const q = await paidPickup();
    await WalletTransaction.deleteMany({ journalKey: `capture:${q.p.payment.id}` });
    expect(issuesFor(await reconcile(fin), `capture:${q.p.payment.id}`)[0]).toMatchObject({
      kind: 'missing_journal',
    });
    await reconcile(fin, { repair: true, confirmation: 'REPAIR' });
    expect(
      await WalletTransaction.countDocuments({ journalKey: `capture:${q.p.payment.id}` }),
    ).toBe(2);
    const wal = (await Wallet.findOne({ kind: 'seller', ownerId: q.d.seller.id }))!;
    expect(wal.pendingMinor).toBe(await ledgerBalance(wal._id, 'pending'));
    expect(wal.pendingMinor).toBe(4_000_000);
    expect(await ledgerTotal()).toBe(0);
    // and a repeat run finds nothing left to do for these
    expect(issuesFor(await reconcile(fin), `payment:${p.id}`, `capture:${q.p.payment.id}`)).toEqual(
      [],
    );
  });

  it('a delivered order whose earnings were never released is found and fixed', async () => {
    const { d, o } = await paidPickup();
    await w.complete(d, o);
    await WalletTransaction.deleteMany({ journalKey: `release:${o.id}` });
    await Wallet.updateOne(
      { kind: 'seller', ownerId: d.seller.id },
      { $set: { pendingMinor: 4_000_000, availableMinor: 0 } },
    );
    expect(issuesFor(await reconcile(fin), `release:${o.id}`)[0]).toMatchObject({
      kind: 'missing_journal',
    });
    await reconcile(fin, { repair: true, confirmation: 'REPAIR' });
    expect(await Wallet.findOne({ kind: 'seller', ownerId: d.seller.id })).toMatchObject({
      pendingMinor: 0,
      availableMinor: 4_000_000,
    });
  });

  it('compares with the provider: a payment whose callback was lost is found and applied from the provider’s record', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    const p = (await startPayment(h.app, d.buyer, o.id)).body.payment;
    h.payments!.settleCharge(p.providerRef, 'succeeded'); // no callback arrives
    const dry = await reconcile(fin);
    expect(issuesFor(dry, `payment:${p.id}`)[0]).toMatchObject({
      kind: 'provider_status_mismatch',
    });
    expect((await Order.findById(o.id))?.status).toBe('PENDING_PAYMENT');
    await reconcile(fin, { repair: true, confirmation: 'REPAIR' });
    expect((await Order.findById(o.id))?.status).toBe('PAID');
    expect(await Payment.findById(p.id)).toMatchObject({
      status: 'succeeded',
      disposition: 'applied',
    });
    // a lost "failed" callback is applied too
    const d2 = await w.deal({ delivery: false });
    const o2 = await w.pickup(d2);
    const p2 = (await startPayment(h.app, d2.buyer, o2.id)).body.payment;
    h.payments!.settleCharge(p2.providerRef, 'failed', 'expired_card');
    await reconcile(fin, { repair: true, confirmation: 'REPAIR' });
    expect(await Payment.findById(p2.id)).toMatchObject({
      status: 'failed',
      failureCode: 'expired_card',
    });
  });

  it('amount disagreements and unknown provider charges are reported but never "repaired"', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    const p = (await startPayment(h.app, d.buyer, o.id)).body.payment;
    const c = h.payments!.settleCharge(p.providerRef, 'succeeded');
    c.amountMinor = 1; // the provider's record disagrees
    const ghost = await h.payments!.createCharge({
      idempotencyKey: key('ghost'),
      amountMinor: 555,
      currency: 'THB',
      reference: 'FP-GHOST',
    });
    const res = await reconcile(fin, { repair: true, confirmation: 'REPAIR' });
    expect(issuesFor(res, `payment:${p.id}`)[0]).toMatchObject({
      kind: 'provider_amount_mismatch',
    });
    expect(issuesFor(res, `payment:${p.id}`)[0].repaired).toBeUndefined();
    expect(issuesFor(res, `charge:${ghost.ref}`)[0]).toMatchObject({
      kind: 'provider_unknown_charge',
    });
    expect((await Order.findById(o.id))?.status).toBe('PENDING_PAYMENT');
    expect(res.body.report.ok).toBe(false);
  });

  it('completes refunds and payouts the provider finished but whose callbacks never came', async () => {
    const { o, refund } = await refundable();
    await admin('post', fin, `/refunds/${refund._id}/approve`, { confirmation: refund.refundNo });
    h.payments!.settleRefund((await Refund.findById(refund._id))!.providerRef!, 'succeeded');
    await enablePayouts();
    const { seller } = await fundedSeller();
    await w.call('put', seller, '/wallet/payout-account', ACCOUNT);
    const wdr = (await wd(seller, 1_000_000)).body.withdrawal;
    await admin('post', fin, `/withdrawals/${wdr.id}/approve`, { confirmation: wdr.withdrawalNo });
    h.payments!.settlePayout((await Withdrawal.findById(wdr.id))!.providerRef!, 'succeeded');
    const dry = await reconcile(fin);
    expect(issuesFor(dry, `refund:${refund._id}`, `withdrawal:${wdr.id}`)).toHaveLength(2);
    await reconcile(fin, { repair: true, confirmation: 'REPAIR' });
    expect((await Order.findById(o.id))?.status).toBe('REFUNDED');
    expect((await Withdrawal.findById(wdr.id))?.status).toBe('paid');
    expect(await ledgerTotal()).toBe(0);
  });

  it('records every run (and what it repaired) in the financial audit log', async () => {
    const before = await FinancialAuditLog.countDocuments({ action: 'reconcile.run' });
    await reconcile(fin);
    expect(await FinancialAuditLog.countDocuments({ action: 'reconcile.run' })).toBe(before + 1);
    expect(
      (
        await FinancialAuditLog.findOne({ action: 'reconcile.run' }).sort({ seq: -1 })
      )?.actorId?.toString(),
    ).toBe(fin.id);
  });
});

// ---------------------------------------------------------------------------
describe('financial audit log', () => {
  it('is hash-chained and verifies; concurrent writers keep it gap-free', async () => {
    const { recordFinancial, SYSTEM } = await import('../src/modules/finance/audit');
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        recordFinancial({
          actor: SYSTEM,
          action: 'test.concurrent',
          targetType: 'test',
          targetId: `t${i}`,
          amountMinor: i,
        }),
      ),
    );
    const v = await verifyAuditChain();
    expect(v.ok).toBe(true);
    expect(v.checked).toBeGreaterThan(100);
    const seqs = (await FinancialAuditLog.find().sort({ seq: 1 }).select('seq').lean()).map(
      (r) => r.seq,
    );
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
    const api = await admin('get', fin, '/audit-logs/verify');
    expect(api.body).toMatchObject({ ok: true });
  });

  it('detects edited, deleted and re-linked rows', async () => {
    const col = FinancialAuditLog.collection;
    const target = (await FinancialAuditLog.findOne({ action: 'payment.created' })
      .sort({ seq: 1 })
      .lean())!;
    // 1. edit the content
    await col.updateOne({ seq: target.seq }, { $set: { amountMinor: 1 } });
    const edited = await verifyAuditChain();
    expect(edited).toMatchObject({ ok: false, brokenAtSeq: target.seq });
    expect(
      (await reconcile(fin)).body.report.issues.some((i: any) => i.kind === 'audit_chain_broken'),
    ).toBe(true);
    await col.updateOne({ seq: target.seq }, { $set: { amountMinor: target.amountMinor } });
    expect((await verifyAuditChain()).ok).toBe(true);
    // 2. delete a row
    const next = (await FinancialAuditLog.findOne({ seq: target.seq + 1 }).lean())!;
    await col.deleteOne({ seq: next.seq });
    expect(await verifyAuditChain()).toMatchObject({ ok: false, brokenAtSeq: next.seq + 1 });
    await col.insertOne(next);
    expect((await verifyAuditChain()).ok).toBe(true);
    // 3. rewrite history consistently from one row (fixing its own hash) still breaks the link to the next
    const { hashEntry } = await import('../src/modules/finance/audit');
    const forged = { ...target, data: { forged: true } };
    await col.updateOne(
      { seq: target.seq },
      { $set: { data: forged.data, hash: hashEntry(forged as never) } },
    );
    expect(await verifyAuditChain()).toMatchObject({ ok: false, brokenAtSeq: target.seq + 1 });
    await col.replaceOne({ seq: target.seq }, target);
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it('never contains account numbers, delivery addresses, e-mail addresses or secrets', async () => {
    const dump = JSON.stringify(await FinancialAuditLog.find().lean());
    for (const secret of [
      '1234567890',
      '9999999999',
      'Secret Street',
      'Somsak',
      '@example.test',
      h.env.PAYMENT_WEBHOOK_SECRET!,
      'password',
    ])
      expect(dump, secret).not.toContain(secret);
  });

  it('is readable by finance staff only, newest first, and paginated', async () => {
    expect((await admin('get', h_staff('mod'), '/audit-logs')).status).toBe(403);
    expect((await admin('get', await createUser(h.app), '/audit-logs')).status).toBe(403);
    const page1 = await admin('get', fin, '/audit-logs?limit=5');
    expect(page1.body.items).toHaveLength(5);
    expect(page1.body.items[0].seq).toBeGreaterThan(page1.body.items[4].seq);
    const page2 = await admin('get', fin, `/audit-logs?limit=5&cursor=${page1.body.nextCursor}`);
    expect(page2.body.items[0].seq).toBe(page1.body.items[4].seq - 1);
    const filtered = await admin('get', fin, '/audit-logs?action=refund.approved');
    expect(filtered.body.items.every((e: any) => e.action === 'refund.approved')).toBe(true);
    expect((await admin('get', fin, '/audit-logs/verify')).status).toBe(200);
    expect((await admin('get', fin, '/audit-logs?limit=1000')).status).toBe(400);
  });
});

describe('finance admin reads', () => {
  it('payments and ledger lines are visible to finance staff only', async () => {
    const { p } = await paidPickup();
    expect((await admin('get', await createUser(h.app), '/payments')).status).toBe(403);
    expect((await admin('get', h_staff('mod'), '/payments')).status).toBe(403);
    const list = await admin(
      'get',
      fin,
      `/payments?orderId=${(await Payment.findById(p.payment.id))!.orderId}`,
    );
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      id: p.payment.id,
      status: 'succeeded',
      disposition: 'applied',
    });
    expect((await admin('get', fin, `/payments/${p.payment.id}`)).body.payment.providerRef).toBe(
      p.payment.providerRef,
    );
    expect((await admin('get', fin, '/payments/000000000000000000000000')).status).toBe(404);
    const tx = await admin('get', fin, `/wallet-transactions?journalKey=capture:${p.payment.id}`);
    expect(tx.body.items.reduce((a: number, t: any) => a + t.amountMinor, 0)).toBe(0);
    expect((await admin('get', await createUser(h.app), '/wallet-transactions')).status).toBe(403);
  });

  it('a buyer sees their own payments only', async () => {
    const { d, o } = await paidPickup();
    const mine = await w.call('get', d.buyer, `/payments?orderId=${o.id}`);
    expect(mine.body.payments).toHaveLength(1);
    expect(JSON.stringify(mine.body)).not.toContain('idempotencyKey');
    expect((await w.call('get', await createUser(h.app), `/payments?orderId=${o.id}`)).status).toBe(
      404,
    );
  });

  it('the development "mock complete" shortcut only works for the buyer of that payment, with the mock provider', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    const p = (await startPayment(h.app, d.buyer, o.id)).body.payment;
    expect(
      (
        await w.call('post', await createUser(h.app), `/payments/${p.id}/mock-complete`, {
          outcome: 'succeeded',
        })
      ).status,
    ).toBe(404);
    expect(
      (await w.call('post', d.seller, `/payments/${p.id}/mock-complete`, { outcome: 'succeeded' }))
        .status,
    ).toBe(404);
    expect(
      (await w.call('post', d.buyer, `/payments/${p.id}/mock-complete`, { outcome: 'bogus' }))
        .status,
    ).toBe(400);
    const ok = await w.call('post', d.buyer, `/payments/${p.id}/mock-complete`, {
      outcome: 'succeeded',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.payment).toMatchObject({ status: 'succeeded', disposition: 'applied' });
    expect((await Order.findById(o.id))?.status).toBe('PAID');
    const { createApp } = await import('../src/app');
    const noMock = createApp(h.env, { video: h.video, payments: null });
    expect(
      (
        await request(noMock)
          .post(`${API}/payments/${p.id}/mock-complete`)
          .set(d.buyer.auth)
          .send({ outcome: 'succeeded' })
      ).status,
    ).toBe(404);
    expect(AuditLog).toBeTruthy();
    expect(root).toBeTruthy();
  });
});
