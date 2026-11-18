import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import type { QUANTITY_UNITS } from '@farmplus/shared-types';
import { FEEDING_KINDS, FEED_CATEGORIES } from '@farmplus/shared-types';
import { recordBaseDefinition, type RecordBaseAttrs } from './record-base';

export interface FeedingRecordAttrs extends RecordBaseAttrs {
  animalId?: Types.ObjectId | null;
  groupLabel?: string | null;
  kind: (typeof FEEDING_KINDS)[number];
  date: Date;
  endDate?: Date | null;
  feedName: string;
  category: (typeof FEED_CATEGORIES)[number];
  quantity: { amount: number; unit: (typeof QUANTITY_UNITS)[number] };
  frequencyPerDay?: number | null;
  timesOfDay?: string[] | null;
  notes?: string | null;
}

const schema = new Schema<FeedingRecordAttrs>(
  {
    ...recordBaseDefinition,
    animalId: { type: Schema.Types.ObjectId, default: null, ref: 'Animal' },
    groupLabel: { type: String, default: null },
    kind: { type: String, enum: FEEDING_KINDS, required: true },
    date: { type: Date, required: true },
    endDate: { type: Date, default: null },
    feedName: { type: String, required: true },
    category: { type: String, enum: FEED_CATEGORIES, default: 'other' },
    quantity: { type: Schema.Types.Mixed, required: true },
    frequencyPerDay: { type: Number, default: null },
    timesOfDay: { type: [String], default: undefined },
    notes: { type: String, default: null },
  },
  { timestamps: true, collection: 'feeding_records' },
);
schema.index({ farmId: 1, animalId: 1, date: -1 });
schema.index({ farmId: 1, kind: 1, date: -1 });
schema.index({ farmId: 1, date: 1 });
// Default list order (newest first, `_id` tie-break) straight from the index, without an in-memory sort.
schema.index({ farmId: 1, date: -1, _id: -1 });
export type FeedingRecordDoc = HydratedDocument<FeedingRecordAttrs>;
export const FeedingRecord = model<FeedingRecordAttrs>('FeedingRecord', schema);
