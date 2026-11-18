import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface CommissionRuleAttrs {
  _id: Types.ObjectId;
  name: string;
  feeBps: number;
  minFeeMinor?: number | null;
  maxFeeMinor?: number | null;
  priceMinMinor?: number | null;
  priceMaxMinor?: number | null;
  categories: string[];
  startsAt: Date;
  endsAt?: Date | null;
  priority: number;
  active: boolean;
  /** Bumped on every edit so a snapshot can say exactly which revision it used. */
  version: number;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<CommissionRuleAttrs>(
  {
    name: { type: String, required: true },
    feeBps: { type: Number, required: true, min: 0, max: 5000 },
    minFeeMinor: { type: Number, default: null, min: 0 },
    maxFeeMinor: { type: Number, default: null, min: 0 },
    priceMinMinor: { type: Number, default: null, min: 0 },
    priceMaxMinor: { type: Number, default: null, min: 0 },
    categories: { type: [String], default: [] },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, default: null },
    priority: { type: Number, required: true, min: 0, max: 1000 },
    active: { type: Boolean, default: true },
    version: { type: Number, default: 1 },
    createdBy: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
  },
  { timestamps: true, collection: 'commission_rules' },
);

schema.index({ active: 1, startsAt: 1, endsAt: 1, priority: -1 });

export type CommissionRuleDoc = HydratedDocument<CommissionRuleAttrs>;
export const CommissionRule = model<CommissionRuleAttrs>('CommissionRule', schema);
