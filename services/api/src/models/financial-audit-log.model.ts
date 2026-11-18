import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

/**
 * Append-only, hash-chained trail of every financial event. Each row stores the hash of the previous one, so removing or
 * editing a row breaks the chain and `verify` reports where. Never contains account numbers, addresses or other PII.
 */
export interface FinancialAuditLogAttrs {
  _id: Types.ObjectId;
  seq: number;
  at: Date;
  actorId: Types.ObjectId | null;
  actorType: 'user' | 'system' | 'provider';
  action: string;
  targetType: string;
  targetId: string;
  amountMinor: number | null;
  data: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

const schema = new Schema<FinancialAuditLogAttrs>(
  {
    seq: { type: Number, required: true },
    at: { type: Date, required: true },
    actorId: { type: Schema.Types.ObjectId, default: null },
    actorType: { type: String, enum: ['user', 'system', 'provider'], required: true },
    action: { type: String, required: true },
    targetType: { type: String, required: true },
    targetId: { type: String, required: true },
    amountMinor: { type: Number, default: null },
    data: { type: Schema.Types.Mixed, default: {} },
    prevHash: { type: String, required: true },
    hash: { type: String, required: true },
  },
  { collection: 'financial_audit_logs', versionKey: false, minimize: false },
);

// Two writers can never take the same position: the loser retries on the next one.
schema.index({ seq: 1 }, { unique: true });
schema.index({ targetType: 1, targetId: 1, seq: -1 });
schema.index({ action: 1, seq: -1 });

export type FinancialAuditLogDoc = HydratedDocument<FinancialAuditLogAttrs>;
export const FinancialAuditLog = model<FinancialAuditLogAttrs>('FinancialAuditLog', schema);
