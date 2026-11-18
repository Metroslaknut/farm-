import type { Types } from 'mongoose';
import { HttpError } from '../../lib/errors';
import type { AdminExportSection, FarmExportSection } from '@farmplus/shared-types';
import {
  AiAssessment,
  Animal,
  AnimalType,
  FarmExpense,
  FeedingRecord,
  HealthRecord,
  Order,
  Payment,
  Refund,
  User,
  WeightRecord,
  Withdrawal,
} from '../../models';
import { baht } from './csv';
import { SALE_STATUSES, type FarmCtx } from './farm.service';
import type { AdminCtx } from './admin.service';
import { bangkokDay, type ReportRange } from './range';

export const EXPORT_ROW_LIMIT = 50_000;
export interface ExportData {
  filename: string;
  columns: string[];
  rows: (string | number | null)[][];
  truncated: boolean;
}
type Row = (string | number | null)[];
const inRange = (field: string, r: ReportRange) => ({
  [field]: { $gte: r.start, $lt: r.endExclusive },
});
/** A date-only field (stored as UTC midnight). */
const d = (x: Date | null | undefined): string | null => (x ? x.toISOString().slice(0, 10) : null);
/** A timestamp, shown as its calendar day in Thailand. */
const t = (x: Date | null | undefined): string | null => (x ? bangkokDay(x) : null);
const finish = (filename: string, columns: string[], rows: Row[]): ExportData => ({
  filename,
  columns,
  rows: rows.slice(0, EXPORT_ROW_LIMIT),
  truncated: rows.length > EXPORT_ROW_LIMIT,
});
const codesFor = async (
  ids: (Types.ObjectId | null | undefined)[],
): Promise<Map<string, string>> => {
  const rows = (await Animal.find({ _id: { $in: ids.filter(Boolean) } } as never)
    .select('animalCode')
    .lean()) as unknown as { _id: Types.ObjectId; animalCode: string }[];
  return new Map(rows.map((a) => [String(a._id), a.animalCode]));
};

/** Detail rows behind the farm dashboard. Each is scoped by the farm id and the same filters as the dashboard. */
export async function farmExport(section: FarmExportSection, c: FarmCtx): Promise<ExportData> {
  const typeIds = c.animalTypeId
    ? await Animal.find({ farmId: c.farmId, animalTypeId: c.animalTypeId }).distinct('_id')
    : null;
  const animalFilter = typeIds ? { animalId: { $in: typeIds } } : {};
  const tag = `${c.range.from}_${c.range.to}`;
  const cap = EXPORT_ROW_LIMIT + 1;
  switch (section) {
    case 'animals': {
      const rows = await Animal.find({
        farmId: c.farmId,
        archivedAt: null,
        ...(c.animalTypeId ? { animalTypeId: c.animalTypeId } : {}),
      })
        .sort({ animalCode: 1 })
        .limit(cap);
      const types = new Map((await AnimalType.find()).map((t) => [String(t._id), t.name]));
      return finish(
        `animals_${tag}`,
        [
          'Animal code',
          'Animal type',
          'Sex',
          'Breed',
          'Status',
          'Birth date',
          'Birth date estimated',
          'Acquired on',
          'Archived',
        ],
        rows.map((a) => [
          a.animalCode,
          types.get(String(a.animalTypeId)) ?? '',
          a.sex,
          a.breed ?? '',
          a.currentStatus,
          d(a.birthDate),
          a.birthDateEstimated ? 'yes' : 'no',
          d(a.acquisitionDate),
          a.archivedAt ? 'yes' : 'no',
        ]),
      );
    }
    case 'growth': {
      const rows = await WeightRecord.find({
        farmId: c.farmId,
        voided: false,
        ...inRange('weighedOn', c.range),
        ...animalFilter,
      } as never)
        .sort({ weighedOn: 1 })
        .limit(cap);
      const codes = await codesFor(rows.map((r) => r.animalId));
      return finish(
        `weights_${tag}`,
        ['Date', 'Animal code', 'Weight (kg)', 'Method'],
        rows.map((r) => [
          d(r.weighedOn),
          codes.get(String(r.animalId)) ?? '',
          r.weightKg,
          r.method,
        ]),
      );
    }
    case 'health': {
      const rows = await HealthRecord.find({
        farmId: c.farmId,
        voided: false,
        ...inRange('recordedOn', c.range),
        ...animalFilter,
      } as never)
        .sort({ recordedOn: 1 })
        .limit(cap);
      const codes = await codesFor(rows.map((r) => r.animalId));
      // Counts, types and dates only: titles, symptoms, medicines and notes are free text and stay out of exports.
      return finish(
        `health_${tag}`,
        ['Date', 'Animal code', 'Type', 'Severity', 'Outcome', 'Withdrawal ends', 'Next due'],
        rows.map((r) => [
          d(r.recordedOn),
          codes.get(String(r.animalId)) ?? '',
          r.type,
          r.severity ?? '',
          r.outcome ?? '',
          d(r.withdrawalEndsOn),
          d(r.nextDueOn),
        ]),
      );
    }
    case 'feeding': {
      const rows = await FeedingRecord.find({
        farmId: c.farmId,
        voided: false,
        kind: 'log',
        ...inRange('date', c.range),
        ...animalFilter,
      } as never)
        .sort({ date: 1 })
        .limit(cap);
      const codes = await codesFor(rows.map((r) => r.animalId));
      return finish(
        `feeding_${tag}`,
        ['Date', 'Animal code', 'Group log', 'Feed category', 'Quantity', 'Unit'],
        rows.map((r) => [
          d(r.date),
          r.animalId ? (codes.get(String(r.animalId)) ?? '') : '',
          r.animalId ? 'no' : 'yes',
          r.category,
          r.quantity.amount,
          r.quantity.unit,
        ]),
      );
    }
    case 'costs': {
      const rows = await FarmExpense.find({
        farmId: c.farmId,
        voided: false,
        ...inRange('expenseDate', c.range),
        ...animalFilter,
      } as never)
        .sort({ expenseDate: 1 })
        .limit(cap);
      const codes = await codesFor(rows.map((r) => r.animalId));
      return finish(
        `costs_${tag}`,
        [
          'Date',
          'Category',
          'Amount (THB)',
          'Animal code',
          'Assigned to an animal',
          'Description',
          'Supplier',
        ],
        rows.map((r) => [
          d(r.expenseDate),
          r.category,
          baht(r.amountMinor),
          r.animalId ? (codes.get(String(r.animalId)) ?? '') : '',
          r.animalId ? 'yes' : 'no (farm-wide)',
          r.description,
          r.supplier ?? '',
        ]),
      );
    }
    case 'orders': {
      // Orders are not filtered by animal type; refusing beats exporting every order under a "cattle" filter.
      if (c.animalTypeId)
        throw new HttpError(400, 'VALIDATION_ERROR', 'Orders cannot be filtered by animal type', [
          { path: 'animalType', message: 'Not available for the orders export' },
        ]);
      // Orders placed OR paid inside the dates. No buyer identity or address ever leaves the farm export.
      const rows = await Order.find({
        farmId: c.farmId,
        ...(c.orderKind ? { kind: c.orderKind } : {}),
        $or: [inRange('createdAt', c.range), inRange('paidAt', c.range)],
      })
        .sort({ createdAt: 1, _id: 1 })
        .limit(cap);
      return finish(
        `orders_${tag}`,
        [
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
        ],
        rows.map((o) => [
          o.orderNo,
          t(o.createdAt),
          t(o.paidAt),
          o.kind,
          o.status,
          o.fulfillment,
          (o.items as unknown as unknown[]).length,
          baht(o.itemsMinor),
          baht(o.shippingMinor),
          baht(o.platformFeeMinor),
          baht(o.sellerPayoutMinor),
          o.paidAt &&
          o.paidAt >= c.range.start &&
          o.paidAt < c.range.endExclusive &&
          (SALE_STATUSES as readonly string[]).includes(o.status)
            ? 'yes'
            : 'no',
        ]),
      );
    }
    case 'assessments': {
      const rows = await AiAssessment.find({
        farmId: c.farmId,
        ...inRange('assessmentDate', c.range),
        ...animalFilter,
      } as never)
        .sort({ assessmentDate: 1 })
        .limit(cap);
      return finish(
        `assessments_${tag}`,
        [
          'Date',
          'Animal code',
          'Confidence',
          'Price low (THB)',
          'Price middle (THB)',
          'Price high (THB)',
          'Review',
          'Model version',
        ],
        rows.map((a) => {
          const r = a.result as unknown as {
            confidence: { level: string };
            estimatedPriceRange: { lowMinor: number; midMinor: number; highMinor: number } | null;
          };
          return [
            t(a.assessmentDate),
            a.animalCode,
            r.confidence.level,
            baht(r.estimatedPriceRange?.lowMinor),
            baht(r.estimatedPriceRange?.midMinor),
            baht(r.estimatedPriceRange?.highMinor),
            a.review.status,
            a.modelVersion,
          ];
        }),
      );
    }
  }
}

export async function adminExport(section: AdminExportSection, c: AdminCtx): Promise<ExportData> {
  const tag = `${c.range.from}_${c.range.to}`;
  const cap = EXPORT_ROW_LIMIT + 1;
  const kind = c.orderKind ? { kind: c.orderKind } : {};
  switch (section) {
    case 'signups': {
      // Aggregated by day: no e-mail addresses or names leave the platform in an export.
      const rows = await User.aggregate<{ _id: string; n: number }>([
        { $match: inRange('createdAt', c.range) },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Bangkok' },
            },
            n: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]);
      return finish(
        `signups_${tag}`,
        ['Date', 'New users'],
        rows.map((r) => [r._id, r.n]),
      );
    }
    case 'orders': {
      const rows = await Order.find({
        ...kind,
        $or: [inRange('createdAt', c.range), inRange('paidAt', c.range)],
      })
        .sort({ createdAt: 1, _id: 1 })
        .limit(cap);
      return finish(
        `orders_${tag}`,
        [
          'Order',
          'Placed',
          'Paid',
          'Type',
          'Status',
          'Items (THB)',
          'Shipping (THB)',
          'Buyer paid (THB)',
          'Platform fee (THB)',
        ],
        rows.map((o) => [
          o.orderNo,
          t(o.createdAt),
          t(o.paidAt),
          o.kind,
          o.status,
          baht(o.itemsMinor),
          baht(o.shippingMinor),
          baht(o.grandTotalMinor),
          baht(o.platformFeeMinor),
        ]),
      );
    }
    case 'payments': {
      const rows = await Payment.find(inRange('createdAt', c.range))
        .sort({ createdAt: 1, _id: 1 })
        .limit(cap);
      return finish(
        `payments_${tag}`,
        [
          'Order',
          'Created',
          'Status',
          'Applied',
          'Amount asked (THB)',
          'Amount received (THB)',
          'Failure code',
        ],
        rows.map((p) => [
          p.orderNo,
          t(p.createdAt),
          p.status,
          p.disposition ?? '',
          baht(p.amountMinor),
          baht(p.receivedMinor ?? null),
          p.failureCode ?? '',
        ]),
      );
    }
    case 'commissions': {
      const rows = await Order.find({
        ...inRange('paidAt', c.range),
        status: { $in: [...SALE_STATUSES] },
        ...kind,
      })
        .sort({ paidAt: 1, _id: 1 })
        .limit(cap);
      return finish(
        `commissions_${tag}`,
        ['Order', 'Paid', 'Type', 'Status', 'Items (THB)', 'Commission (THB)'],
        rows.map((o) => [
          o.orderNo,
          t(o.paidAt),
          o.kind,
          o.status,
          baht(o.itemsMinor),
          baht(o.platformFeeMinor),
        ]),
      );
    }
    case 'refunds': {
      const rows = await Refund.find(inRange('requestedAt', c.range))
        .sort({ requestedAt: 1, _id: 1 })
        .limit(cap);
      // The reason is free text written by a buyer or seller: left out.
      return finish(
        `refunds_${tag}`,
        ['Refund', 'Order', 'Requested', 'Completed', 'Status', 'Amount (THB)'],
        rows.map((r) => [
          r.refundNo,
          r.orderNo ?? '',
          t(r.requestedAt),
          t(r.completedAt),
          r.status,
          baht(r.amountMinor),
        ]),
      );
    }
    case 'payouts': {
      const rows = await Withdrawal.find(inRange('requestedAt', c.range))
        .sort({ requestedAt: 1, _id: 1 })
        .limit(cap);
      // No seller identity and no bank details: only the amounts and states.
      return finish(
        `payouts_${tag}`,
        ['Withdrawal', 'Requested', 'Paid', 'Status', 'Amount (THB)'],
        rows.map((w) => [
          w.withdrawalNo,
          t(w.requestedAt),
          t(w.paidAt),
          w.status,
          baht(w.amountMinor),
        ]),
      );
    }
  }
}
