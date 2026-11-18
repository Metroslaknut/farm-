import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import type { QUANTITY_UNITS } from '@farmplus/shared-types';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@farmplus/shared-types';
import { recordBaseDefinition, type RecordBaseAttrs } from './record-base';

export interface FarmExpenseAttrs extends RecordBaseAttrs {
  category: ExpenseCategory;
  expenseDate: Date;
  /** Integer satang (1 THB = 100). Money is never stored as a float. */
  amountMinor: number;
  currency: 'THB';
  description: string;
  supplier?: string | null;
  animalId?: Types.ObjectId | null;
  related?: { kind: 'health' | 'feeding'; id: Types.ObjectId } | null;
  quantity?: { amount: number; unit: (typeof QUANTITY_UNITS)[number] } | null;
  notes?: string | null;
}

const schema = new Schema<FarmExpenseAttrs>(
  {
    ...recordBaseDefinition,
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    expenseDate: { type: Date, required: true },
    amountMinor: { type: Number, required: true, validate: Number.isInteger },
    currency: { type: String, enum: ['THB'], default: 'THB' },
    description: { type: String, required: true },
    supplier: { type: String, default: null },
    animalId: { type: Schema.Types.ObjectId, default: null, ref: 'Animal' },
    related: { type: Schema.Types.Mixed, default: null },
    quantity: { type: Schema.Types.Mixed, default: null },
    notes: { type: String, default: null },
  },
  { timestamps: true, collection: 'farm_expenses' },
);
schema.index({ farmId: 1, expenseDate: -1 });
schema.index({ farmId: 1, category: 1, expenseDate: -1 });
schema.index({ farmId: 1, animalId: 1, expenseDate: -1 });
export type FarmExpenseDoc = HydratedDocument<FarmExpenseAttrs>;
export const FarmExpense = model<FarmExpenseAttrs>('FarmExpense', schema);
