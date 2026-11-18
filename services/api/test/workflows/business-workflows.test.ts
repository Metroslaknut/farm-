/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AiAssessment,
  FinancialAuditLog,
  Listing,
  Order,
  Payment,
  Product,
  ProductCategory,
  Refund,
  Setting,
  Wallet,
  WalletTransaction,
  Withdrawal,
} from '../../src/models';
import { validateNarrative } from '../../src/modules/ai/narrative';
import { SETTING_REGISTRY } from '../../src/modules/settings/settings.service';
import { createWorld, type World } from '../commerce-fixtures';
import { key, payOrder, providerEvent, send, startPayment } from '../finance-helpers';
import {
  PASSWORD,
  createStaff,
  mkAnimal,
  setupFarm,
  startHarness,
  type Session,
  type Staff,
  type TestHarness,
} from '../helpers';
import { shipWebhook } from '../orders-helpers';
import { createShopWorld, type ShopWorld } from '../shop-fixtures';

/**
 * End-to-end business workflow audit: scenarios that the existing suites did not cover, tagged with the scenario ID
 * used in docs/qa/business-workflow-audit.md. API → service → database, with synthetic data and mock providers only.
 */
let h: TestHarness;
let w: World;
let shop: ShopWorld;
let fin: Staff;
beforeAll(async () => {
  h = await startHarness();
  w = await createWorld(h);
  shop = await createShopWorld(h);
  fin = await createStaff(h.app, ['finance_admin']);
});
afterAll(() => h.stop());

const API = '/api/v1';
const finance = (m: 'get' | 'post', s: Session, path: string, body?: object) =>
  request(h.app)[m](`${API}/admin/finance${path}`).set(s.auth).send(body);

// ---------------------------------------------------------------------------
describe('A. registration', () => {
  it('WF-A02 an invalid e-mail address is refused with a validation error', async () => {
    const res = await request(h.app)
      .post(`${API}/auth/register`)
      .send({ email: 'not-an-email', password: PASSWORD, displayName: 'Test User' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('WF-A03 a phone number can hold only one account, also under parallel sign-ups', async () => {
    const phone = '+66811112222';
    const body = { phone, password: PASSWORD, displayName: 'Phone User' };
    const rs = await Promise.all(
      Array.from({ length: 5 }, () => request(h.app).post(`${API}/auth/register`).send(body)),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of rs.filter((x) => x.status !== 201)) {
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('ACCOUNT_EXISTS');
    }
  });
});

// ---------------------------------------------------------------------------
describe('F. payment callbacks in the wrong currency', () => {
  it('WF-F05 a capture in a foreign currency is not booked, and reconciliation reports the stranded charge', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    const p = (await startPayment(h.app, d.buyer, o.id)).body.payment;
    const c = h.payments!.settleCharge(p.providerRef, 'succeeded');
    const res = await send(
      h.app,
      providerEvent('charge.succeeded', c.ref, c.amountMinor, { currency: 'USD' }),
    );
    expect(res.body.result).toBe('currency_mismatch');
    expect((await Order.findById(o.id))?.status).toBe('PENDING_PAYMENT');
    expect(await WalletTransaction.countDocuments({ journalKey: { $regex: p.id } })).toBe(0);
    const report = (await finance('post', fin, '/reconcile', {})).body.report;
    expect(
      report.issues.some(
        (i: any) => i.ref === `payment:${p.id}` && i.kind === 'provider_status_mismatch',
      ),
    ).toBe(true);
  });

  it('WF-F05R a refund confirmation in a foreign currency does not complete a THB refund', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    expect((await payOrder(h, d.buyer, o)).result).toBe('succeeded');
    await w.call('post', d.buyer, `/orders/${o.id}/cancel`, { reason: 'Changed my mind' });
    const refund = (await Refund.findOne({ orderId: o.id }))!;
    expect(
      (
        await finance('post', fin, `/refunds/${refund._id}/approve`, {
          confirmation: refund.refundNo,
        })
      ).status,
    ).toBe(200);
    const stored = (await Refund.findById(refund._id))!;
    h.payments!.settleRefund(stored.providerRef!, 'succeeded');
    const usd = await send(
      h.app,
      providerEvent('refund.succeeded', stored.providerRef!, stored.amountMinor, {
        currency: 'USD',
      }),
    );
    expect(usd.body.result).toBe('currency_mismatch');
    expect((await Refund.findById(refund._id))?.status).toBe('processing');
    expect((await Order.findById(o.id))?.status).toBe('REFUND_PENDING');
    expect(
      await FinancialAuditLog.countDocuments({
        action: 'refund.currency_mismatch',
        targetId: String(refund._id),
      }),
    ).toBe(1);
    // the real confirmation still completes it
    expect(
      (
        await send(
          h.app,
          providerEvent('refund.succeeded', stored.providerRef!, stored.amountMinor),
        )
      ).body.result,
    ).toBe('succeeded');
  });

  it('WF-F08R a payout confirmation in a foreign currency does not mark a THB withdrawal paid', async () => {
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
    try {
      const d = await w.deal({ delivery: false });
      const o = await w.pickup(d);
      expect((await payOrder(h, d.buyer, o)).result).toBe('succeeded');
      await w.complete(d, o);
      expect((await Wallet.findOne({ kind: 'seller', ownerId: d.seller.id }))!.availableMinor).toBe(
        4_000_000,
      );
      await w.call('put', d.seller, '/wallet/payout-account', {
        bankCode: 'KBANK',
        accountNumber: '1234567890',
        accountName: 'Somchai Jaidee',
      });
      const created = (
        await request(h.app)
          .post(`${API}/wallet/withdrawals`)
          .set(d.seller.auth)
          .set('idempotency-key', key('wd'))
          .send({ amountMinor: 1_000_000 })
      ).body.withdrawal;
      expect(
        (
          await finance('post', fin, `/withdrawals/${created.id}/approve`, {
            confirmation: created.withdrawalNo,
          })
        ).status,
      ).toBe(200);
      const stored = (await Withdrawal.findById(created.id))!;
      h.payments!.settlePayout(stored.providerRef!, 'succeeded');
      const usd = await send(
        h.app,
        providerEvent('payout.paid', stored.providerRef!, 1_000_000, { currency: 'USD' }),
      );
      expect(usd.body.result).toBe('currency_mismatch');
      expect((await Withdrawal.findById(created.id))?.status).toBe('processing');
      expect(
        (await send(h.app, providerEvent('payout.paid', stored.providerRef!, 1_000_000))).body
          .result,
      ).toBe('paid');
    } finally {
      await Setting.deleteMany({
        key: { $in: ['finance.payoutsEnabled', 'finance.minWithdrawalMinor'] },
      });
    }
  });
});

// ---------------------------------------------------------------------------
describe('G. AI assessment', () => {
  const assess = (s: Session, farmId: string, animalId: string) =>
    request(h.app)
      .post(`${API}/farms/${farmId}/animals/${animalId}/assessments`)
      .set(s.auth)
      .send({ includeAiExplanation: false });

  it('WF-G05 an animal’s assessment history lists every run, newest first', async () => {
    const f = await setupFarm(h.app);
    const a = await mkAnimal(h.app, f.owner, f.farmId, { animalTypeId: f.buffalo, sex: 'female' });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++)
      ids.push((await assess(f.owner, f.farmId, a.id)).body.assessment.id);
    const list = await request(h.app)
      .get(`${API}/farms/${f.farmId}/animals/${a.id}/assessments`)
      .set(f.owner.auth);
    expect(list.status).toBe(200);
    expect(list.body.items.map((x: any) => x.id)).toEqual([...ids].reverse());
  });

  it('WF-G09 running and reviewing an assessment changes no listing, order, payment, refund or ledger row', async () => {
    const f = await setupFarm(h.app);
    const a = await mkAnimal(h.app, f.owner, f.farmId, { animalTypeId: f.buffalo, sex: 'female' });
    const counts = async () =>
      Promise.all([
        Listing.countDocuments(),
        Order.countDocuments(),
        Payment.countDocuments(),
        Refund.countDocuments(),
        WalletTransaction.countDocuments(),
        Withdrawal.countDocuments(),
      ]);
    const before = await counts();
    const asm = (await assess(f.owner, f.farmId, a.id)).body.assessment;
    const rev = await request(h.app)
      .post(`${API}/farms/${f.farmId}/assessments/${asm.id}/review`)
      .set(f.owner.auth)
      .send({ decision: 'accepted' });
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);
    expect(await counts()).toEqual(before);
  });

  it('WF-G10 an archived farm is read-only for assessment reviews and dismissals too', async () => {
    const f = await setupFarm(h.app);
    const a = await mkAnimal(h.app, f.owner, f.farmId, { animalTypeId: f.buffalo, sex: 'female' });
    const asm = (await assess(f.owner, f.farmId, a.id)).body.assessment;
    expect(
      (await request(h.app).post(`${API}/farms/${f.farmId}/archive`).set(f.owner.auth).send({}))
        .status,
    ).toBe(200);
    const rev = await request(h.app)
      .post(`${API}/farms/${f.farmId}/assessments/${asm.id}/review`)
      .set(f.owner.auth)
      .send({ decision: 'accepted' });
    expect(rev.status).toBe(409);
    expect(rev.body.error.code).toBe('FARM_ARCHIVED');
    if (asm.recommendations[0]) {
      const dis = await request(h.app)
        .post(
          `${API}/farms/${f.farmId}/assessments/${asm.id}/recommendations/${asm.recommendations[0].id}/dismiss`,
        )
        .set(f.owner.auth)
        .send({});
      expect(dis.status).toBe(409);
    }
    expect((await AiAssessment.findById(asm.id))!.review.status).not.toBe('accepted');
  });

  it('WF-G11 the default safety list also blocks health claims written in Thai', () => {
    const defaults = SETTING_REGISTRY['ai.blockedNarrativeTerms'].default as string;
    const narrative = (summary: string) =>
      JSON.stringify({
        summary,
        observations: ['The recorded weight is 420 kg.'],
        questionsForOwner: ['Is anything missing?'],
      });
    const facts = { weightKg: 420 };
    expect(
      validateNarrative(
        narrative('This points to a diagnosis of a parasite problem.'),
        facts,
        defaults,
      ).ok,
    ).toBe(false);
    for (const claim of [
      'สัตว์ตัวนี้น่าจะติดเชื้อพยาธิ ควรรักษาด้วยยาปฏิชีวนะโดยเร็ว',
      'ผลการวินิจฉัยเบื้องต้นบ่งชี้ว่าเป็นโรคในระบบทางเดินอาหาร',
      'รับประกันว่าจะขายได้ราคาดีภายในเดือนนี้แน่นอน',
    ])
      expect(validateNarrative(narrative(claim), facts, defaults).ok, claim).toBe(false);
    // ordinary Thai text is still fine
    expect(
      validateNarrative(
        narrative('น้ำหนักที่บันทึกล่าสุดคือ 420 กิโลกรัม และควรชั่งน้ำหนักอีกครั้ง'),
        facts,
        defaults,
      ).ok,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('H. products and inventory', () => {
  const stockOf = async (id: string) => {
    const p = (await Product.findById(id))!;
    return { stock: p.stock, reserved: p.reserved };
  };

  it('WF-H06 a carted product whose category is closed later is flagged and cannot be checked out', async () => {
    const s = await shop.seller('Category Farm');
    const p = await shop.live(s, { stock: 5 });
    const buyer = await shop.buyer();
    expect((await shop.put(buyer, p.id, 1)).status).toBe(200);
    await ProductCategory.updateOne({ key: 'feed' }, { $set: { salesEnabled: false } });
    try {
      const cart = await shop.cartOf(buyer);
      const line = cart.groups.flatMap((g: any) => g.lines).find((i: any) => i.productId === p.id);
      expect(line.problems).toContain('unavailable');
      const res = await shop.call('post', buyer, '/shop/cart/checkout', {
        fulfillment: 'pickup',
        expected: shop.expectedOf(cart),
      });
      expect(res.status).toBe(409);
      expect(await stockOf(p.id)).toEqual({ stock: 5, reserved: 0 });
    } finally {
      await ProductCategory.updateOne({ key: 'feed' }, { $set: { salesEnabled: true } });
    }
  });

  it('WF-H07 a shop shipment that comes back puts the sold units back on the shelf, once', async () => {
    const s = await shop.seller('Return Farm');
    const p = await shop.live(s, { stock: 5 });
    const buyer = await shop.buyer();
    await shop.put(buyer, p.id, 2);
    const o = (await shop.checkout(buyer, { delivery: true })).body.orders[0];
    await shop.pay(buyer, o);
    expect(await stockOf(p.id)).toEqual({ stock: 3, reserved: 0 });
    await shop.call('post', s.user, `/orders/${o.id}/process`);
    const sh = (
      await shop.call('post', s.user, `/orders/${o.id}/ship`, {
        carrier: 'Own truck',
        trackingNumber: `T-${Date.now()}`,
      })
    ).body.order.shipments[0];
    const cb = (status: string) =>
      shipWebhook(h.app, {
        type: 'shipment.status',
        carrier: sh.carrier,
        trackingNumber: sh.trackingNumber,
        status,
      });
    expect((await cb('failed')).body.result).toBe('applied');
    expect((await cb('returned')).body.result).toBe('applied');
    expect((await Order.findById(o.id))?.status).toBe('REFUND_PENDING');
    expect(await stockOf(p.id)).toEqual({ stock: 5, reserved: 0 });
    await cb('returned'); // a repeated callback changes nothing
    expect(await stockOf(p.id)).toEqual({ stock: 5, reserved: 0 });
  });

  it('WF-H08 stock cannot be changed on an archived product or an archived farm', async () => {
    const s = await shop.seller('Frozen Farm');
    const p = await shop.live(s, { stock: 5 });
    const adj = () =>
      shop.call('post', s.user, `/farms/${s.farmId}/products/${p.id}/stock`, {
        delta: 3,
        reason: 'Delivery from supplier',
      });
    const archived = await shop.call(
      'post',
      s.user,
      `/farms/${s.farmId}/products/${p.id}/archive`,
      {
        reason: 'No longer sold',
      },
    );
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    expect((await adj()).status).toBe(409);
    expect(await stockOf(p.id)).toEqual({ stock: 5, reserved: 0 });

    const s2 = await shop.seller('Archived Farm');
    const p2 = await shop.live(s2, { stock: 5 });
    expect((await shop.call('post', s2.user, `/farms/${s2.farmId}/archive`, {})).status).toBe(200);
    const res = await shop.call('post', s2.user, `/farms/${s2.farmId}/products/${p2.id}/stock`, {
      delta: 3,
      reason: 'Delivery from supplier',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FARM_ARCHIVED');
    expect(await stockOf(p2.id)).toEqual({ stock: 5, reserved: 0 });
  });
});
