import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

/** One row per AI provider call (or skipped call), for monitoring cost, latency and errors. Holds no prompt or output text. */
export interface AiUsageLogAttrs {
  _id: Types.ObjectId;
  feature: 'assessment_narrative';
  provider: string;
  model: string;
  status: 'ok' | 'error' | 'rejected' | 'skipped';
  errorCode?: string | null;
  inputTokens: number;
  outputTokens: number;
  /** Computed from the per-million-token rates configured in settings at the time (millionths of a baht). */
  costMicros: number;
  latencyMs: number;
  assessmentId?: Types.ObjectId | null;
  userId?: Types.ObjectId | null;
  farmId?: Types.ObjectId | null;
  createdAt: Date;
}

const schema = new Schema<AiUsageLogAttrs>(
  {
    feature: { type: String, default: 'assessment_narrative' },
    provider: { type: String, required: true },
    model: { type: String, required: true },
    status: { type: String, enum: ['ok', 'error', 'rejected', 'skipped'], required: true },
    errorCode: { type: String, default: null },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    costMicros: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    assessmentId: { type: Schema.Types.ObjectId, default: null },
    userId: { type: Schema.Types.ObjectId, default: null },
    farmId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'ai_usage_logs' },
);
schema.index({ createdAt: -1 });
schema.index({ userId: 1, createdAt: -1 });

export type AiUsageLogDoc = HydratedDocument<AiUsageLogAttrs>;
export const AiUsageLog = model<AiUsageLogAttrs>('AiUsageLog', schema);
