import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

/** Market observations an administrator imported, each with its source and the statement that FARM+ may use it. */
export interface AiMarketPriceAttrs {
  _id: Types.ObjectId;
  animalTypeKey: string;
  kind: 'per_head' | 'per_kg';
  priceMinor: number;
  sex?: string | null;
  observedOn: Date;
  region?: string | null;
  source: string;
  authorization: string;
  active: boolean;
  createdBy: Types.ObjectId;
  createdAt: Date;
}

const schema = new Schema<AiMarketPriceAttrs>(
  {
    animalTypeKey: { type: String, required: true },
    kind: { type: String, enum: ['per_head', 'per_kg'], required: true },
    priceMinor: { type: Number, required: true, min: 1 },
    sex: { type: String, default: null },
    observedOn: { type: Date, required: true },
    region: { type: String, default: null },
    source: { type: String, required: true },
    authorization: { type: String, required: true },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'ai_market_prices' },
);
schema.index({ animalTypeKey: 1, kind: 1, active: 1, observedOn: -1 });

export type AiMarketPriceDoc = HydratedDocument<AiMarketPriceAttrs>;
export const AiMarketPrice = model<AiMarketPriceAttrs>('AiMarketPrice', schema);
