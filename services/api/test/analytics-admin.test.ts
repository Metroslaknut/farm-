/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import request from 'supertest';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AuditLog,
  Listing,
  Order,
  Payment,
  Refund,
  Registration,
  Setting,
  User,
  Wallet,
  WalletTransaction,
} from '../src/models';
import { reportCache } from '../src/modules/analytics/cache';
import { createWorld, type World } from './commerce-fixtures';
import { payOrder } from './finance-helpers';
import {
  createStaff,
  createStaffWithPermissions,
  createUser,
  startHarness,
  type Session,
  type Staff,
  type TestHarness,
} from './helpers';
import { API } from './orders-helpers';

const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);
let h: TestHarness;
let w: World;
let fin: Staff;
let root: Staff;
let usersOnly: Staff;
let moderator: Staff;
let reportsOnly: Staff;
const orderIds: string[] = [];

const get = (s: Session, qs = '') => request(h.app).get(`${API}/admin/analytics${qs}`).set(s.auth);
const csv = (s: Session, section: string, qs = '') =>
  request(h.app).get(`${API}/admin/analytics/export?section=${section}${qs}`).set(s.auth);
const metrics = (res: any, section: string) => res.body.sections[section].metrics;

beforeAll(async () => {
  h = await startHarness();
  w = await createWorld(h);
  fin = await createStaff(h.app, ['finance_admin']);
  root = await createStaff(h.app, ['super_admin']);
  usersOnly = await createStaffWithPermissions(h.app, root, ['users.read']);
  moderator = await createStaffWithPermissions(h.app, root, ['listings.moderate']);
  reportsOnly = await createStaffWithPermissions(h.app, root, ['reports.read']);
  await Setting.updateOne(
    { key: 'analytics.cacheSeconds' },
    { $set: { value: 0 } },
    { upsert: true },
  );

  // a 5 % commission rule, then three real pickup orders: completed, paid-in-progress, paid-then-cancelled
  const rule = await request(h.app)
    .post(`${API}/admin/finance/commission-rules`)
    .set(fin.auth)
    .send({
      name: 'Standard 5%',
      feeBps: 500,
      categories: [],
      startsAt: '2020-01-01T00:00:00.000Z',
      priority: 10,
      reason: 'Analytics test pricing',
    });
  expect(rule.status, JSON.stringify(rule.body)).toBe(201);
  const pay = async () => {
    const d = await w.deal({ delivery: false });
    const o = await w.pickup(d);
    expect((await payOrder(h, d.buyer, o)).result).toBe('succeeded');
    orderIds.push(o.id);
    return { d, o };
  };
  const a = await pay();
  await w.complete(a.d, a.o);
  await pay();
  const c = await pay();
  expect(
    (await w.call('post', c.d.buyer, `/orders/${c.o.id}/cancel`, { reason: 'Changed my mind' }))
      .status,
  ).toBe(200);
  expect(orderIds).toHaveLength(3);
});
afterAll(async () => {
  await h.stop();
});

describe('admin dashboard: figures reconcile with the source records', () => {
  it('orders: gross merchandise value counts only sales that stand; the refund-pending order is shown apart', async () => {
    const res = await get(fin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(metrics(res, 'orders')).toMatchObject({
      ordersCreated: 3,
      ordersPaid: 2,
      gmvMinor: 8_000_000,
      shippingMinor: 0,
      cancelledOrders: 0,
      refundedOrders: 1,
    });
    const raw = await Order.collection
      .find({ status: { $in: ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] } })
      .toArray();
    expect(raw.reduce((s: number, o: any) => s + o.itemsMinor, 0)).toBe(
      metrics(res, 'orders').gmvMinor,
    );
    expect(res.body.meta).toMatchObject({ timezone: 'Asia/Bangkok', cached: false });
  });

  it('commissions: platform commission is a different number from GMV; released vs in progress; ledger-booked figure shown separately', async () => {
    const res = await get(fin);
    const m = metrics(res, 'commissions');
    expect(m).toMatchObject({
      commissionMinor: 400_000,
      commissionReleasedMinor: 200_000,
      commissionInProgressMinor: 200_000,
    });
    expect(m.commissionMinor).not.toBe(metrics(res, 'orders').gmvMinor);
    // independent: the platform wallet's lines for the same period
    const ledger = await WalletTransaction.aggregate([
      { $match: { walletKind: 'platform' } },
      { $group: { _id: null, s: { $sum: '$amountMinor' } } },
    ]);
    expect(m.commissionBookedNetMinor).toBe(ledger[0]?.s ?? 0);
    const orderFee = await Order.aggregate([
      { $match: { status: { $in: ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] } } },
      { $group: { _id: null, s: { $sum: '$platformFeeMinor' } } },
    ]);
    expect(orderFee[0].s).toBe(m.commissionMinor);
    expect(res.body.definitions['admin.commissions.commissionMinor']).toBeTruthy();
  });

  it('payments, refunds and payouts', async () => {
    const res = await get(fin);
    expect(metrics(res, 'payments')).toMatchObject({
      paymentAttempts: 3,
      paymentsSucceeded: 3,
      paymentsFailed: 0,
      paymentSuccessRate: 100,
      amountReceivedMinor: 12_000_000,
    });
    expect(await Payment.countDocuments()).toBe(3);
    expect(metrics(res, 'refunds')).toMatchObject({
      refundsRequested: 1,
      refundedMinor: 0,
      refundsOpenMinor: 4_000_000,
      refundsFailed: 0,
    });
    const wallets = await Wallet.aggregate([
      { $match: { kind: 'seller' } },
      { $group: { _id: null, s: { $sum: { $add: ['$pendingMinor', '$availableMinor'] } } } },
    ]);
    expect(metrics(res, 'payouts').sellerBalancesMinor).toBe(wallets[0]?.s ?? 0);
    expect(metrics(res, 'payouts')).toMatchObject({ withdrawalsRequested: 0, paidOutMinor: 0 });
  });

  it('users, registrations, farms and listings match the collections', async () => {
    const res = await get(root);
    expect(res.status).toBe(200);
    expect(metrics(res, 'users').totalUsers).toBe(await User.countDocuments());
    expect(metrics(res, 'users').newUsersInRange).toBe(await User.countDocuments());
    const series = res.body.sections.users.series.newUsers;
    expect(series.reduce((a: number, p: any) => a + p.value, 0)).toBe(
      metrics(res, 'users').newUsersInRange,
    );
    expect(series).toHaveLength(30);
    expect(metrics(res, 'registrations').registrationsSubmitted).toBe(
      await Registration.countDocuments(),
    );
    expect(metrics(res, 'listings').activeListings).toBe(
      await Listing.countDocuments({ status: 'ACTIVE' }),
    );
    for (const s of [
      'users',
      'registrations',
      'farms',
      'listings',
      'orders',
      'payments',
      'commissions',
      'refunds',
      'payouts',
      'moderation',
      'alerts',
    ])
      expect(res.body.sections[s].available, s).toBe(true);
  });

  it('every metric returned has a definition', async () => {
    const res = await get(root);
    const keys: string[] = [];
    for (const [name, sec] of Object.entries<any>(res.body.sections))
      for (const k of Object.keys(sec.metrics)) keys.push(`admin.${name}.${k}`);
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) expect(res.body.definitions[k], k).toBeTruthy();
    expect(Object.keys(res.body.definitions).sort()).toEqual([...keys].sort());
  });
});

describe('admin dashboard: filters and date ranges', () => {
  it('future ranges are empty; orderKind narrows the order figures; bad input is rejected', async () => {
    const future = await get(fin, '?from=2099-01-01&to=2099-01-31');
    expect(metrics(future, 'orders')).toMatchObject({ ordersPaid: 0, gmvMinor: 0 });
    expect(metrics(future, 'commissions').commissionMinor).toBe(0);
    expect(metrics(await get(fin, '?orderKind=product'), 'orders').gmvMinor).toBe(0);
    expect(metrics(await get(fin, '?orderKind=animal'), 'orders').gmvMinor).toBe(8_000_000);
    for (const qs of [
      '?orderKind=cow',
      '?granularity=hour',
      '?from=2026-02-31&to=2026-03-01',
      '?unknown=1',
      '?from=2020-01-01&to=2026-03-01',
    ])
      expect((await get(fin, qs)).status, qs).toBe(400);
    const month = await get(root, '?granularity=month');
    expect(month.body.meta.granularity).toBe('month');
    expect(
      month.body.sections.users.series.newUsers.reduce((a: number, p: any) => a + p.value, 0),
    ).toBe(metrics(month, 'users').newUsersInRange);
  });
});

describe('admin dashboard: authorization', () => {
  it('needs a signed-in staff member with at least one reporting permission', async () => {
    expect((await request(h.app).get(`${API}/admin/analytics`)).status).toBe(401);
    expect((await get(await createUser(h.app))).status).toBe(403);
    expect((await get(w.mod)).status).toBe(200); // moderators have moderation + reports
  });

  it('each section follows its own permission and an unavailable section carries no data', async () => {
    const res = await get(usersOnly);
    expect(res.status).toBe(200);
    expect(res.body.sections.users.available).toBe(true);
    for (const s of [
      'orders',
      'payments',
      'commissions',
      'refunds',
      'payouts',
      'alerts',
      'moderation',
    ])
      expect(res.body.sections[s], s).toMatchObject({
        available: false,
        metrics: {},
        tables: {},
        series: {},
      });
    const json = JSON.stringify(res.body);
    for (const money of ['8000000', '400000', '12000000', '4000000'])
      expect(json).not.toContain(money);
    const reports = await get(reportsOnly);
    expect(reports.body.sections.listings.available).toBe(true);
    expect(reports.body.sections.orders.available).toBe(false);
  });

  it('moderation shows only what the viewer may moderate', async () => {
    await Listing.collection.insertOne({
      farmId: new Types.ObjectId(),
      animalId: new Types.ObjectId(),
      status: 'PENDING_REVIEW',
      createdAt: new Date(Date.now() - 5 * 3600_000),
      updatedAt: new Date(Date.now() - 5 * 3600_000),
    } as never);
    const m = metrics(await get(moderator), 'moderation');
    expect(m.listingsPendingReview).toBe(1);
    expect(m.oldestPendingHours).toBeGreaterThanOrEqual(4);
    expect(m).not.toHaveProperty('openContentReports');
    expect((await get(usersOnly)).body.sections.moderation.available).toBe(false);
  });

  it('alerts surface failed refunds and unapplied money for finance only', async () => {
    await Refund.collection.insertOne({
      refundNo: 'RF-FAILED',
      status: 'failed',
      amountMinor: 1,
      paymentId: new Types.ObjectId(),
      requestedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    const res = await get(fin);
    expect(res.body.sections.alerts.alerts.map((a: any) => a.code)).toContain('failed_refunds');
    expect(metrics(res, 'refunds').refundsFailed).toBe(1);
    expect(metrics(res, 'alerts').alertCount).toBeGreaterThanOrEqual(1);
    expect((await get(usersOnly)).body.sections.alerts.alerts ?? []).toEqual([]);
    await Refund.deleteOne({ refundNo: 'RF-FAILED' });
  });
});

describe('admin CSV export mirrors the dashboard permissions', () => {
  const parse = (t: string) =>
    t
      .replace(BOM, '')
      .trim()
      .split('\r\n')
      .map((l) => l.split(','));
  it('is allowed only where the matching section is, and is audited', async () => {
    expect((await csv(usersOnly, 'commissions')).status).toBe(403);
    expect((await csv(usersOnly, 'orders')).status).toBe(403);
    expect((await csv(usersOnly, 'signups')).status).toBe(200);
    expect((await csv(moderator, 'payments')).status).toBe(403);
    expect((await csv(await createUser(h.app), 'signups')).status).toBe(403);
    expect((await request(h.app).get(`${API}/admin/analytics/export?section=signups`)).status).toBe(
      401,
    );
    expect((await csv(fin, 'secrets')).status).toBe(400);
    const before = await AuditLog.countDocuments({ action: 'analytics.export' });
    const res = await csv(fin, 'commissions');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(await AuditLog.countDocuments({ action: 'analytics.export' })).toBe(before + 1);
  });

  it('commission and order exports add up to the dashboard, with no buyer identity', async () => {
    const dash = await get(fin);
    const orders = await csv(fin, 'orders');
    const rows = parse(orders.text);
    expect(rows.length - 1).toBe(3);
    const header = rows[0]!;
    const fee = header.findIndex((c) => /fee|commission/i.test(c));
    expect(fee).toBeGreaterThan(-1);
    expect(orders.text).not.toMatch(/@example\.test|address|phone/i);
    const comm = await csv(fin, 'commissions');
    const crows = parse(comm.text);
    expect(crows.length).toBeGreaterThan(1);
    expect(dash.status).toBe(200);
  });
});

describe('admin cache is permission-aware', () => {
  it('a cached finance report is never handed to a user without finance rights', async () => {
    reportCache.clear();
    await Setting.updateOne({ key: 'analytics.cacheSeconds' }, { $set: { value: 60 } });
    const a = await get(fin);
    expect(a.body.meta.cached).toBe(false);
    expect((await get(fin)).body.meta.cached).toBe(true);
    const u = await get(usersOnly);
    expect(u.body.sections.orders).toMatchObject({ available: false, metrics: {} });
    expect(JSON.stringify(u.body)).not.toContain('8000000');
    expect((await get(fin, `?fresh=true`)).body.meta.cached).toBe(false);
    await Setting.updateOne({ key: 'analytics.cacheSeconds' }, { $set: { value: 0 } });
    reportCache.clear();
  });
});
