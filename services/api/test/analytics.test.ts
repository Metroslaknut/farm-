/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AiAssessment,
  Animal,
  AuditLog,
  FarmExpense,
  FeedingRecord,
  HealthRecord,
  Listing,
  Order,
  Payment,
  Product,
  Setting,
  WalletTransaction,
  WeightRecord,
  AnimalType,
  Role,
  UserRole,
} from '../src/models';
import { reportCache } from '../src/modules/analytics/cache';
import { baht, cell, safeFilename, toCsv } from '../src/modules/analytics/csv';
import { DEFINITIONS } from '../src/modules/analytics/definitions';
import { fillSeries, labelOf, periods, resolveRange } from '../src/modules/analytics/range';
import {
  ordersCreatedPipeline,
  productLinesPipeline,
  salesByStatusPipeline,
  salesSeriesPipeline,
  type FarmCtx,
} from '../src/modules/analytics/farm.service';
import {
  ledgerCommissionPipeline,
  paidOrdersPipeline,
  paymentsPipeline,
} from '../src/modules/analytics/admin.service';
import {
  addFarmMember,
  createStaff,
  createUser,
  createFarmer,
  createStaffWithPermissions,
  login,
  makeFarm,
  register,
  startHarness,
  type Session,
  type Staff,
  type TestHarness,
} from './helpers';
import { API } from './orders-helpers';

const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);
let h: TestHarness;
let admin: Staff;
let reader: Staff; // platform staff with farms.read only

beforeAll(async () => {
  h = await startHarness();
  admin = await createStaff(h.app, ['super_admin']);
  reader = await createStaffWithPermissions(h.app, admin, ['farms.read']);
});
afterAll(async () => {
  await h.stop();
});

const get = (s: Session, path: string) => request(h.app).get(`${API}${path}`).set(s.auth);
const ago = (d: number, hours = 0) => new Date(Date.now() - d * 86_400_000 - hours * 3_600_000);
const oid = () => new Types.ObjectId();

// ---------------------------------------------------------------------------
describe('date ranges (Thailand time)', () => {
  const NOW = new Date('2026-06-15T05:00:00Z'); // 12:00 in Bangkok
  it('defaults to the last 30 days ending today, and chooses a sensible granularity', () => {
    const r = resolveRange({}, NOW);
    expect(r).toMatchObject({ from: '2026-05-17', to: '2026-06-15', days: 30, granularity: 'day' });
    expect(resolveRange({ from: '2026-01-01', to: '2026-06-15' }, NOW).granularity).toBe('week');
    expect(resolveRange({ from: '2025-06-16', to: '2026-06-15' }, NOW).granularity).toBe('month');
    expect(resolveRange({ granularity: 'month' }, NOW).granularity).toBe('month');
  });
  it('a calendar day is a Bangkok day: the boundary is 17:00 UTC; the end day is inclusive', () => {
    const r = resolveRange({ from: '2026-06-15', to: '2026-06-15' }, NOW);
    expect(r.start.toISOString()).toBe('2026-06-14T17:00:00.000Z');
    expect(r.endExclusive.toISOString()).toBe('2026-06-15T17:00:00.000Z');
    expect(r.days).toBe(1);
    const inside = new Date('2026-06-14T17:30:00Z'); // 00:30 on the 15th in Bangkok
    expect(inside >= r.start && inside < r.endExclusive).toBe(true);
    const before = new Date('2026-06-14T16:59:59Z'); // 23:59 on the 14th
    expect(before >= r.start).toBe(false);
  });
  it('refuses impossible, reversed and oversized ranges', () => {
    const bad = (q: object) => expect(() => resolveRange(q as never, NOW)).toThrow();
    bad({ from: '2026-02-30', to: '2026-03-05' });
    bad({ from: '2026-06-10', to: '2026-06-01' });
    bad({ from: '2024-01-01', to: '2026-06-15' });
    bad({ from: '2026-01-01', to: '2026-06-15', granularity: 'day' }); // daily detail is limited to 92 days
    expect(() => resolveRange({ from: '2025-06-15', to: '2026-06-15' }, NOW)).not.toThrow(); // 366 days is fine
  });
  it('series cover every period, including empty ones, in order; labels follow ISO weeks and months', () => {
    const r = resolveRange({ from: '2026-06-10', to: '2026-06-15', granularity: 'day' }, NOW);
    expect(fillSeries(r, [{ _id: '2026-06-12', v: 7 }])).toEqual([
      { period: '2026-06-10', value: 0 },
      { period: '2026-06-11', value: 0 },
      { period: '2026-06-12', value: 7 },
      { period: '2026-06-13', value: 0 },
      { period: '2026-06-14', value: 0 },
      { period: '2026-06-15', value: 0 },
    ]);
    expect(labelOf('2026-01-01', 'week')).toBe('2026-W01');
    expect(labelOf('2025-12-29', 'week')).toBe('2026-W01'); // the Monday of ISO week 1 of 2026
    expect(labelOf('2024-12-30', 'week')).toBe('2025-W01');
    expect(labelOf('2021-01-03', 'week')).toBe('2020-W53');
    expect(labelOf('2026-06-15', 'month')).toBe('2026-06');
    const m = resolveRange({ from: '2026-01-15', to: '2026-04-10', granularity: 'month' }, NOW);
    expect(periods(m)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
    const w = resolveRange({ from: '2026-06-01', to: '2026-06-21', granularity: 'week' }, NOW);
    expect(periods(w)).toEqual(['2026-W23', '2026-W24', '2026-W25']);
  });
});

describe('CSV safety', () => {
  it('quotes per RFC 4180, adds a BOM and CRLF, and keeps numbers as numbers', () => {
    const out = toCsv(
      ['a', 'b'],
      [
        ['x,y', 'say "hi"'],
        ['line\nbreak', 5],
        [null, -12.5],
      ],
    );
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out.slice(1)).toBe('a,b\r\n"x,y","say ""hi"""\r\n"line\nbreak",5\r\n,-12.5\r\n');
  });
  it('neutralises formula injection in text cells (= + - @ tab CR) but never in real numbers', () => {
    for (const evil of [
      '=1+1',
      '+SUM(A1)',
      '-2+3',
      '@cmd',
      '\t=x',
      '\rmalicious',
      '=HYPERLINK("http://x","y")',
    ])
      expect(cell(evil).replace(/^"/, '')).toMatch(/^'/);
    expect(cell(-5)).toBe('-5');
    expect(cell(0.5)).toBe('0.5');
    expect(cell('normal =text')).toBe('normal =text');
    expect(cell(Number.NaN)).toBe('');
    expect(baht(123456)).toBe(1234.56);
    expect(baht(-5)).toBe(-0.05);
    expect(baht(null)).toBeNull();
    expect(safeFilename('../../etc/pass wd"; x.csv')).not.toMatch(/[\\/";\s]/);
  });
});

// ---------------------------------------------------------------------------
// A farm with known data
// ---------------------------------------------------------------------------
interface Fx {
  owner: Session;
  ownerId: string;
  farmId: string;
  F: Types.ObjectId;
  worker: Session;
  viewer: Session;
  manager: Session;
  codes: Record<string, string>;
  other: { owner: Session; farmId: string };
}
let fx: Fx;
const ORDER_DEFAULTS = {
  currency: 'THB',
  fulfillment: 'pickup',
  items: [{ type: 'animal', title: 'Animal' }],
  shippingMinor: 0,
};
let on = 0;
const order = (farmId: Types.ObjectId, o: Record<string, unknown>) =>
  Order.collection.insertOne({
    ...ORDER_DEFAULTS,
    orderNo: `AN-${++on}`,
    farmId,
    grandTotalMinor: (o['itemsMinor'] as number) + ((o['shippingMinor'] as number) ?? 0),
    ...o,
  } as never);

async function seedFarm() {
  const { id, email } = await register(h.app);
  for (const key of ['farm_owner', 'seller'])
    await UserRole.create({ userId: id, roleId: (await Role.findOne({ key }))!._id });
  const owner = await login(h.app, email);
  const farmId = await makeFarm(h.app, owner, 'Analytics Farm');
  const F = new Types.ObjectId(farmId);
  const worker = await createUser(h.app);
  const viewer = await createUser(h.app);
  const manager = await createUser(h.app);
  await addFarmMember(h.app, owner, farmId, worker, 'worker');
  await addFarmMember(h.app, owner, farmId, viewer, 'viewer');
  await addFarmMember(h.app, owner, farmId, manager, 'manager');
  const types = Object.fromEntries((await AnimalType.find()).map((t) => [t.key, t._id]));
  const mk = (code: string, type: string, status = 'active', extra: object = {}) =>
    Animal.create({
      farmId: F,
      animalCode: code,
      animalTypeId: types[type],
      sex: 'female',
      currentStatus: status as 'active',
      createdBy: id,
      ...extra,
    });
  const [b1, b2, b3, , , c1] = await Promise.all([
    mk('B1', 'buffalo'),
    mk('B2', 'buffalo'),
    mk('B3', 'buffalo'),
    mk('B4', 'buffalo', 'sold'),
    mk('B5', 'buffalo', 'active', { archivedAt: new Date() }),
    mk('C1', 'cattle', 'for_sale'),
    mk('C2', 'cattle', 'for_sale'),
  ]);
  const base = { farmId: F, createdBy: id };
  const w = (a: any, d: number, kg: number, method = 'scale') =>
    WeightRecord.create({
      ...base,
      animalId: a._id,
      weighedOn: ago(d),
      weightKg: kg,
      method,
    } as never);
  await Promise.all([
    w(b1, 40, 300),
    w(b1, 10, 330),
    w(b2, 20, 200, 'tape_estimate'),
    w(b2, 15, 205),
    w(c1, 12, 250),
    w(b3, 400, 100),
  ]);
  const hr = (a: any, type: string, d: number, extra: object = {}) =>
    HealthRecord.create({
      ...base,
      animalId: a._id,
      type,
      recordedOn: ago(d),
      title: 'Secret health title',
      ...extra,
    } as never);
  await Promise.all([
    hr(b1, 'illness', 30),
    hr(b1, 'illness', 12),
    hr(b2, 'treatment', 5, { withdrawalEndsOn: ago(-5) }),
    hr(c1, 'vaccination', 8, { nextDueOn: ago(-10) }),
    hr(b1, 'illness', 20, { voided: true }),
    hr(b1, 'illness', 200),
  ]);
  const fr = (a: any, kind: string, d: number, extra: object = {}) =>
    FeedingRecord.create({
      ...base,
      animalId: a?._id ?? null,
      kind,
      date: ago(d),
      feedName: 'Hay',
      category: 'roughage',
      quantity: { amount: 5, unit: 'kg' },
      ...extra,
    } as never);
  await Promise.all([
    fr(b1, 'log', 3),
    fr(b1, 'log', 2),
    fr(null, 'log', 1, { groupLabel: 'Heifers' }),
    fr(b1, 'schedule', 1),
    fr(b1, 'log', 4, { voided: true }),
  ]);
  const ex = (cat: string, d: number, amountMinor: number, a: any, extra: object = {}) =>
    FarmExpense.create({
      ...base,
      category: cat,
      expenseDate: ago(d),
      amountMinor,
      description: 'Invoice',
      animalId: a?._id ?? null,
      ...extra,
    } as never);
  await Promise.all([
    ex('feed', 9, 500_000, b1),
    ex('veterinary', 6, 250_000, b1),
    ex('labor', 4, 100_000, null, { description: '=HYPERLINK("http://evil.example","pay")' }),
    ex('feed', 2, 999_999, b1, { voided: true }),
    ex('feed', 100, 777_777, b1),
  ]);
  const L = (status: string, d: number) =>
    Listing.collection.insertOne({
      farmId: F,
      animalId: oid(),
      status,
      createdAt: ago(d),
      updatedAt: ago(d),
    } as never);
  await Promise.all([
    L('ACTIVE', 5),
    L('ACTIVE', 6),
    L('RESERVED', 7),
    L('PENDING_REVIEW', 8),
    L('DRAFT', 120),
  ]);
  const P = (status: string, over: object) =>
    Product.collection.insertOne({
      farmId: F,
      status,
      title: 'P',
      stock: 10,
      reserved: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    } as never);
  await Promise.all([
    P('ACTIVE', { stock: 3, reserved: 3 }),
    P('ACTIVE', { stock: 5, reserved: 0, lowStockThreshold: 5 }),
    P('ACTIVE', { stock: 50, lowStockThreshold: 5 }),
    P('PENDING_REVIEW', {}),
  ]);
  // orders: paid ones are placed a day before they are paid
  const pid = oid();
  await Promise.all([
    order(F, {
      kind: 'animal',
      status: 'PAID',
      createdAt: ago(6),
      paidAt: ago(5),
      itemsMinor: 4_000_000,
      shippingMinor: 250_000,
      platformFeeMinor: 200_000,
      sellerPayoutMinor: 3_800_000,
    }),
    order(F, {
      kind: 'animal',
      status: 'DELIVERED',
      createdAt: ago(9),
      paidAt: ago(8),
      itemsMinor: 3_000_000,
      platformFeeMinor: 150_000,
      sellerPayoutMinor: 2_850_000,
    }),
    order(F, {
      kind: 'animal',
      status: 'SHIPPED',
      createdAt: ago(3),
      paidAt: ago(2),
      itemsMinor: 2_000_000,
      shippingMinor: 100_000,
      platformFeeMinor: 100_000,
      sellerPayoutMinor: 1_900_000,
    }),
    order(F, {
      kind: 'animal',
      status: 'REFUNDED',
      createdAt: ago(7),
      paidAt: ago(6),
      itemsMinor: 5_000_000,
      platformFeeMinor: 250_000,
      sellerPayoutMinor: 4_750_000,
    }),
    order(F, {
      kind: 'animal',
      status: 'CANCELLED',
      createdAt: ago(3),
      paidAt: null,
      itemsMinor: 1_000_000,
      platformFeeMinor: 50_000,
      sellerPayoutMinor: 950_000,
    }),
    order(F, {
      kind: 'animal',
      status: 'REFUND_PENDING',
      createdAt: ago(5),
      paidAt: ago(4),
      itemsMinor: 800_000,
      platformFeeMinor: 40_000,
      sellerPayoutMinor: 760_000,
    }),
    order(F, {
      kind: 'animal',
      status: 'PENDING_PAYMENT',
      createdAt: ago(1),
      paidAt: null,
      itemsMinor: 900_000,
      platformFeeMinor: 0,
      sellerPayoutMinor: 900_000,
    }),
    order(F, {
      kind: 'animal',
      status: 'DELIVERED',
      createdAt: ago(91),
      paidAt: ago(90),
      itemsMinor: 7_000_000,
      platformFeeMinor: 350_000,
      sellerPayoutMinor: 6_650_000,
    }),
    order(F, {
      kind: 'product',
      status: 'PAID',
      createdAt: ago(4),
      paidAt: ago(3),
      itemsMinor: 600_000,
      platformFeeMinor: 30_000,
      sellerPayoutMinor: 570_000,
      items: [
        { type: 'product', productId: pid, title: 'Dairy feed', quantity: 2, totalMinor: 600_000 },
      ],
    }),
  ]);
  const assess = (a: any, d: number, review: string, confidence: string, range: boolean) =>
    AiAssessment.collection.insertOne({
      farmId: F,
      animalId: a._id,
      animalCode: a.animalCode,
      requestedBy: oid(),
      assessmentDate: ago(d),
      animalTypeKey: 'buffalo',
      animalTypeName: 'Buffalo',
      sex: 'female',
      result: {
        confidence: { level: confidence },
        estimatedPriceRange: range ? { lowMinor: 1, midMinor: 2, highMinor: 3 } : null,
        dataQualityWarnings: [],
      },
      inputs: {},
      engineVersion: 'v',
      narrative: {},
      modelVersion: 'v',
      recommendations: [],
      review: { status: review, history: [] },
      createdAt: ago(d),
    } as never);
  await Promise.all([
    assess(b1, 3, 'pending', 'low', false),
    assess(b1, 2, 'accepted', 'high', true),
    assess(c1, 1, 'dismissed', 'medium', true),
  ]);
  // another farm with lots of data that must never appear
  const otherOwner = await createFarmer(h.app);
  const otherFarmId = await makeFarm(h.app, otherOwner, 'Other Farm');
  const OF = new Types.ObjectId(otherFarmId);
  await order(OF, {
    kind: 'animal',
    status: 'PAID',
    createdAt: ago(2),
    paidAt: ago(1),
    itemsMinor: 123_456_700,
    platformFeeMinor: 6_172_835,
    sellerPayoutMinor: 117_283_865,
  });
  await FarmExpense.create({
    farmId: OF,
    createdBy: id,
    category: 'feed',
    expenseDate: ago(1),
    amountMinor: 424_242_00,
    description: 'OTHER FARM SECRET',
    animalId: null,
  } as never);
  await Animal.create({
    farmId: OF,
    animalCode: 'OTHER-1',
    animalTypeId: types['buffalo'],
    sex: 'male',
    createdBy: id,
  });
  return {
    owner,
    ownerId: id,
    farmId,
    F,
    worker,
    viewer,
    manager,
    codes: {},
    other: { owner: otherOwner, farmId: otherFarmId },
  } as Fx;
}

const dash = (s: Session, qs = '') =>
  get(
    s,
    `/farms/${fx.farmId}/dashboard?from=${ago(60).toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}${qs}`,
  );
const metrics = (res: any, section: string) => res.body.sections[section].metrics;

describe('farm dashboard: every metric reconciles with the source records', () => {
  beforeAll(async () => {
    await Setting.updateOne(
      { key: 'analytics.cacheSeconds' },
      { $set: { value: 0 } },
      { upsert: true },
    ); // exact numbers: no caching here
    fx = await seedFarm();
  });

  it('animals: counts by type and status; archived animals are not counted; another farm’s animals never are', async () => {
    const res = await dash(fx.owner);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(metrics(res, 'animals')).toEqual({ animalsOnFarm: 5, totalRecorded: 6 }); // B1 B2 B3 C1 C2 on the farm; B4 sold; B5 archived
    const t = res.body.sections.animals.tables.byTypeAndStatus;
    expect(t.columns).toEqual([
      'Animal type',
      'active',
      'for_sale',
      'sold',
      'deceased',
      'transferred',
      'lost',
      'Total',
    ]);
    const row = (name: string) => t.rows.find((r: any[]) => r[0] === name);
    expect(row('Buffalo')).toEqual(['Buffalo', 3, 0, 1, 0, 0, 0, 4]);
    expect(row('Cattle')).toEqual(['Cattle', 0, 2, 0, 0, 0, 0, 2]);
    // independent check against the collection
    expect(await Animal.countDocuments({ farmId: fx.F, archivedAt: null })).toBe(6);
  });

  it('growth: weighings, animals weighed, gain only where two readings are a week apart, estimated share', async () => {
    const m = metrics(await dash(fx.owner), 'growth');
    expect(m).toEqual({
      weighingsInRange: 5,
      animalsWeighed: 3,
      animalsWithGainEstimate: 1,
      averageDailyGainG: 1000,
      estimatedWeightShare: 20,
    });
    const raw = await WeightRecord.countDocuments({
      farmId: fx.F,
      voided: false,
      weighedOn: { $gte: ago(60) },
    });
    expect(raw).toBe(5);
    const table = (await dash(fx.owner)).body.sections.growth.tables.gainByAnimal.rows;
    expect(table).toEqual([['B1', 300, 330, 30, 1000]]);
  });

  it('health: counts by type, voided and out-of-range records left out, running withdrawals and due vaccinations counted from "now"', async () => {
    const res = await dash(fx.owner);
    expect(metrics(res, 'health')).toEqual({
      healthRecordsInRange: 4,
      illnessRecords: 2,
      treatmentRecords: 1,
      vaccinationRecords: 1,
      animalsWithIllnessOrTreatment: 2,
      withdrawalsRunning: 1,
      vaccinationsDueNext30Days: 1,
    });
    expect(JSON.stringify(res.body.sections.health)).not.toContain('Secret health title'); // free text never appears
    expect(res.body.sections.health.notes.join(' ')).toContain('does not interpret');
  });

  it('feeding: logs only (not schedules or voided), distinct animals fed, group logs', async () => {
    expect(metrics(await dash(fx.owner), 'feeding')).toEqual({
      feedingLogsInRange: 3,
      animalsFed: 1,
      groupFeedingLogs: 1,
    });
  });

  it('costs: only recorded, non-voided, in-range expenses; assigned and farm-wide kept apart', async () => {
    const res = await dash(fx.owner);
    expect(metrics(res, 'costs')).toEqual({
      recordedCostMinor: 850_000,
      expenseRecords: 3,
      costAssignedToAnimalsMinor: 750_000,
      farmWideCostMinor: 100_000,
    });
    const raw = await FarmExpense.aggregate([
      { $match: { farmId: fx.F, voided: false, expenseDate: { $gte: ago(60) } } },
      { $group: { _id: null, t: { $sum: '$amountMinor' } } },
    ]);
    expect(raw[0].t).toBe(850_000);
    expect(res.body.sections.costs.tables.byCategory.rows).toEqual([
      ['feed', 1, 500_000],
      ['veterinary', 1, 250_000],
      ['labor', 1, 100_000],
    ]);
  });

  it('listings: active, reserved, pending and created-in-range', async () => {
    expect(metrics(await dash(fx.owner), 'listings')).toEqual({
      activeListings: 2,
      reservedListings: 1,
      pendingReviewListings: 1,
      listingsCreatedInRange: 4,
    });
  });

  it('sales: gross sales, shipping, commission and net proceeds are different numbers; cancelled and refunded orders are excluded', async () => {
    const res = await dash(fx.owner);
    const m = metrics(res, 'sales');
    expect(m).toEqual({
      ordersCreated: 8, // O1–O7 and the shop order; the 91-day-old order is outside
      ordersPaid: 4, // PAID, DELIVERED, SHIPPED animal orders + the shop order
      grossSalesMinor: 9_600_000, // 4,000,000 + 3,000,000 + 2,000,000 + 600,000 — item prices only
      shippingCollectedMinor: 350_000, // kept apart from sales
      platformCommissionMinor: 480_000,
      estimatedNetProceedsMinor: 9_120_000, // gross − commission
      netProceedsReleasedMinor: 2_850_000, // the delivered order
      netProceedsPendingMinor: 6_270_000, // paid but not yet delivered
      refundedGrossMinor: 5_800_000, // REFUNDED 5,000,000 + REFUND_PENDING 800,000: excluded from gross
      cancelledOrders: 1,
      averageOrderValueMinor: 2_400_000,
      netProceedsOverRecordedCostMinor: 8_270_000, // 9,120,000 − 850,000 recorded costs
    });
    expect(m.grossSalesMinor - m.platformCommissionMinor).toBe(m.estimatedNetProceedsMinor);
    expect(m.netProceedsReleasedMinor + m.netProceedsPendingMinor).toBe(
      m.estimatedNetProceedsMinor,
    );
    // independent recomputation straight from the raw collection
    const raw = await Order.collection
      .find({
        farmId: fx.F,
        paidAt: { $gte: ago(60) },
        status: { $in: ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
      })
      .toArray();
    expect(raw.reduce((a: number, o: any) => a + o.itemsMinor, 0)).toBe(m.grossSalesMinor);
    expect(raw.reduce((a: number, o: any) => a + o.platformFeeMinor, 0)).toBe(
      m.platformCommissionMinor,
    );
    expect(raw.reduce((a: number, o: any) => a + o.sellerPayoutMinor, 0)).toBe(
      m.estimatedNetProceedsMinor,
    );
    // the series add up to the totals
    const sum = (k: string) =>
      res.body.sections.sales.series[k].reduce((a: number, p: any) => a + p.value, 0);
    expect(sum('grossSales')).toBe(m.grossSalesMinor);
    expect(sum('netProceeds')).toBe(m.estimatedNetProceedsMinor);
    expect(res.body.sections.sales.tables.recentOrders.rows).toHaveLength(8);
    expect(res.body.sections.sales.notes.join(' ')).toContain('not profit');
  });

  it('products: stock alerts, units and gross from shop order lines (which equal the shop part of gross sales)', async () => {
    const res = await dash(fx.owner);
    expect(metrics(res, 'products')).toEqual({
      activeProducts: 3,
      pendingReviewProducts: 1,
      outOfStockProducts: 1,
      lowStockProducts: 1,
      unitsSold: 2,
      productGrossSalesMinor: 600_000,
    });
    const shopOnly = await dash(fx.owner, '&orderKind=product');
    expect(metrics(shopOnly, 'sales').grossSalesMinor).toBe(600_000);
    expect(metrics(shopOnly, 'sales').grossSalesMinor).toBe(
      metrics(res, 'products').productGrossSalesMinor,
    );
    expect(metrics(await dash(fx.owner, '&orderKind=animal'), 'sales').grossSalesMinor).toBe(
      9_000_000,
    );
  });

  it('AI assessments: counts by review and confidence', async () => {
    expect(metrics(await dash(fx.owner), 'assessments')).toEqual({
      assessmentsInRange: 3,
      assessmentsPending: 1,
      assessmentsAccepted: 1,
      assessmentsDismissed: 1,
      withPriceRange: 2,
      lowConfidence: 1,
      highConfidence: 1,
    });
  });

  it('every metric returned has a definition, and the definitions are complete and honest about money', async () => {
    const res = await dash(fx.owner);
    const keys: string[] = [];
    for (const [name, sec] of Object.entries<any>(res.body.sections))
      for (const k of Object.keys(sec.metrics)) keys.push(`farm.${name}.${k}`);
    expect(keys.length).toBeGreaterThan(40);
    for (const k of keys) {
      const d = res.body.definitions[k];
      expect(d, k).toBeTruthy();
      for (const f of [
        'label',
        'definition',
        'formula',
        'includes',
        'excludes',
        'source',
        'unit',
        'timeBasis',
      ])
        expect(String(d[f] ?? ''), `${k}.${f}`).not.toBe('');
    }
    expect(Object.keys(res.body.definitions).sort()).toEqual([...keys].sort()); // only what was returned
    const all = DEFINITIONS.map((d) => d.key);
    expect(new Set(all).size).toBe(all.length);
    const net = res.body.definitions['farm.sales.estimatedNetProceedsMinor'];
    expect(net.caveats).toMatch(/not profit/i);
    expect(res.body.definitions['farm.sales.netProceedsOverRecordedCostMinor'].caveats).toMatch(
      /NOT PROFIT/,
    );
    expect(res.body.definitions['farm.sales.grossSalesMinor'].excludes).toMatch(/refund/i);
    expect(res.body.definitions['farm.sales.shippingCollectedMinor'].definition).toMatch(
      /Kept apart/,
    );
    const defs = (await get(fx.owner, '/analytics/definitions')).body.definitions;
    expect(defs.length).toBe(DEFINITIONS.length);
    expect((await request(h.app).get(`${API}/analytics/definitions`)).status).toBe(401);
  });
});

describe('farm dashboard: filters and date ranges', () => {
  it('a narrower range changes the figures; the dates are inclusive in Thailand time', async () => {
    const last3 = await get(
      fx.owner,
      `/farms/${fx.farmId}/dashboard?from=${ago(3).toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}&sections=sales,costs`,
    );
    // only the SHIPPED (2d ago) and shop (3d ago, may fall on the boundary day) orders can fall in the last 3-4 days
    const m = metrics(last3, 'sales');
    expect(m.grossSalesMinor).toBeLessThan(9_600_000);
    expect(m.grossSalesMinor).toBeGreaterThanOrEqual(2_000_000);
    expect(last3.body.meta).toMatchObject({ timezone: 'Asia/Bangkok' });
    const wide = await get(
      fx.owner,
      `/farms/${fx.farmId}/dashboard?from=${ago(120).toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}&sections=sales`,
    );
    expect(metrics(wide, 'sales').grossSalesMinor).toBe(9_600_000 + 7_000_000); // the 90-day-old delivered order joins
    const future = await get(
      fx.owner,
      `/farms/${fx.farmId}/dashboard?from=2099-01-01&to=2099-01-31&sections=sales,costs`,
    );
    expect(metrics(future, 'sales')).toMatchObject({
      grossSalesMinor: 0,
      ordersPaid: 0,
      averageOrderValueMinor: null,
    });
    expect(metrics(future, 'costs').recordedCostMinor).toBe(0);
  });

  it('granularity shapes the series (zero-filled) and never the totals', async () => {
    const base = `/farms/${fx.farmId}/dashboard?from=${ago(59).toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}&sections=sales`;
    const day = (await get(fx.owner, `${base}&granularity=day`)).body.sections.sales;
    const week = (await get(fx.owner, `${base}&granularity=week`)).body.sections.sales;
    const month = (await get(fx.owner, `${base}&granularity=month`)).body.sections.sales;
    expect(day.series.grossSales.length).toBe(60);
    expect(week.series.grossSales.length).toBeGreaterThanOrEqual(8);
    expect(week.series.grossSales.length).toBeLessThanOrEqual(10);
    expect(month.series.grossSales.length).toBeGreaterThanOrEqual(2);
    for (const s of [day, week, month]) {
      expect(s.series.grossSales.reduce((a: number, p: any) => a + p.value, 0)).toBe(9_600_000);
      expect(s.metrics.grossSalesMinor).toBe(9_600_000);
    }
    expect(day.series.grossSales.filter((p: any) => p.value === 0).length).toBeGreaterThan(50); // empty days are present
  });

  it('the animal-type filter narrows animals, growth, health, feeding, costs and assessments (and says what it leaves out)', async () => {
    const res = await dash(fx.owner, '&animalType=cattle');
    expect(metrics(res, 'animals')).toEqual({ animalsOnFarm: 2, totalRecorded: 2 });
    expect(metrics(res, 'growth')).toMatchObject({
      weighingsInRange: 1,
      animalsWeighed: 1,
      animalsWithGainEstimate: 0,
      averageDailyGainG: null,
    });
    expect(metrics(res, 'health')).toMatchObject({
      healthRecordsInRange: 1,
      vaccinationRecords: 1,
      illnessRecords: 0,
      withdrawalsRunning: 0,
    });
    expect(metrics(res, 'feeding')).toMatchObject({ feedingLogsInRange: 0 });
    expect(metrics(res, 'costs')).toMatchObject({ recordedCostMinor: 0, farmWideCostMinor: 0 }); // no cost is assigned to cattle; farm-wide costs are left out
    expect(res.body.sections.costs.notes.join(' ')).toContain('farm-wide costs are left out');
    expect(metrics(res, 'assessments').assessmentsInRange).toBe(1);
    expect(res.body.meta.filters).toEqual({ animalType: 'cattle' });
    const buffalo = await dash(fx.owner, '&animalType=buffalo');
    expect(metrics(buffalo, 'animals').animalsOnFarm).toBe(3);
    expect(metrics(buffalo, 'costs').recordedCostMinor).toBe(750_000);
    expect((await dash(fx.owner, '&animalType=unicorn')).status).toBe(400);
  });

  it('validates every query parameter', async () => {
    for (const qs of [
      '&granularity=hour',
      '&orderKind=cow',
      '&sections=sales,secrets',
      '&unknown=1',
      '&fresh=maybe',
      '&animalType=Bad Key',
    ])
      expect((await dash(fx.owner, qs)).status, qs).toBe(400);
    expect(
      (await get(fx.owner, `/farms/${fx.farmId}/dashboard?from=2026-02-31&to=2026-03-01`)).status,
    ).toBe(400);
    expect(
      (await get(fx.owner, `/farms/${fx.farmId}/dashboard?from=2026-03-10&to=2026-03-01`)).status,
    ).toBe(400);
    expect(
      (await get(fx.owner, `/farms/${fx.farmId}/dashboard?from=2020-01-01&to=2026-03-01`)).status,
    ).toBe(400);
    expect(
      (
        await get(
          fx.owner,
          `/farms/${fx.farmId}/dashboard?from=2026-01-01&to=2026-06-30&granularity=day`,
        )
      ).status,
    ).toBe(400);
    const only = await dash(fx.owner, '&sections=animals,costs');
    expect(Object.keys(only.body.sections).sort()).toEqual(['animals', 'costs']);
  });
});

describe('farm dashboard: authorization and data scoping', () => {
  it('only members see a farm; strangers and other farms’ owners get 404; anonymous 401', async () => {
    const stranger = await createUser(h.app);
    expect((await dash(stranger)).status).toBe(404);
    expect((await get(fx.other.owner, `/farms/${fx.farmId}/dashboard`)).status).toBe(404);
    expect((await request(h.app).get(`${API}/farms/${fx.farmId}/dashboard`)).status).toBe(401);
    expect((await get(stranger, `/farms/${fx.farmId}/dashboard/export?section=costs`)).status).toBe(
      404,
    );
  });

  it('sections follow farm permissions: workers and viewers get no costs or sales — the section says why and carries no data', async () => {
    for (const who of [fx.worker, fx.viewer]) {
      const res = await dash(who);
      expect(res.status).toBe(200);
      for (const s of ['costs', 'sales', 'listings', 'products'])
        expect(res.body.sections[s]).toMatchObject({
          available: false,
          metrics: {},
          tables: {},
          series: {},
        });
      expect(res.body.sections.costs.reason).toContain('permission');
      for (const s of ['animals', 'growth', 'health', 'feeding', 'assessments'])
        expect(res.body.sections[s].available, s).toBe(true);
      const json = JSON.stringify(res.body);
      for (const secret of [
        '850000',
        '9600000',
        '500000',
        '4000000',
        'OTHER FARM SECRET',
        '123456700',
        'HYPERLINK',
      ])
        expect(json, secret).not.toContain(secret);
    }
    const mgr = await dash(fx.manager);
    for (const s of ['costs', 'sales', 'listings', 'products'])
      expect(mgr.body.sections[s].available, s).toBe(true);
  });

  it('platform staff can read the same non-financial sections a viewer can, but never costs or sales', async () => {
    const staff = await get(reader, `/farms/${fx.farmId}/dashboard`);
    expect(staff.status).toBe(200);
    expect(staff.body.sections.costs.available).toBe(false);
    expect(staff.body.sections.sales.available).toBe(false);
    expect(staff.body.sections.animals.available).toBe(true);
  });

  it('no figure from another farm ever appears, whatever the filters', async () => {
    for (const qs of ['', '&orderKind=animal', '&animalType=buffalo', '&granularity=week']) {
      const json = JSON.stringify((await dash(fx.owner, qs)).body);
      for (const leak of [
        '123456700',
        '123456',
        '42424200',
        '6172835',
        'OTHER-1',
        'OTHER FARM SECRET',
        '117283865',
      ])
        expect(json, `${qs} ${leak}`).not.toContain(leak);
    }
    // and the other owner sees only their own
    const theirs = await get(
      fx.other.owner,
      `/farms/${fx.other.farmId}/dashboard?from=${ago(60).toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}&sections=sales,costs,animals`,
    );
    expect(metrics(theirs, 'sales').grossSalesMinor).toBe(123_456_700);
    expect(metrics(theirs, 'costs').recordedCostMinor).toBe(42_424_200);
    expect(metrics(theirs, 'animals').totalRecorded).toBe(1);
    expect(JSON.stringify(theirs.body)).not.toContain('9600000');
  });
});

describe('CSV export respects the dashboard’s permissions, scope and filters', () => {
  const csv = (s: Session, section: string, qs = '') =>
    get(
      s,
      `/farms/${fx.farmId}/dashboard/export?section=${section}&from=${ago(60).toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}${qs}`,
    );
  const parse = (text: string) =>
    text
      .replace(BOM, '')
      .trim()
      .split('\r\n')
      .map((l) => l.split(','));

  it('is allowed exactly where the matching dashboard section is — and refused (403) otherwise', async () => {
    for (const section of ['costs', 'orders']) {
      expect((await csv(fx.worker, section)).status, `worker ${section}`).toBe(403);
      expect((await csv(fx.viewer, section)).status, `viewer ${section}`).toBe(403);
      expect((await csv(reader, section)).status, `staff ${section}`).toBe(403);
      expect((await csv(fx.manager, section)).status, `manager ${section}`).toBe(200);
    }
    for (const section of ['animals', 'growth', 'health', 'feeding', 'assessments']) {
      expect((await csv(fx.worker, section)).status, section).toBe(200);
      expect((await csv(fx.viewer, section)).status, section).toBe(200);
    }
    expect((await csv(fx.owner, 'secrets')).status).toBe(400);
    expect(
      (await request(h.app).get(`${API}/farms/${fx.farmId}/dashboard/export?section=costs`)).status,
    ).toBe(401);
    expect((await csv(await createUser(h.app), 'costs')).status).toBe(404);
  });

  it('costs and orders exports add up to the dashboard figures; only this farm’s rows appear', async () => {
    const dashboard = await dash(fx.owner);
    const costs = await csv(fx.owner, 'costs');
    expect(costs.headers['content-type']).toContain('text/csv');
    expect(costs.headers['content-disposition']).toMatch(
      /^attachment; filename="costs_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(costs.headers['cache-control']).toBe('no-store');
    expect(costs.headers['x-content-type-options']).toBe('nosniff');
    expect(costs.text.charCodeAt(0)).toBe(0xfeff);
    const rows = parse(costs.text);
    expect(rows[0]).toEqual([
      'Date',
      'Category',
      'Amount (THB)',
      'Animal code',
      'Assigned to an animal',
      'Description',
      'Supplier',
    ]);
    const total = rows.slice(1).reduce((a, r) => a + Math.round(Number(r[2]) * 100), 0);
    expect(total).toBe(metrics(dashboard, 'costs').recordedCostMinor);
    expect(costs.text).not.toContain('OTHER FARM SECRET');
    // a spreadsheet formula in a description is neutralised
    expect(costs.text).toContain(`"'=HYPERLINK(""http://evil.example"",""pay"")"`);
    expect(costs.text).not.toMatch(/(^|,)=HYPERLINK/m);

    const orders = parse((await csv(fx.owner, 'orders')).text);
    expect(orders[0]).toEqual([
      'Order',
      'Placed',
      'Paid',
      'Type',
      'Status',
      'Fulfilment',
      'Items',
      'Gross items (THB)',
      'Shipping (THB)',
      'Platform fee (THB)',
      'Net proceeds (THB)',
      'Counted in gross sales',
    ]);
    const counted = orders.slice(1).filter((r) => r[11] === 'yes');
    expect(counted.reduce((a, r) => a + Math.round(Number(r[7]) * 100), 0)).toBe(
      metrics(dashboard, 'sales').grossSalesMinor,
    );
    expect(counted.reduce((a, r) => a + Math.round(Number(r[9]) * 100), 0)).toBe(
      metrics(dashboard, 'sales').platformCommissionMinor,
    );
    expect(orders.length - 1).toBe(8); // every order placed or paid in the dates, no more
    expect((await csv(fx.owner, 'orders')).text).not.toMatch(/buyer|address|phone/i);
    expect(
      orders
        .slice(1)
        .filter((r) => r[4] === 'REFUNDED' || r[4] === 'CANCELLED')
        .every((r) => r[11] === 'no'),
    ).toBe(true);
  });

  it('follows the same filters; carries no free-text health details; and every export is audited', async () => {
    const weights = parse((await csv(fx.owner, 'growth', '&animalType=cattle')).text);
    expect(weights.slice(1)).toHaveLength(1);
    expect(weights[1]![1]).toBe('C1');
    const health = (await csv(fx.owner, 'health')).text;
    expect(health).not.toContain('Secret health title');
    expect(health.split('\r\n')[0]).toBe(
      '﻿Date,Animal code,Type,Severity,Outcome,Withdrawal ends,Next due',
    );
    const before = await AuditLog.countDocuments({
      action: 'analytics.export',
      targetId: String(fx.F),
    });
    await csv(fx.owner, 'animals');
    const logs = await AuditLog.find({ action: 'analytics.export', targetId: String(fx.F) }).sort({
      createdAt: -1,
    });
    expect(logs.length).toBe(before + 1);
    expect(logs[0]!.metadata).toMatchObject({ section: 'animals', rows: 6 });
    expect(logs[0]!.actorId?.toString()).toBe(fx.ownerId);
  });
});

describe('cache', () => {
  const url = () =>
    `/farms/${fx.farmId}/dashboard?from=${ago(60).toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}&sections=costs,animals`;
  it('reuses a recent report (labelled), can be bypassed with fresh=true, and can be switched off', async () => {
    reportCache.clear();
    await Setting.updateOne({ key: 'analytics.cacheSeconds' }, { $set: { value: 60 } });
    const a = await get(fx.owner, url());
    expect(a.body.meta).toMatchObject({ cached: false, cacheTtlSeconds: 60 });
    await FarmExpense.create({
      farmId: fx.F,
      createdBy: fx.ownerId,
      category: 'other',
      expenseDate: ago(1),
      amountMinor: 1_000,
      description: 'late',
      animalId: null,
    } as never);
    const b = await get(fx.owner, url());
    expect(b.body.meta).toMatchObject({ cached: true, generatedAt: a.body.meta.generatedAt });
    expect(metrics(b, 'costs').recordedCostMinor).toBe(850_000); // still the cached figure…
    const c = await get(fx.owner, `${url()}&fresh=true`);
    expect(c.body.meta.cached).toBe(false);
    expect(metrics(c, 'costs').recordedCostMinor).toBe(851_000); // …until recalculated
    expect(metrics(await get(fx.owner, url()), 'costs').recordedCostMinor).toBe(851_000); // and the fresh result is what is cached now
    await FarmExpense.deleteOne({ description: 'late' });
    await Setting.updateOne({ key: 'analytics.cacheSeconds' }, { $set: { value: 0 } });
    const d = await get(fx.owner, url());
    expect(d.body.meta).toMatchObject({ cached: false, cacheTtlSeconds: 0 });
    expect(metrics(d, 'costs').recordedCostMinor).toBe(850_000);
  });

  it('keys include the exact range, filters and what the caller may see: one user’s report is never served to another with different rights', async () => {
    reportCache.clear();
    await Setting.updateOne({ key: 'analytics.cacheSeconds' }, { $set: { value: 60 } });
    const owner = await get(fx.owner, url());
    expect(owner.body.sections.costs.available).toBe(true);
    const worker = await get(fx.worker, url()); // same farm, same range — but no right to costs
    expect(worker.body.sections.costs).toMatchObject({ available: false, metrics: {} });
    expect(JSON.stringify(worker.body)).not.toContain('850000');
    const ownerAgain = await get(fx.owner, url());
    expect(ownerAgain.body.meta.cached).toBe(true);
    expect(ownerAgain.body.sections.costs.available).toBe(true);
    // a different range or filter is a different report
    const narrower = await get(fx.owner, `${url()}&animalType=cattle`);
    expect(narrower.body.meta.cached).toBe(false);
    // authorisation is checked before the cache: a stranger gets 404 even though an answer is cached
    expect((await get(await createUser(h.app), url())).status).toBe(404);
    // other farm: separate key
    const otherUrl = `/farms/${fx.other.farmId}/dashboard?from=${ago(60).toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}&sections=costs,animals`;
    expect(metrics(await get(fx.other.owner, otherUrl), 'costs').recordedCostMinor).toBe(
      42_424_200,
    );
    await Setting.updateOne({ key: 'analytics.cacheSeconds' }, { $set: { value: 0 } });
  });
});

describe('aggregation pipelines are index-supported', () => {
  it('start from an indexed match and never scan a whole collection', async () => {
    const range = resolveRange({
      from: ago(60).toISOString().slice(0, 10),
      to: new Date().toISOString().slice(0, 10),
    });
    const c: FarmCtx = {
      farmId: fx.F,
      range,
      animalTypeId: null,
      animalTypeKey: null,
      orderKind: null,
      now: new Date(),
    };
    const a = { range, orderKind: null, now: new Date() } as never;
    const plans: [string, unknown][] = [
      ['sales by status', await Order.aggregate(salesByStatusPipeline(c)).explain('queryPlanner')],
      ['sales series', await Order.aggregate(salesSeriesPipeline(c)).explain('queryPlanner')],
      ['orders created', await Order.aggregate(ordersCreatedPipeline(c)).explain('queryPlanner')],
      ['product lines', await Order.aggregate(productLinesPipeline(c)).explain('queryPlanner')],
      ['admin paid orders', await Order.aggregate(paidOrdersPipeline(a)).explain('queryPlanner')],
      ['admin payments', await Payment.aggregate(paymentsPipeline(a)).explain('queryPlanner')],
      [
        'admin ledger commission',
        await WalletTransaction.aggregate(ledgerCommissionPipeline(a)).explain('queryPlanner'),
      ],
    ];
    for (const [name, plan] of plans) {
      const text = JSON.stringify(plan);
      expect(text, name).toContain('IXSCAN');
      expect(text, name).not.toContain('COLLSCAN');
    }
  });
});
