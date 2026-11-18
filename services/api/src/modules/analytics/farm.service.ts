import type { PipelineStage, Types } from 'mongoose';
import {
  ANALYTICS_TIMEZONE,
  ANIMAL_STATUSES,
  type DashboardSection,
  type FarmDashboardDTO,
  type FarmDashboardSection,
  type Granularity,
} from '@farmplus/shared-types';
import { HttpError } from '../../lib/errors';
import {
  AiAssessment,
  Animal,
  AnimalType,
  FarmExpense,
  FeedingRecord,
  HealthRecord,
  Listing,
  Order,
  Product,
  WeightRecord,
} from '../../models';
import type { FarmAccess } from '../farms/farm-access';
import { getNumberSetting } from '../settings/settings.service';
import { reportCache } from './cache';
import { definitionsFor } from './definitions';
import { bangkokDay, bucket, fillSeries, resolveRange, type ReportRange } from './range';

/** Orders that count as sales: paid and still standing. Cancelled and refunded orders are excluded (and shown separately). */
export const SALE_STATUSES = ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] as const;
export const REFUNDED_STATUSES = ['REFUND_PENDING', 'REFUNDED'] as const;
const DAY = 86_400_000;

export interface FarmCtx {
  farmId: Types.ObjectId;
  range: ReportRange;
  animalTypeId: Types.ObjectId | null;
  animalTypeKey: string | null;
  orderKind: 'animal' | 'product' | null;
  now: Date;
}

const section = (over: Partial<DashboardSection> = {}): DashboardSection => ({
  available: true,
  metrics: {},
  tables: {},
  series: {},
  ...over,
});
const unavailable = (reason: string): DashboardSection => ({
  available: false,
  reason,
  metrics: {},
  tables: {},
  series: {},
});
const inRange = (field: string, r: ReportRange) => ({
  [field]: { $gte: r.start, $lt: r.endExclusive },
});
/** A timestamp's calendar day in Thailand. */
const day = (d: Date | null | undefined): string | null => (d ? bangkokDay(d) : null);
const pct = (num: number, den: number): number | null =>
  den === 0 ? null : Math.round((1000 * num) / den) / 10;

// ---------------------------------------------------------------------------
// Pipelines (exported so tests can verify they are index-supported). Each begins with a $match on indexed fields.
// ---------------------------------------------------------------------------
export const salesByStatusPipeline = (c: FarmCtx): PipelineStage[] => [
  {
    $match: {
      farmId: c.farmId,
      ...inRange('paidAt', c.range),
      status: { $in: [...SALE_STATUSES, ...REFUNDED_STATUSES] },
      ...(c.orderKind ? { kind: c.orderKind } : {}),
    },
  },
  {
    $group: {
      _id: '$status',
      n: { $sum: 1 },
      items: { $sum: '$itemsMinor' },
      shipping: { $sum: '$shippingMinor' },
      fee: { $sum: '$platformFeeMinor' },
      net: { $sum: '$sellerPayoutMinor' },
    },
  },
];
export const salesSeriesPipeline = (c: FarmCtx): PipelineStage[] => [
  {
    $match: {
      farmId: c.farmId,
      ...inRange('paidAt', c.range),
      status: { $in: [...SALE_STATUSES] },
      ...(c.orderKind ? { kind: c.orderKind } : {}),
    },
  },
  {
    $group: {
      _id: bucket('$paidAt', c.range.granularity),
      gross: { $sum: '$itemsMinor' },
      net: { $sum: '$sellerPayoutMinor' },
    },
  },
];
export const ordersCreatedPipeline = (c: FarmCtx): PipelineStage[] => [
  {
    $match: {
      farmId: c.farmId,
      ...inRange('createdAt', c.range),
      ...(c.orderKind ? { kind: c.orderKind } : {}),
    },
  },
  { $group: { _id: '$status', n: { $sum: 1 } } },
];
export const productLinesPipeline = (c: FarmCtx): PipelineStage[] => [
  {
    $match: {
      farmId: c.farmId,
      kind: 'product',
      ...inRange('paidAt', c.range),
      status: { $in: [...SALE_STATUSES] },
    },
  },
  { $unwind: '$items' },
  {
    $group: {
      _id: '$items.productId',
      title: { $first: '$items.title' },
      units: { $sum: '$items.quantity' },
      gross: { $sum: '$items.totalMinor' },
    },
  },
  { $sort: { gross: -1, _id: 1 } },
];

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------
async function animalIdsOfType(c: FarmCtx): Promise<Types.ObjectId[] | null> {
  if (!c.animalTypeId) return null;
  return Animal.find({ farmId: c.farmId, animalTypeId: c.animalTypeId }).distinct('_id');
}

async function animals(c: FarmCtx): Promise<DashboardSection> {
  const rows = await Animal.aggregate<{ _id: { t: Types.ObjectId; s: string }; n: number }>([
    {
      $match: {
        farmId: c.farmId,
        archivedAt: null,
        ...(c.animalTypeId ? { animalTypeId: c.animalTypeId } : {}),
      },
    },
    { $group: { _id: { t: '$animalTypeId', s: '$currentStatus' }, n: { $sum: 1 } } },
  ]);
  const types = new Map(
    (await AnimalType.find({ _id: { $in: [...new Set(rows.map((r) => String(r._id.t)))] } })).map(
      (t) => [String(t._id), t.name],
    ),
  );
  const byType = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const name = types.get(String(r._id.t)) ?? 'Unknown';
    byType.set(name, { ...(byType.get(name) ?? {}), [r._id.s]: r.n });
  }
  const table = [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, by]) => [
      name,
      ...ANIMAL_STATUSES.map((s) => by[s] ?? 0),
      ANIMAL_STATUSES.reduce((a, s) => a + (by[s] ?? 0), 0),
    ]);
  const total = rows.reduce((a, r) => a + r.n, 0);
  const onFarm = rows
    .filter((r) => r._id.s === 'active' || r._id.s === 'for_sale')
    .reduce((a, r) => a + r.n, 0);
  return section({
    metrics: { animalsOnFarm: onFarm, totalRecorded: total },
    tables: {
      byTypeAndStatus: { columns: ['Animal type', ...ANIMAL_STATUSES, 'Total'], rows: table },
    },
  });
}

async function growth(c: FarmCtx): Promise<DashboardSection> {
  const ids = await animalIdsOfType(c);
  const match = {
    farmId: c.farmId,
    voided: false,
    ...inRange('weighedOn', c.range),
    ...(ids ? { animalId: { $in: ids } } : {}),
  };
  const [perAnimal, totals, series] = await Promise.all([
    WeightRecord.aggregate<{
      _id: Types.ObjectId;
      n: number;
      firstOn: Date;
      lastOn: Date;
      firstKg: number;
      lastKg: number;
    }>([
      { $match: match },
      { $sort: { weighedOn: 1, _id: 1 } },
      {
        $group: {
          _id: '$animalId',
          n: { $sum: 1 },
          firstOn: { $first: '$weighedOn' },
          lastOn: { $last: '$weighedOn' },
          firstKg: { $first: '$weightKg' },
          lastKg: { $last: '$weightKg' },
        },
      },
    ]),
    WeightRecord.aggregate<{ _id: null; n: number; est: number }>([
      { $match: match },
      {
        $group: {
          _id: null,
          n: { $sum: 1 },
          est: { $sum: { $cond: [{ $ne: ['$method', 'scale'] }, 1, 0] } },
        },
      },
    ]),
    WeightRecord.aggregate<{ _id: string; v: number }>([
      { $match: match },
      { $group: { _id: bucket('$weighedOn', c.range.granularity), v: { $sum: 1 } } },
    ]),
  ]);
  const gains = perAnimal
    .map((a) => ({
      id: a._id,
      days: Math.floor((a.lastOn.getTime() - a.firstOn.getTime()) / DAY),
      a,
    }))
    .filter((x) => x.a.n >= 2 && x.days >= 7)
    .map((x) => ({ ...x, adg: ((x.a.lastKg - x.a.firstKg) / x.days) * 1000 }));
  const codes = new Map(
    (await Animal.find({ _id: { $in: gains.map((g) => g.id) } }).select('animalCode')).map((a) => [
      String(a._id),
      a.animalCode,
    ]),
  );
  const mean = gains.length
    ? Math.round((gains.reduce((a, g) => a + g.adg, 0) / gains.length) * 10) / 10
    : null;
  const t = totals[0];
  return section({
    metrics: {
      weighingsInRange: t?.n ?? 0,
      animalsWeighed: perAnimal.length,
      animalsWithGainEstimate: gains.length,
      averageDailyGainG: mean,
      estimatedWeightShare: t ? pct(t.est, t.n) : null,
    },
    tables: {
      gainByAnimal: {
        columns: ['Animal', 'First kg', 'Latest kg', 'Days', 'Average daily gain (g/day)'],
        rows: gains
          .sort((a, b) => b.adg - a.adg)
          .slice(0, 50)
          .map((g) => [
            codes.get(String(g.id)) ?? '?',
            g.a.firstKg,
            g.a.lastKg,
            g.days,
            Math.round(g.adg),
          ]),
      },
    },
    series: { weighings: fillSeries(c.range, series) },
  });
}

async function health(c: FarmCtx): Promise<DashboardSection> {
  const ids = await animalIdsOfType(c);
  const base = { farmId: c.farmId, voided: false, ...(ids ? { animalId: { $in: ids } } : {}) };
  const today = new Date(c.now.getTime());
  const [byType, issueAnimals, running, due, series] = await Promise.all([
    HealthRecord.aggregate<{ _id: string; n: number }>([
      { $match: { ...base, ...inRange('recordedOn', c.range) } },
      { $group: { _id: '$type', n: { $sum: 1 } } },
    ]),
    HealthRecord.distinct('animalId', {
      ...base,
      ...inRange('recordedOn', c.range),
      type: { $in: ['illness', 'treatment'] },
    }),
    HealthRecord.distinct('animalId', { ...base, withdrawalEndsOn: { $gt: today } } as never),
    HealthRecord.distinct('animalId', {
      ...base,
      nextDueOn: { $gte: today, $lte: new Date(today.getTime() + 30 * DAY) },
    } as never),
    HealthRecord.aggregate<{ _id: string; v: number }>([
      { $match: { ...base, ...inRange('recordedOn', c.range) } },
      { $group: { _id: bucket('$recordedOn', c.range.granularity), v: { $sum: 1 } } },
    ]),
  ]);
  const n = (t: string) => byType.find((x) => x._id === t)?.n ?? 0;
  return section({
    metrics: {
      healthRecordsInRange: byType.reduce((a, x) => a + x.n, 0),
      illnessRecords: n('illness'),
      treatmentRecords: n('treatment'),
      vaccinationRecords: n('vaccination'),
      animalsWithIllnessOrTreatment: issueAnimals.length,
      withdrawalsRunning: running.length,
      vaccinationsDueNext30Days: due.length,
    },
    tables: {
      byType: {
        columns: ['Type', 'Records'],
        rows: byType.sort((a, b) => b.n - a.n).map((x) => [x._id, x.n]),
      },
    },
    series: { healthRecords: fillSeries(c.range, series) },
    notes: ['Counts of what was recorded. FARM+ does not interpret health records or diagnose.'],
  });
}

async function feeding(c: FarmCtx): Promise<DashboardSection> {
  const ids = await animalIdsOfType(c);
  const match = {
    farmId: c.farmId,
    voided: false,
    kind: 'log',
    ...inRange('date', c.range),
    ...(ids ? { animalId: { $in: ids } } : {}),
  };
  const [byCat, animalsFed, group, series] = await Promise.all([
    FeedingRecord.aggregate<{ _id: string; n: number }>([
      { $match: match },
      { $group: { _id: '$category', n: { $sum: 1 } } },
    ]),
    FeedingRecord.distinct('animalId', { ...match, animalId: { $ne: null } } as never),
    FeedingRecord.countDocuments({ ...match, animalId: null } as never),
    FeedingRecord.aggregate<{ _id: string; v: number }>([
      { $match: match },
      { $group: { _id: bucket('$date', c.range.granularity), v: { $sum: 1 } } },
    ]),
  ]);
  return section({
    metrics: {
      feedingLogsInRange: byCat.reduce((a, x) => a + x.n, 0),
      animalsFed: animalsFed.length,
      groupFeedingLogs: group,
    },
    tables: {
      byCategory: {
        columns: ['Feed category', 'Logs'],
        rows: byCat.sort((a, b) => b.n - a.n).map((x) => [x._id, x.n]),
      },
    },
    series: { feedingLogs: fillSeries(c.range, series) },
  });
}

export async function costTotals(c: FarmCtx): Promise<{
  total: number;
  n: number;
  assigned: number;
  farmWide: number;
  byCat: { _id: string; total: number; n: number }[];
  series: { _id: string; v: number }[];
}> {
  const ids = await animalIdsOfType(c);
  const match = {
    farmId: c.farmId,
    voided: false,
    ...inRange('expenseDate', c.range),
    ...(ids ? { animalId: { $in: ids } } : {}),
  };
  const [byCat, split, series] = await Promise.all([
    FarmExpense.aggregate<{ _id: string; total: number; n: number }>([
      { $match: match },
      { $group: { _id: '$category', total: { $sum: '$amountMinor' }, n: { $sum: 1 } } },
    ]),
    FarmExpense.aggregate<{ _id: boolean; total: number }>([
      { $match: match },
      { $group: { _id: { $ne: ['$animalId', null] }, total: { $sum: '$amountMinor' } } },
    ]),
    FarmExpense.aggregate<{ _id: string; v: number }>([
      { $match: match },
      { $group: { _id: bucket('$expenseDate', c.range.granularity), v: { $sum: '$amountMinor' } } },
    ]),
  ]);
  return {
    total: byCat.reduce((a, x) => a + x.total, 0),
    n: byCat.reduce((a, x) => a + x.n, 0),
    assigned: split.find((s) => s._id)?.total ?? 0,
    farmWide: split.find((s) => !s._id)?.total ?? 0,
    byCat,
    series,
  };
}
async function costs(c: FarmCtx): Promise<DashboardSection> {
  const t = await costTotals(c);
  return section({
    metrics: {
      recordedCostMinor: t.total,
      expenseRecords: t.n,
      costAssignedToAnimalsMinor: t.assigned,
      farmWideCostMinor: t.farmWide,
    },
    tables: {
      byCategory: {
        columns: ['Category', 'Records', 'Amount'],
        rows: t.byCat.sort((a, b) => b.total - a.total).map((x) => [x._id, x.n, x.total]),
        moneyColumns: [2],
      },
    },
    series: { recordedCosts: fillSeries(c.range, t.series) },
    notes: c.animalTypeId
      ? [
          'With an animal-type filter, only costs assigned to animals of that type are counted; farm-wide costs are left out.',
        ]
      : [],
  });
}

async function listings(c: FarmCtx): Promise<DashboardSection> {
  const [byStatus, created] = await Promise.all([
    Listing.aggregate<{ _id: string; n: number }>([
      { $match: { farmId: c.farmId } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
    Listing.countDocuments({ farmId: c.farmId, ...inRange('createdAt', c.range) }),
  ]);
  const n = (s: string) => byStatus.find((x) => x._id === s)?.n ?? 0;
  return section({
    metrics: {
      activeListings: n('ACTIVE'),
      reservedListings: n('RESERVED'),
      pendingReviewListings: n('PENDING_REVIEW'),
      listingsCreatedInRange: created,
    },
    tables: {
      byStatus: {
        columns: ['Status', 'Listings'],
        rows: byStatus.sort((a, b) => b.n - a.n).map((x) => [x._id, x.n]),
      },
    },
  });
}

async function sales(c: FarmCtx, withCosts: boolean): Promise<DashboardSection> {
  const [byStatus, created, series, recent] = await Promise.all([
    Order.aggregate<{
      _id: string;
      n: number;
      items: number;
      shipping: number;
      fee: number;
      net: number;
    }>(salesByStatusPipeline(c)),
    Order.aggregate<{ _id: string; n: number }>(ordersCreatedPipeline(c)),
    Order.aggregate<{ _id: string; gross: number; net: number }>(salesSeriesPipeline(c)),
    Order.find({
      farmId: c.farmId,
      ...inRange('createdAt', c.range),
      ...(c.orderKind ? { kind: c.orderKind } : {}),
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(20),
  ]);
  const stand = byStatus.filter((r) => (SALE_STATUSES as readonly string[]).includes(r._id));
  const sum = (k: 'n' | 'items' | 'shipping' | 'fee' | 'net', rows = stand) =>
    rows.reduce((a, r) => a + r[k], 0);
  const gross = sum('items');
  const net = sum('net');
  const paid = sum('n');
  const refunded = byStatus
    .filter((r) => (REFUNDED_STATUSES as readonly string[]).includes(r._id))
    .reduce((a, r) => a + r.items, 0);
  const costTotal = withCosts ? (await costTotals(c)).total : null;
  const sg = (rows: typeof series, k: 'gross' | 'net') =>
    fillSeries(
      c.range,
      rows.map((r) => ({ _id: r._id, v: r[k] })),
    );
  return section({
    metrics: {
      ordersCreated: created.reduce((a, r) => a + r.n, 0),
      ordersPaid: paid,
      grossSalesMinor: gross,
      shippingCollectedMinor: sum('shipping'),
      platformCommissionMinor: sum('fee'),
      estimatedNetProceedsMinor: net,
      netProceedsReleasedMinor: sum(
        'net',
        stand.filter((r) => r._id === 'DELIVERED'),
      ),
      netProceedsPendingMinor: sum(
        'net',
        stand.filter((r) => r._id !== 'DELIVERED'),
      ),
      refundedGrossMinor: refunded,
      cancelledOrders: created.find((r) => r._id === 'CANCELLED')?.n ?? 0,
      averageOrderValueMinor: paid ? Math.round(gross / paid) : null,
      // Sales are farm-wide; with an animal-type filter costs are not, so the two cannot be netted.
      netProceedsOverRecordedCostMinor:
        costTotal === null || c.animalTypeId ? null : net - costTotal,
    },
    tables: {
      ordersByStatus: {
        columns: ['Status', 'Orders placed'],
        rows: created.sort((a, b) => b.n - a.n).map((r) => [r._id, r.n]),
      },
      recentOrders: {
        columns: [
          'Order',
          'Placed',
          'Type',
          'Status',
          'Items',
          'Gross (items)',
          'Platform fee',
          'Net proceeds',
        ],
        rows: recent.map((o) => [
          o.orderNo,
          day(o.createdAt),
          o.kind,
          o.status,
          (o.items as unknown as unknown[]).length,
          o.itemsMinor,
          o.platformFeeMinor,
          o.sellerPayoutMinor,
        ]),
        moneyColumns: [5, 6, 7],
      },
    },
    series: { grossSales: sg(series, 'gross'), netProceeds: sg(series, 'net') },
    notes: [
      'Statuses are as of now: an order paid in these dates and refunded later is excluded.',
      'Estimated net proceeds are before shipping costs, provider fees and taxes, and are not profit.',
      ...(c.animalTypeId
        ? [
            'The animal-type filter does not apply to sales: these figures cover every order of the farm.',
          ]
        : []),
    ],
  });
}

async function products(c: FarmCtx): Promise<DashboardSection> {
  const [byStatus, lines] = await Promise.all([
    Product.aggregate<{ _id: string; n: number; out: number; low: number }>([
      { $match: { farmId: c.farmId } },
      {
        $group: {
          _id: '$status',
          n: { $sum: 1 },
          out: { $sum: { $cond: [{ $lte: [{ $subtract: ['$stock', '$reserved'] }, 0] }, 1, 0] } },
          low: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$lowStockThreshold', null] },
                    { $gt: [{ $subtract: ['$stock', '$reserved'] }, 0] },
                    { $lte: [{ $subtract: ['$stock', '$reserved'] }, '$lowStockThreshold'] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
    Order.aggregate<{ _id: Types.ObjectId; title: string; units: number; gross: number }>(
      productLinesPipeline(c),
    ),
  ]);
  const active = byStatus.find((s) => s._id === 'ACTIVE');
  return section({
    metrics: {
      activeProducts: active?.n ?? 0,
      pendingReviewProducts: byStatus.find((s) => s._id === 'PENDING_REVIEW')?.n ?? 0,
      outOfStockProducts: active?.out ?? 0,
      lowStockProducts: active?.low ?? 0,
      unitsSold: lines.reduce((a, l) => a + l.units, 0),
      productGrossSalesMinor: lines.reduce((a, l) => a + l.gross, 0),
    },
    tables: {
      topProducts: {
        columns: ['Product', 'Units', 'Gross (items)'],
        rows: lines.slice(0, 10).map((l) => [l.title, l.units, l.gross]),
        moneyColumns: [2],
      },
    },
  });
}

async function assessments(c: FarmCtx): Promise<DashboardSection> {
  const ids = await animalIdsOfType(c);
  const rows = await AiAssessment.aggregate<{
    _id: null;
    n: number;
    pending: number;
    accepted: number;
    dismissed: number;
    range: number;
    low: number;
    high: number;
  }>([
    {
      $match: {
        farmId: c.farmId,
        ...inRange('assessmentDate', c.range),
        ...(ids ? { animalId: { $in: ids } } : {}),
      },
    },
    {
      $group: {
        _id: null,
        n: { $sum: 1 },
        pending: { $sum: { $cond: [{ $eq: ['$review.status', 'pending'] }, 1, 0] } },
        accepted: { $sum: { $cond: [{ $eq: ['$review.status', 'accepted'] }, 1, 0] } },
        dismissed: { $sum: { $cond: [{ $eq: ['$review.status', 'dismissed'] }, 1, 0] } },
        range: {
          $sum: {
            $cond: [{ $ne: [{ $ifNull: ['$result.estimatedPriceRange', null] }, null] }, 1, 0],
          },
        },
        low: { $sum: { $cond: [{ $eq: ['$result.confidence.level', 'low'] }, 1, 0] } },
        high: { $sum: { $cond: [{ $eq: ['$result.confidence.level', 'high'] }, 1, 0] } },
      },
    },
  ]);
  const r = rows[0];
  return section({
    metrics: {
      assessmentsInRange: r?.n ?? 0,
      assessmentsPending: r?.pending ?? 0,
      assessmentsAccepted: r?.accepted ?? 0,
      assessmentsDismissed: r?.dismissed ?? 0,
      withPriceRange: r?.range ?? 0,
      lowConfidence: r?.low ?? 0,
      highConfidence: r?.high ?? 0,
    },
    notes: ['AI assessments are decision support, not advice.'],
  });
}

// ---------------------------------------------------------------------------
// Orchestration: authorisation first, cache second, computation last
// ---------------------------------------------------------------------------
const need: Record<FarmDashboardSection, { perms: string[]; reason: string }> = {
  animals: {
    perms: ['animals.read'],
    reason: 'You do not have permission to see animals on this farm.',
  },
  growth: {
    perms: ['records.read'],
    reason: 'You do not have permission to read this farm’s records.',
  },
  health: {
    perms: ['records.read'],
    reason: 'You do not have permission to read this farm’s records.',
  },
  feeding: {
    perms: ['records.read'],
    reason: 'You do not have permission to read this farm’s records.',
  },
  costs: {
    perms: ['expenses.read'],
    reason: 'You do not have permission to see this farm’s expenses.',
  },
  listings: {
    perms: ['listings.manage'],
    reason: 'Selling information is for the farm’s owners and managers.',
  },
  sales: {
    perms: ['listings.manage'],
    reason: 'Selling information is for the farm’s owners and managers.',
  },
  products: {
    perms: ['listings.manage'],
    reason: 'Selling information is for the farm’s owners and managers.',
  },
  assessments: {
    perms: ['animals.read'],
    reason: 'You do not have permission to see animals on this farm.',
  },
};

export const allowedFarmSections = (access: FarmAccess): FarmDashboardSection[] =>
  (Object.keys(need) as FarmDashboardSection[]).filter((s) =>
    need[s].perms.every((p) => access.permissions.has(p as never)),
  );

export interface FarmQuery {
  from?: string | undefined;
  to?: string | undefined;
  granularity?: Granularity | undefined;
  animalType?: string | undefined;
  orderKind?: 'animal' | 'product' | undefined;
  sections?: FarmDashboardSection[] | undefined;
  fresh?: boolean | undefined;
}

export async function buildFarmContext(
  access: FarmAccess,
  q: FarmQuery,
  now = new Date(),
): Promise<FarmCtx> {
  const range = resolveRange(q, now);
  let animalTypeId: Types.ObjectId | null = null;
  if (q.animalType) {
    const t = await AnimalType.findOne({ key: q.animalType });
    if (!t)
      throw new HttpError(400, 'VALIDATION_ERROR', 'Unknown animal type', [
        { path: 'animalType', message: 'Unknown animal type' },
      ]);
    animalTypeId = t._id;
  }
  return {
    farmId: access.farm._id,
    range,
    animalTypeId,
    animalTypeKey: q.animalType ?? null,
    orderKind: q.orderKind ?? null,
    now,
  };
}

export async function farmDashboard(
  access: FarmAccess,
  q: FarmQuery,
  now = new Date(),
): Promise<FarmDashboardDTO> {
  const c = await buildFarmContext(access, q, now);
  const allowed = allowedFarmSections(access);
  const wanted = q.sections?.length ? q.sections : (Object.keys(need) as FarmDashboardSection[]);
  // Authorisation is decided BEFORE the cache is consulted, and the cache key includes exactly what this caller may see.
  const visible = wanted.filter((s) => allowed.includes(s));
  const ttl = await getNumberSetting('analytics.cacheSeconds', 0, 3600);
  const key = JSON.stringify([
    'farm',
    String(c.farmId),
    c.range.from,
    c.range.to,
    c.range.granularity,
    c.animalTypeKey,
    c.orderKind,
    wanted,
    visible,
    allowed.includes('costs'),
  ]);
  const hit = !q.fresh && ttl > 0 ? reportCache.get(key, ttl * 1000) : undefined;
  if (hit)
    return {
      ...(hit.value as FarmDashboardDTO),
      meta: { ...(hit.value as FarmDashboardDTO).meta, cached: true },
    };

  const withCosts = allowed.includes('costs');
  const run: Record<FarmDashboardSection, () => Promise<DashboardSection>> = {
    animals: () => animals(c),
    growth: () => growth(c),
    health: () => health(c),
    feeding: () => feeding(c),
    costs: () => costs(c),
    listings: () => listings(c),
    sales: () => sales(c, withCosts),
    products: () => products(c),
    assessments: () => assessments(c),
  };
  const sections: Partial<Record<FarmDashboardSection, DashboardSection>> = {};
  await Promise.all(
    wanted.map(async (s) => {
      sections[s] = visible.includes(s) ? await run[s]() : unavailable(need[s].reason);
    }),
  );
  const dto: FarmDashboardDTO = {
    meta: {
      generatedAt: now.toISOString(),
      cached: false,
      cacheTtlSeconds: ttl,
      from: c.range.from,
      to: c.range.to,
      granularity: c.range.granularity,
      timezone: ANALYTICS_TIMEZONE,
      filters: {
        ...(c.animalTypeKey ? { animalType: c.animalTypeKey } : {}),
        ...(c.orderKind ? { orderKind: c.orderKind } : {}),
      },
    },
    sections,
    definitions: definitionsFor(
      'farm',
      sections as Record<string, { metrics: Record<string, unknown> }>,
    ),
  };
  if (ttl > 0) reportCache.set(key, dto);
  return dto;
}
