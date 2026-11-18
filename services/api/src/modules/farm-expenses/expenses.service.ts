/* eslint-disable @typescript-eslint/no-explicit-any -- generic record engine: shape is driven by the per-kind config/schema */
import { Types, type Model } from 'mongoose';
import type { ExpenseCategory, ExpenseDTO, ExpenseSummary, Page } from '@farmplus/shared-types';
import { createExpenseSchema, type CreateExpenseInput } from '@farmplus/validation';
import { HttpError } from '../../lib/errors';
import {
  Animal,
  FarmExpense,
  FeedingRecord,
  HealthRecord,
  type FarmExpenseDoc,
} from '../../models';
import { assertFarmActive, requireFarmPermission, type FarmAccess } from '../farms/farm-access';
import {
  animalLites,
  audited,
  buildAttachments,
  dateRange,
  day,
  metaFor,
  requireFarmAnimal,
  toDate,
  type RecordContext,
  type RecordSpec,
} from '../records/record-core';

const invalid = (path: string, message: string) =>
  new HttpError(400, 'VALIDATION_ERROR', 'Request validation failed', [{ path, message }]);
const EDITABLE = [
  'category',
  'expenseDate',
  'amount',
  'description',
  'supplier',
  'animalId',
  'related',
  'quantity',
  'notes',
] as const;
const toMinor = (baht: number): number => Math.round(baht * 100);
const fromMinor = (minor: number): number => minor / 100;

/** Money rules: integer satang in storage, two decimals in the API, never a float sum. Needs `expenses.*` (owner/manager). */
export const expenseSpec: RecordSpec<FarmExpenseDoc, ExpenseDTO> = {
  kind: 'expense',
  model: FarmExpense,
  permissions: { read: 'expenses.read', write: 'expenses.write', correct: 'expenses.write' },
  createSchema: createExpenseSchema,
  editable: EDITABLE,
  toInput(doc) {
    const input: Record<string, unknown> = {
      category: doc.category,
      expenseDate: day(doc.expenseDate),
      amount: fromMinor(doc.amountMinor),
      description: doc.description,
    };
    if (doc.supplier) input['supplier'] = doc.supplier;
    if (doc.animalId) input['animalId'] = String(doc.animalId);
    if (doc.related) input['related'] = { kind: doc.related.kind, id: String(doc.related.id) };
    if (doc.quantity) input['quantity'] = doc.quantity;
    if (doc.notes) input['notes'] = doc.notes;
    return input;
  },
  assign(doc, input: CreateExpenseInput) {
    doc.category = input.category;
    doc.expenseDate = toDate(input.expenseDate);
    doc.amountMinor = toMinor(input.amount);
    doc.currency = 'THB';
    doc.description = input.description;
    doc.supplier = input.supplier ?? null;
    doc.animalId = (input.animalId as unknown as Types.ObjectId) ?? null;
    doc.related = input.related
      ? ({ kind: input.related.kind, id: input.related.id } as never)
      : null;
    doc.quantity = input.quantity ?? null;
    doc.notes = input.notes ?? null;
  },
  async validate(ctx, input: CreateExpenseInput) {
    if (input.animalId) await requireFarmAnimal(ctx.access, input.animalId);
    if (input.related) {
      const model: Model<any> = input.related.kind === 'health' ? HealthRecord : FeedingRecord;
      const related = await model.findOne({ _id: input.related.id, farmId: ctx.access.farm._id });
      if (!related) throw invalid('related.id', 'Related record not found on this farm');
      if (related.voided) throw invalid('related.id', 'The related record has been voided');
      if (input.animalId && related.animalId && String(related.animalId) !== input.animalId) {
        throw invalid(
          'animalId',
          'The expense is attributed to a different animal than the related record',
        );
      }
    }
  },
  async serialize(docs) {
    const meta = await metaFor(docs);
    const animals = await animalLites(
      docs[0]?.farmId as Types.ObjectId,
      docs.map((d) => d.animalId),
    );
    return docs.map((d) => ({
      ...meta(d),
      category: d.category,
      expenseDate: day(d.expenseDate)!,
      amount: fromMinor(d.amountMinor),
      currency: d.currency,
      description: d.description,
      ...(d.supplier ? { supplier: d.supplier } : {}),
      ...(d.animalId
        ? { animal: animals.get(String(d.animalId)) ?? { id: String(d.animalId), animalCode: '?' } }
        : {}),
      ...(d.related ? { related: { kind: d.related.kind, id: String(d.related.id) } } : {}),
      ...(d.quantity ? { quantity: d.quantity } : {}),
      ...(d.notes ? { notes: d.notes } : {}),
    }));
  },
};

export async function createExpense(
  ctx: RecordContext,
  input: CreateExpenseInput,
): Promise<ExpenseDTO> {
  requireFarmPermission(ctx.access, 'expenses.write');
  assertFarmActive(ctx.access);
  await expenseSpec.validate!(ctx, input);
  const doc = new FarmExpense({
    farmId: ctx.access.farm._id,
    createdBy: ctx.actor.userId,
    attachments: buildAttachments(input.attachments, ctx.actor, ctx.policy),
  });
  expenseSpec.assign(doc, input);
  await doc.save();
  await audited(ctx, 'expense', doc, { category: input.category, amountMinor: doc.amountMinor });
  return (await expenseSpec.serialize([doc], { access: ctx.access }))[0]!;
}

export async function listExpenses(
  access: FarmAccess,
  q: {
    page: number;
    pageSize: number;
    category?: ExpenseCategory | undefined;
    animalId?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    includeVoided: 'true' | 'false';
    sortBy: 'expenseDate' | 'amount' | 'createdAt';
    order: 'asc' | 'desc';
  },
): Promise<Page<ExpenseDTO>> {
  requireFarmPermission(access, 'expenses.read');
  const filter: Record<string, unknown> = {
    farmId: access.farm._id,
    ...dateRange('expenseDate', q.from, q.to),
  };
  if (q.includeVoided === 'false') filter['voided'] = false;
  if (q.category) filter['category'] = q.category;
  if (q.animalId) filter['animalId'] = q.animalId;
  const sortField = q.sortBy === 'amount' ? 'amountMinor' : q.sortBy;
  const sort = { [sortField]: q.order === 'asc' ? 1 : -1, _id: -1 } as Record<string, 1 | -1>;
  const [rows, total] = await Promise.all([
    FarmExpense.find(filter)
      .sort(sort)
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize),
    FarmExpense.countDocuments(filter),
  ]);
  return {
    items: rows.length ? await expenseSpec.serialize(rows, { access }) : [],
    page: q.page,
    pageSize: q.pageSize,
    total,
  };
}

/** Totals over LIVE (non-voided) expenses, summed as integers and converted once at the end. */
export async function summarizeExpenses(
  access: FarmAccess,
  q: { from?: string | undefined; to?: string | undefined; animalId?: string | undefined },
): Promise<ExpenseSummary> {
  requireFarmPermission(access, 'expenses.read');
  const match: Record<string, unknown> = {
    farmId: access.farm._id,
    voided: false,
    ...dateRange('expenseDate', q.from, q.to),
  };
  if (q.animalId) {
    if (!(await Animal.exists({ _id: q.animalId, farmId: access.farm._id })))
      throw invalid('animalId', 'Animal not found on this farm');
    match['animalId'] = new Types.ObjectId(q.animalId);
  }
  const [byCategory, byMonth] = await Promise.all([
    FarmExpense.aggregate<{ _id: ExpenseCategory; total: number; count: number }>([
      { $match: match },
      { $group: { _id: '$category', total: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    FarmExpense.aggregate<{ _id: string; total: number }>([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$expenseDate', timezone: 'UTC' } },
          total: { $sum: '$amountMinor' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);
  const totalMinor = byCategory.reduce((n, r) => n + r.total, 0);
  return {
    ...(q.from ? { from: q.from } : {}),
    ...(q.to ? { to: q.to } : {}),
    total: fromMinor(totalMinor),
    count: byCategory.reduce((n, r) => n + r.count, 0),
    byCategory: byCategory.map((r) => ({
      category: r._id,
      total: fromMinor(r.total),
      count: r.count,
    })),
    byMonth: byMonth.map((r) => ({ month: r._id, total: fromMinor(r.total) })),
  };
}
