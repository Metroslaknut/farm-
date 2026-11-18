import type { Types } from 'mongoose';
import type { AuditLogEntry, Page } from '@farmplus/shared-types';
import { AuditLog, User } from '../models';

export interface AuditInput {
  actorId?: Types.ObjectId | string | null;
  action: string;
  targetType?: string;
  targetId?: string | Types.ObjectId;
  /** Never put passwords, tokens or secrets in metadata. */
  metadata?: Record<string, unknown>;
  ip?: string;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  await AuditLog.create({
    actorId: input.actorId ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId === undefined ? undefined : String(input.targetId),
    metadata: input.metadata,
    ip: input.ip,
  });
}

export interface AuditQuery {
  page: number;
  pageSize: number;
  /** Exact action, or a prefix when it ends with `*` (e.g. `registration.*`). */
  action?: string | undefined;
  actorId?: string | undefined;
  targetType?: string | undefined;
  targetId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function listAuditLogs(query: AuditQuery): Promise<Page<AuditLogEntry>> {
  const filter: Record<string, unknown> = {};
  if (query.action) {
    filter['action'] = query.action.endsWith('*')
      ? { $regex: `^${escapeRegex(query.action.slice(0, -1))}` }
      : query.action;
  }
  if (query.actorId) filter['actorId'] = query.actorId;
  if (query.targetType) filter['targetType'] = query.targetType;
  if (query.targetId) filter['targetId'] = query.targetId;
  if (query.from || query.to) {
    filter['createdAt'] = {
      ...(query.from ? { $gte: new Date(query.from) } : {}),
      ...(query.to ? { $lte: new Date(query.to) } : {}),
    };
  }
  const [rows, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize),
    AuditLog.countDocuments(filter),
  ]);
  const actorIds = [...new Set(rows.flatMap((r) => (r.actorId ? [String(r.actorId)] : [])))];
  const actors = new Map(
    (await User.find({ _id: { $in: actorIds } }).select('displayName email')).map((u) => [
      String(u._id),
      u,
    ]),
  );
  return {
    items: rows.map((row) => {
      const actor = row.actorId ? actors.get(String(row.actorId)) : undefined;
      return {
        id: String(row._id),
        actorId: row.actorId ? String(row.actorId) : null,
        ...(actor
          ? {
              actor: {
                displayName: actor.displayName,
                ...(actor.email ? { email: actor.email } : {}),
              },
            }
          : {}),
        action: row.action,
        ...(row.targetType ? { targetType: row.targetType } : {}),
        ...(row.targetId ? { targetId: row.targetId } : {}),
        ...(row.metadata ? { metadata: row.metadata } : {}),
        ...(row.ip ? { ip: row.ip } : {}),
        createdAt: row.createdAt.toISOString(),
      };
    }),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}
