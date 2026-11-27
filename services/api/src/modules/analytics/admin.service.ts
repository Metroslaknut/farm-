import type { PipelineStage } from 'mongoose';
import {
  ANALYTICS_TIMEZONE,
  type AdminDashboardDTO,
  type AdminDashboardSection,
  type DashboardAlert,
  type DashboardSection,
  type Granularity,
} from '@farmplus/shared-types';
import {
  ContentReport,
  Farm,
  Listing,
  Order,
  Payment,
  Product,
  Refund,
  Registration,
  User,
  Wallet,
  WalletTransaction,
  Withdrawal,
} from '../../models';
import { getNumberSetting } from '../settings/settings.service';
import { reportCache } from './cache';
import { definitionsFor } from './definitions';
import { REFUNDED_STATUSES, SALE_STATUSES } from './farm.service';
import { bucket, fillSeries, resolveRange, type ReportRange } from './range';

const HOUR = 3_600_000;
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
const pct = (num: number, den: number): number | null =>
  den === 0 ? null : Math.round((1000 * num) / den) / 10;

export interface AdminCtx {
  range: ReportRange;
  orderKind: 'animal' | 'product' | null;
  now: Date;
}

// Pipelines (exported for the index-use tests)
export const paidOrdersPipeline = (c: AdminCtx): PipelineStage[] => [
  {
    $match: {
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
      total: { $sum: '$grandTotalMinor' },
      fee: { $sum: '$platformFeeMinor' },
    },
  },
];
export const paymentsPipeline = (c: AdminCtx): PipelineStage[] => [
  { $match: inRange('createdAt', c.range) },
  {
    $group: {
      _id: { s: '$status', d: { $ifNull: ['$disposition', 'none'] } },
      n: { $sum: 1 },
      received: { $sum: { $ifNull: ['$receivedMinor', 0] } },
    },
  },
];
export const ledgerCommissionPipeline = (c: AdminCtx): PipelineStage[] => [
  { $match: { walletKind: 'platform', ...inRange('createdAt', c.range) } },
  { $group: { _id: null, net: { $sum: '$amountMinor' } } },
];

async function users(c: AdminCtx): Promise<DashboardSection> {
  const [byStatus, created, series] = await Promise.all([
    User.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    User.countDocuments(inRange('createdAt', c.range)),
    User.aggregate<{ _id: string; v: number }>([
      { $match: inRange('createdAt', c.range) },
      { $group: { _id: bucket('$createdAt', c.range.granularity), v: { $sum: 1 } } },
    ]),
  ]);
  const n = (s: string) => byStatus.find((x) => x._id === s)?.n ?? 0;
  return section({
    metrics: {
      totalUsers: byStatus.reduce((a, x) => a + x.n, 0),
      newUsersInRange: created,
      activeUsers: n('active'),
      suspendedUsers: n('suspended'),
    },
    series: { newUsers: fillSeries(c.range, series) },
    tables: {
      byStatus: {
        columns: ['Status', 'Accounts'],
        rows: byStatus.sort((a, b) => b.n - a.n).map((x) => [x._id, x.n]),
      },
    },
  });
}

async function registrations(c: AdminCtx): Promise<DashboardSection> {
  const [byStatus, pending, series] = await Promise.all([
    Registration.aggregate<{ _id: string; n: number }>([
      { $match: inRange('submittedAt', c.range) },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
    Registration.countDocuments({ status: { $in: ['PENDING', 'UNDER_REVIEW'] } }),
    Registration.aggregate<{ _id: string; v: number }>([
      { $match: inRange('submittedAt', c.range) },
      { $group: { _id: bucket('$submittedAt', c.range.granularity), v: { $sum: 1 } } },
    ]),
  ]);
  return section({
    metrics: {
      registrationsSubmitted: byStatus.reduce((a, x) => a + x.n, 0),
      registrationsApproved: byStatus.find((x) => x._id === 'APPROVED')?.n ?? 0,
      registrationsPendingNow: pending,
    },
    series: { submitted: fillSeries(c.range, series) },
    tables: {
      byStatus: {
        columns: ['Status (now)', 'Submitted in range'],
        rows: byStatus.map((x) => [x._id, x.n]),
      },
    },
  });
}

async function farms(c: AdminCtx): Promise<DashboardSection> {
  const [active, created, withSales, series] = await Promise.all([
    Farm.countDocuments({ status: 'active' }),
    Farm.countDocuments(inRange('createdAt', c.range)),
    Order.distinct('farmId', {
      ...inRange('paidAt', c.range),
      status: { $in: [...SALE_STATUSES] },
      ...(c.orderKind ? { kind: c.orderKind } : {}),
    } as never),
    Farm.aggregate<{ _id: string; v: number }>([
      { $match: inRange('createdAt', c.range) },
      { $group: { _id: bucket('$createdAt', c.range.granularity), v: { $sum: 1 } } },
    ]),
  ]);
  return section({
    metrics: {
      activeFarms: active,
      newFarmsInRange: created,
      farmsWithSalesInRange: withSales.length,
    },
    series: { newFarms: fillSeries(c.range, series) },
  });
}

async function listings(c: AdminCtx): Promise<DashboardSection> {
  const [activeListings, activeProducts, created, byStatus] = await Promise.all([
    Listing.countDocuments({ status: 'ACTIVE' }),
    Product.countDocuments({ status: 'ACTIVE' }),
    Listing.countDocuments(inRange('createdAt', c.range)),
    Listing.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  return section({
    metrics: { activeListings, activeProducts, listingsCreatedInRange: created },
    tables: {
      listingsByStatus: {
        columns: ['Status', 'Listings'],
        rows: byStatus.sort((a, b) => b.n - a.n).map((x) => [x._id, x.n]),
      },
    },
  });
}

async function orders(c: AdminCtx): Promise<DashboardSection> {
  const kind = c.orderKind ? { kind: c.orderKind } : {};
  const [paid, created, series] = await Promise.all([
    Order.aggregate<{
      _id: string;
      n: number;
      items: number;
      shipping: number;
      total: number;
      fee: number;
    }>(paidOrdersPipeline(c)),
    Order.aggregate<{ _id: string; n: number }>([
      { $match: { ...inRange('createdAt', c.range), ...kind } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
    Order.aggregate<{ _id: string; v: number }>([
      { $match: { ...inRange('paidAt', c.range), status: { $in: [...SALE_STATUSES] }, ...kind } },
      { $group: { _id: bucket('$paidAt', c.range.granularity), v: { $sum: '$itemsMinor' } } },
    ]),
  ]);
  const stand = paid.filter((r) => (SALE_STATUSES as readonly string[]).includes(r._id));
  const sum = (k: 'n' | 'items' | 'shipping' | 'total') => stand.reduce((a, r) => a + r[k], 0);
  return section({
    metrics: {
      ordersCreated: created.reduce((a, r) => a + r.n, 0),
      ordersPaid: sum('n'),
      gmvMinor: sum('items'),
      shippingMinor: sum('shipping'),
      buyerPaidTotalMinor: sum('total'),
      cancelledOrders: created.find((r) => r._id === 'CANCELLED')?.n ?? 0,
      refundedOrders: paid
        .filter((r) => (REFUNDED_STATUSES as readonly string[]).includes(r._id))
        .reduce((a, r) => a + r.n, 0),
    },
    tables: {
      ordersByStatus: {
        columns: ['Status', 'Orders placed'],
        rows: created.sort((a, b) => b.n - a.n).map((r) => [r._id, r.n]),
      },
    },
    series: { gmv: fillSeries(c.range, series) },
    notes: [
      'Gross merchandise value is what buyers paid for goods and animals. It is not FARM+’s revenue: that is the platform commission.',
    ],
  });
}

async function payments(c: AdminCtx): Promise<DashboardSection> {
  const [rows, series] = await Promise.all([
    Payment.aggregate<{ _id: { s: string; d: string }; n: number; received: number }>(
      paymentsPipeline(c),
    ),
    Payment.aggregate<{ _id: string; v: number }>([
      { $match: { ...inRange('createdAt', c.range), status: { $in: ['succeeded', 'refunded'] } } },
      {
        $group: {
          _id: bucket('$createdAt', c.range.granularity),
          v: { $sum: { $ifNull: ['$receivedMinor', 0] } },
        },
      },
    ]),
  ]);
  const cnt = (pred: (r: (typeof rows)[number]) => boolean) =>
    rows.filter(pred).reduce((a, r) => a + r.n, 0);
  const succeeded = cnt((r) => r._id.s === 'succeeded' || r._id.s === 'refunded');
  const failed = cnt((r) => r._id.s === 'failed');
  return section({
    metrics: {
      paymentAttempts: cnt(() => true),
      paymentsSucceeded: succeeded,
      paymentsFailed: failed,
      paymentSuccessRate: pct(succeeded, succeeded + failed),
      amountReceivedMinor: rows
        .filter((r) => r._id.s === 'succeeded' || r._id.s === 'refunded')
        .reduce((a, r) => a + r.received, 0),
      unappliedPayments: cnt((r) => r._id.d === 'unapplied'),
    },
    tables: {
      byStatus: {
        columns: ['Status', 'Payments'],
        rows: [...new Set(rows.map((r) => r._id.s))].map((s) => [s, cnt((r) => r._id.s === s)]),
      },
    },
    series: { amountReceived: fillSeries(c.range, series) },
  });
}

async function commissions(c: AdminCtx): Promise<DashboardSection> {
  const [paid, ledger] = await Promise.all([
    Order.aggregate<{ _id: string; fee: number }>(paidOrdersPipeline(c)),
    WalletTransaction.aggregate<{ net: number }>(ledgerCommissionPipeline(c)),
  ]);
  const stand = paid.filter((r) => (SALE_STATUSES as readonly string[]).includes(r._id));
  const fee = (rows: typeof stand) => rows.reduce((a, r) => a + r.fee, 0);
  const total = fee(stand);
  const byKind = c.orderKind
    ? []
    : await Order.aggregate<{ _id: string; fee: number }>([
        { $match: { ...inRange('paidAt', c.range), status: { $in: [...SALE_STATUSES] } } },
        { $group: { _id: '$kind', fee: { $sum: '$platformFeeMinor' } } },
      ]);
  return section({
    metrics: {
      commissionMinor: total,
      commissionReleasedMinor: fee(stand.filter((r) => r._id === 'DELIVERED')),
      commissionInProgressMinor: fee(stand.filter((r) => r._id !== 'DELIVERED')),
      commissionBookedNetMinor: ledger[0]?.net ?? 0,
    },
    tables: {
      commissionByOrderType: {
        columns: ['Order type', 'Commission'],
        rows: byKind.map((k) => [k._id, k.fee]),
        moneyColumns: [1],
      },
    },
    notes: [
      'Commission is the platform’s revenue from sales; gross merchandise value is what buyers paid sellers for goods. Neither is profit.',
      'The ledger figure is booked by payment/refund date; the order figure by payment date and current status.',
    ],
  });
}

async function refunds(c: AdminCtx): Promise<DashboardSection> {
  const [requested, done, open, failed] = await Promise.all([
    Refund.countDocuments(inRange('requestedAt', c.range)),
    Refund.aggregate<{ n: number; total: number }>([
      { $match: { status: 'succeeded', ...inRange('completedAt', c.range) } },
      { $group: { _id: null, n: { $sum: 1 }, total: { $sum: '$amountMinor' } } },
    ]),
    Refund.aggregate<{ total: number }>([
      { $match: { status: { $in: ['requested', 'approved', 'processing', 'failed'] } } },
      { $group: { _id: null, total: { $sum: '$amountMinor' } } },
    ]),
    Refund.countDocuments({ status: 'failed' }),
  ]);
  return section({
    metrics: {
      refundsRequested: requested,
      refundedMinor: done[0]?.total ?? 0,
      refundsOpenMinor: open[0]?.total ?? 0,
      refundsFailed: failed,
    },
  });
}

async function payouts(c: AdminCtx): Promise<DashboardSection> {
  const [requested, paid, pending, balances, failed] = await Promise.all([
    Withdrawal.countDocuments(inRange('requestedAt', c.range)),
    Withdrawal.aggregate<{ total: number }>([
      { $match: { status: 'paid', ...inRange('paidAt', c.range) } },
      { $group: { _id: null, total: { $sum: '$amountMinor' } } },
    ]),
    Withdrawal.aggregate<{ total: number }>([
      { $match: { status: { $in: ['requested', 'approved', 'processing'] } } },
      { $group: { _id: null, total: { $sum: '$amountMinor' } } },
    ]),
    Wallet.aggregate<{ total: number }>([
      { $match: { kind: 'seller' } },
      { $group: { _id: null, total: { $sum: { $add: ['$pendingMinor', '$availableMinor'] } } } },
    ]),
    Withdrawal.countDocuments({ status: 'failed', ...inRange('requestedAt', c.range) }),
  ]);
  return section({
    metrics: {
      withdrawalsRequested: requested,
      paidOutMinor: paid[0]?.total ?? 0,
      payoutsPendingMinor: pending[0]?.total ?? 0,
      sellerBalancesMinor: balances[0]?.total ?? 0,
      payoutsFailed: failed,
    },
  });
}

async function moderation(can: (p: string) => boolean, now: Date): Promise<DashboardSection> {
  const m: Record<string, number | null> = {};
  if (can('listings.moderate')) {
    const [l, p, oldestL, oldestP] = await Promise.all([
      Listing.countDocuments({ status: 'PENDING_REVIEW' }),
      Product.countDocuments({ status: 'PENDING_REVIEW' }),
      Listing.findOne({ status: 'PENDING_REVIEW' }).sort({ updatedAt: 1 }).select('updatedAt'),
      Product.findOne({ status: 'PENDING_REVIEW' })
        .sort({ 'review.submittedAt': 1 })
        .select('review.submittedAt'),
    ]);
    m['listingsPendingReview'] = l;
    m['productsPendingReview'] = p;
    const dates = [oldestL?.updatedAt, oldestP?.review?.submittedAt].filter((d): d is Date =>
      Boolean(d),
    );
    m['oldestPendingHours'] = dates.length
      ? Math.max(0, Math.round((now.getTime() - Math.min(...dates.map((d) => d.getTime()))) / HOUR))
      : null;
  }
  if (can('content.moderate'))
    m['openContentReports'] = await ContentReport.countDocuments({ status: 'open' });
  return Object.keys(m).length
    ? section({ metrics: m })
    : unavailable('You do not have a moderation permission.');
}

async function alerts(now: Date): Promise<DashboardSection> {
  const day = new Date(now.getTime() - 24 * HOUR);
  const [unapplied, failedRefunds, failedPayouts, stalePayouts, recent, stalePending] =
    await Promise.all([
      Payment.aggregate<{ n: number; total: number }>([
        { $match: { status: 'succeeded', disposition: 'unapplied' } },
        {
          $group: {
            _id: null,
            n: { $sum: 1 },
            total: { $sum: { $ifNull: ['$receivedMinor', 0] } },
          },
        },
      ]),
      Refund.countDocuments({ status: 'failed' }),
      Withdrawal.countDocuments({
        status: 'failed',
        updatedAt: { $gte: new Date(now.getTime() - 7 * 24 * HOUR) },
      }),
      Withdrawal.countDocuments({
        status: 'requested',
        requestedAt: { $lte: new Date(now.getTime() - 72 * HOUR) },
      }),
      Payment.aggregate<{ _id: string; n: number }>([
        {
          $match: {
            createdAt: { $gte: day },
            status: { $in: ['succeeded', 'refunded', 'failed'] },
          },
        },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ]),
      Payment.countDocuments({ status: 'pending', expiresAt: { $lte: now } }),
    ]);
  const ok = recent.filter((r) => r._id !== 'failed').reduce((a, r) => a + r.n, 0);
  const failed24 = recent.find((r) => r._id === 'failed')?.n ?? 0;
  const list: DashboardAlert[] = [];
  if ((unapplied[0]?.n ?? 0) > 0)
    list.push({
      code: 'unapplied_payments',
      severity: 'serious',
      count: unapplied[0]!.n,
      params: { amountMinor: unapplied[0]!.total },
      message: `${unapplied[0]!.n} payment(s) were received but could not be applied to an order (${(unapplied[0]!.total / 100).toFixed(2)} THB parked, refund needed).`,
    });
  if (failedRefunds > 0)
    list.push({
      code: 'failed_refunds',
      severity: 'serious',
      count: failedRefunds,
      message: `${failedRefunds} refund(s) failed at the provider and need a retry.`,
    });
  if (failedPayouts > 0)
    list.push({
      code: 'failed_payouts',
      severity: 'caution',
      count: failedPayouts,
      message: `${failedPayouts} payout(s) failed in the last 7 days (funds were returned to the sellers).`,
    });
  if (stalePayouts > 0)
    list.push({
      code: 'stale_withdrawals',
      severity: 'caution',
      count: stalePayouts,
      message: `${stalePayouts} withdrawal request(s) have waited more than 3 days for a decision.`,
    });
  if (ok + failed24 >= 10 && failed24 / (ok + failed24) > 0.3)
    list.push({
      code: 'payment_failure_rate',
      severity: 'caution',
      count: failed24,
      params: {
        total: ok + failed24,
        percent: Math.round((100 * failed24) / (ok + failed24)),
      },
      message: `${failed24} of ${ok + failed24} payments failed in the last 24 hours (${Math.round((100 * failed24) / (ok + failed24))}%).`,
    });
  if (stalePending > 0)
    list.push({
      code: 'stale_payment_attempts',
      severity: 'info',
      count: stalePending,
      message: `${stalePending} payment attempt(s) are past their window and not yet expired (the cleanup job handles them).`,
    });
  return section({
    metrics: { alertCount: list.length, failedPaymentsLast24h: failed24 },
    alerts: list,
  });
}

// ---------------------------------------------------------------------------
const need: Record<AdminDashboardSection, { any: string[]; reason: string }> = {
  users: { any: ['users.read'], reason: 'Needs permission to read users.' },
  registrations: {
    any: ['registrations.review'],
    reason: 'Needs permission to review registrations.',
  },
  farms: { any: ['farms.read'], reason: 'Needs permission to read farms.' },
  listings: {
    any: ['reports.read', 'listings.moderate'],
    reason: 'Needs permission to read reports.',
  },
  orders: { any: ['payments.read'], reason: 'Financial figures need the payments permission.' },
  payments: { any: ['payments.read'], reason: 'Financial figures need the payments permission.' },
  commissions: {
    any: ['payments.read'],
    reason: 'Financial figures need the payments permission.',
  },
  refunds: { any: ['payments.read'], reason: 'Financial figures need the payments permission.' },
  payouts: { any: ['payments.read'], reason: 'Financial figures need the payments permission.' },
  moderation: {
    any: ['listings.moderate', 'content.moderate'],
    reason: 'Needs a moderation permission.',
  },
  alerts: { any: ['payments.read'], reason: 'Financial alerts need the payments permission.' },
};
export const SECTION_ORDER = Object.keys(need) as AdminDashboardSection[];
export const allowedAdminSections = (has: (p: string) => boolean): AdminDashboardSection[] =>
  SECTION_ORDER.filter((s) => need[s].any.some(has));

export interface AdminQuery {
  from?: string | undefined;
  to?: string | undefined;
  granularity?: Granularity | undefined;
  orderKind?: 'animal' | 'product' | undefined;
  fresh?: boolean | undefined;
}

export function adminContext(q: AdminQuery, now = new Date()): AdminCtx {
  return { range: resolveRange(q, now), orderKind: q.orderKind ?? null, now };
}

export async function adminDashboard(
  has: (p: string) => boolean,
  q: AdminQuery,
  now = new Date(),
): Promise<AdminDashboardDTO> {
  const c = adminContext(q, now);
  const allowed = allowedAdminSections(has);
  const ttl = await getNumberSetting('analytics.cacheSeconds', 0, 3600);
  // The cache key carries the exact permission set that shapes the answer (sections AND moderation sub-metrics).
  const shape = [allowed, has('listings.moderate'), has('content.moderate')];
  const key = JSON.stringify([
    'admin',
    c.range.from,
    c.range.to,
    c.range.granularity,
    c.orderKind,
    shape,
  ]);
  const hit = !q.fresh && ttl > 0 ? reportCache.get(key, ttl * 1000) : undefined;
  if (hit)
    return {
      ...(hit.value as AdminDashboardDTO),
      meta: { ...(hit.value as AdminDashboardDTO).meta, cached: true },
    };
  const run: Record<AdminDashboardSection, () => Promise<DashboardSection>> = {
    users: () => users(c),
    registrations: () => registrations(c),
    farms: () => farms(c),
    listings: () => listings(c),
    orders: () => orders(c),
    payments: () => payments(c),
    commissions: () => commissions(c),
    refunds: () => refunds(c),
    payouts: () => payouts(c),
    moderation: () => moderation(has, now),
    alerts: () => alerts(now),
  };
  const sections: Partial<Record<AdminDashboardSection, DashboardSection>> = {};
  await Promise.all(
    SECTION_ORDER.map(async (s) => {
      sections[s] = allowed.includes(s) ? await run[s]() : unavailable(need[s].reason);
    }),
  );
  const dto: AdminDashboardDTO = {
    meta: {
      generatedAt: now.toISOString(),
      cached: false,
      cacheTtlSeconds: ttl,
      from: c.range.from,
      to: c.range.to,
      granularity: c.range.granularity,
      timezone: ANALYTICS_TIMEZONE,
      filters: c.orderKind ? { orderKind: c.orderKind } : {},
    },
    sections,
    definitions: definitionsFor(
      'admin',
      sections as Record<string, { metrics: Record<string, unknown> }>,
    ),
  };
  if (ttl > 0) reportCache.set(key, dto);
  return dto;
}
