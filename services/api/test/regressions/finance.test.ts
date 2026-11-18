import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CommissionRule,
  Order,
  Payment,
  Refund,
  Setting,
  Wallet,
  WalletTransaction,
} from '../../src/models';
import { systemWallet } from '../../src/modules/finance/ledger';
import {
  addFarmMember,
  createStaff,
  startHarness,
  type Session,
  type Staff,
  type TestHarness,
} from '../helpers';
import { createWorld, type World } from '../commerce-fixtures';
import { API, key, payOrder, providerEvent, send, startPayment } from '../finance-helpers';

/**
 * Regression tests for money-flow defects found in the second full-system audit.
 * Each test reproduces the reported behaviour first; the fix makes it pass.
 */
let h: TestHarness;
let w: World;
let fin: Staff;
beforeAll(async () => {
  h = await startHarness();
  w = await createWorld(h);
  fin = await createStaff(h.app, ['finance_admin']);
});
afterAll(() => h.stop());

const admin = (m: 'get' | 'post', s: Session, path: string, body?: object) =>
  request(h.app)[m](`${API}/admin/finance${path}`).set(s.auth).send(body);

describe('AUDIT2-F1: refunding a parked (unapplied) payment reverses what was received, not what was asked', () => {
  it('leaves the suspense account where it started after an underpayment is refunded', async () => {
    const d = await w.deal();
    const o = await w.checkout(d);
    const p = (await startPayment(h.app, d.buyer, o.id)).body.payment;
    const suspense = await systemWallet('suspense');
    const before = (await Wallet.findById(suspense._id))!.availableMinor;
    const c = h.payments!.settleCharge(p.providerRef, 'succeeded');
    const received = 4_000_000; // less than the order total
    expect(c.amountMinor).not.toBe(received);
    expect(
      (await send(h.app, providerEvent('charge.succeeded', c.ref, received))).body.result,
    ).toBe('unapplied');
    const refund = (await Refund.findOne({ paymentId: p.id }))!;
    expect(refund.amountMinor).toBe(received);
    await admin('post', fin, `/refunds/${refund._id}/approve`, { confirmation: refund.refundNo });
    const ref = (await Refund.findById(refund._id))!.providerRef!;
    h.payments!.settleRefund(ref, 'succeeded');
    expect((await send(h.app, providerEvent('refund.succeeded', ref, received))).body.result).toBe(
      'succeeded',
    );
    expect((await Wallet.findById(suspense._id))!.availableMinor).toBe(before);
    const lines = await WalletTransaction.find({ journalKey: `refund:${refund._id}` });
    expect(lines.map((l) => Math.abs(l.amountMinor))).toEqual([received, received]);
  });
});

describe('AUDIT2-F2: an order cancelled while its payment was being applied still gets its refund', () => {
  it('queues the refund once the payment is finalised (webhook redelivery or reconcile repair)', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    const p = await payOrder(h, d.buyer, o);
    expect(p.result).toBe('succeeded');
    // the process stopped after the order was marked PAID but before the payment was marked applied
    await Payment.updateOne({ _id: p.payment.id }, { $set: { disposition: null } });
    await Refund.deleteMany({ paymentId: p.payment.id });
    const cancel = await w.call('post', d.buyer, `/orders/${o.id}/cancel`, {
      reason: 'changed my mind',
    });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect((await Order.findById(o.id))?.status).toBe('REFUND_PENDING');
    expect(await Refund.countDocuments({ orderId: o.id })).toBe(0); // nothing to refund yet: payment not applied

    await admin('post', fin, '/reconcile', { repair: true, confirmation: 'REPAIR' });
    expect((await Payment.findById(p.payment.id))?.disposition).toBe('applied');
    expect(await Refund.countDocuments({ orderId: o.id })).toBe(1);
  });
});

describe('AUDIT2-F3: farm staff cannot approve refunds on their own farm’s orders', () => {
  it('refuses a finance admin who is a manager of the selling farm', async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    const staff = await createStaff(h.app, ['finance_admin']);
    await addFarmMember(h.app, d.seller, d.farmId, staff, 'manager');
    const p = await payOrder(h, d.buyer, o);
    expect(p.result).toBe('succeeded');
    await w.call('post', d.buyer, `/orders/${o.id}/cancel`, { reason: 'changed my mind' });
    const refund = (await Refund.findOne({ orderId: o.id }))!;
    const res = await admin('post', staff, `/refunds/${refund._id}/approve`, {
      confirmation: refund.refundNo,
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SELF_APPROVAL');
    // an unrelated finance admin still can
    expect(
      (
        await admin('post', fin, `/refunds/${refund._id}/approve`, {
          confirmation: refund.refundNo,
        })
      ).status,
    ).toBe(200);
  });
});

describe('AUDIT2-F4: a withdrawal idempotency key cannot be replayed for a different amount', () => {
  it('does not report a failed request as done when the seller retries with a new amount', async () => {
    await Promise.all([
      Setting.updateOne(
        { key: 'finance.payoutsEnabled' },
        { $set: { value: true } },
        { upsert: true },
      ),
      Setting.updateOne(
        { key: 'finance.minWithdrawalMinor' },
        { $set: { value: 10_000 } },
        { upsert: true },
      ),
    ]);
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    await payOrder(h, d.buyer, o);
    await w.complete(d, o);
    const seller = d.seller;
    await w.call('put', seller, '/wallet/payout-account', {
      bankCode: 'KBANK',
      accountNumber: '1234567890',
      accountName: 'Somchai Jaidee',
    });
    const wd = (amountMinor: number, k: string) =>
      request(h.app)
        .post(`${API}/wallet/withdrawals`)
        .set(seller.auth)
        .set({ 'idempotency-key': k })
        .send({ amountMinor });
    const k = key('wd');
    const tooMuch = await wd(999_000_000, k);
    expect(tooMuch.body.error.code).toBe('INSUFFICIENT_FUNDS');
    const retry = await wd(500_000, k);
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    // the same key and amount still replays
    const k2 = key('wd2');
    const ok = await wd(500_000, k2);
    expect(ok.status).toBe(201);
    const again = await wd(500_000, k2);
    expect(again.status).toBe(200);
    expect(again.body.withdrawal.id).toBe(ok.body.withdrawal.id);
  });
});

describe('AUDIT2-F5: editing a commission rule keeps what the edit did not mention', () => {
  it('a fee change on a category-scoped rule does not widen it to every category', async () => {
    const root = await createStaff(h.app, ['super_admin']);
    const created = await admin('post', root, '/commission-rules', {
      name: 'Buffalo only',
      feeBps: 400,
      categories: ['buffalo'],
      startsAt: '2020-01-01T00:00:00.000Z',
      priority: 5,
      reason: 'Category pricing',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.rule.id;
    const edit = await request(h.app)
      .patch(`${API}/admin/finance/commission-rules/${id}`)
      .set(root.auth)
      .send({ feeBps: 450, reason: 'Adjust the buffalo fee' });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(edit.body.rule.categories).toEqual(['buffalo']);
    expect((await CommissionRule.findById(id))?.categories).toEqual(['buffalo']);
    await CommissionRule.updateOne({ _id: id }, { $set: { active: false } });
  });
});
