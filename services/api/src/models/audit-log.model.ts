import { Schema, model, type Types } from 'mongoose';

export interface AuditLogAttrs {
  _id: Types.ObjectId;
  actorId: Types.ObjectId | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  createdAt: Date;
}
const schema = new Schema<AuditLogAttrs>(
  {
    actorId: { type: Schema.Types.ObjectId, default: null, index: true },
    action: { type: String, required: true, index: true },
    targetType: { type: String },
    targetId: { type: String, index: true },
    metadata: { type: Schema.Types.Mixed },
    ip: { type: String },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { collection: 'audit_logs' },
);
export const AuditLog = model<AuditLogAttrs>('AuditLog', schema);
