import { createHash } from 'node:crypto';
import type { Types } from 'mongoose';
import type { CursorPage, FinancialAuditEntryDTO } from '@farmplus/shared-types';
import { FinancialAuditLog, type FinancialAuditLogDoc } from '../../models';
import { decodeCursor, isDuplicateKey } from '../community/shared';
import { pageOf } from './shared';

export const GENESIS_HASH = '0'.repeat(64);

export interface FinancialActor {
  id: string | Types.ObjectId | null;
  type: 'user' | 'system' | 'provider';
}
export const SYSTEM: FinancialActor = { id: null, type: 'system' };
export const PROVIDER: FinancialActor = { id: null, type: 'provider' };
export const userActor = (id: string): FinancialActor => ({ id, type: 'user' });

/** Key-sorted JSON so a hash does not depend on property insertion order. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`;
}

type HashInput = Pick<
  FinancialAuditLogDoc,
  | 'seq'
  | 'at'
  | 'actorType'
  | 'action'
  | 'targetType'
  | 'targetId'
  | 'amountMinor'
  | 'data'
  | 'prevHash'
> & { actorId: unknown };

export const hashEntry = (e: HashInput): string =>
  createHash('sha256')
    .update(
      [
        e.seq,
        e.at.toISOString(),
        e.actorType,
        e.actorId ? String(e.actorId) : '',
        e.action,
        e.targetType,
        e.targetId,
        e.amountMinor ?? '',
        canonical(e.data),
        e.prevHash,
      ].join('|'),
    )
    .digest('hex');

export interface FinancialEvent {
  actor: FinancialActor;
  action: string;
  targetType: string;
  targetId: string | Types.ObjectId;
  amountMinor?: number | undefined;
  /** Never put account numbers, addresses, tokens or other personal data here. */
  data?: Record<string, unknown>;
}

let tail: Promise<unknown> = Promise.resolve();

/**
 * Appends to the chain. Writers in this process queue up (so they rarely collide at all); writers in OTHER processes
 * collide on the unique `seq` and simply retry at the next position, with a little jitter.
 */
export function recordFinancial(event: FinancialEvent): Promise<void> {
  const run = tail.then(() => append(event));
  tail = run.catch(() => undefined);
  return run;
}

async function append(event: FinancialEvent): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const last = await FinancialAuditLog.findOne().sort({ seq: -1 }).lean();
    const entry = {
      seq: (last?.seq ?? 0) + 1,
      at: new Date(),
      actorId: event.actor.id ?? null,
      actorType: event.actor.type,
      action: event.action,
      targetType: event.targetType,
      targetId: String(event.targetId),
      amountMinor: event.amountMinor ?? null,
      data: event.data ?? {},
      prevHash: last?.hash ?? GENESIS_HASH,
    };
    try {
      await FinancialAuditLog.create({ ...entry, hash: hashEntry(entry) });
      return;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      await new Promise((r) => setTimeout(r, Math.random() * 10 * (attempt + 1)));
    }
  }
  throw new Error('Could not append to the financial audit log');
}

export async function verifyAuditChain(): Promise<{
  ok: boolean;
  checked: number;
  brokenAtSeq?: number;
  reason?: string;
}> {
  let prevHash = GENESIS_HASH;
  let expected = 1;
  let checked = 0;
  for await (const row of FinancialAuditLog.find().sort({ seq: 1 }).lean().cursor()) {
    const fail = (reason: string) => ({ ok: false, checked, brokenAtSeq: row.seq, reason });
    if (row.seq !== expected) return fail('A row is missing before this position');
    if (row.prevHash !== prevHash) return fail('The link to the previous row does not match');
    if (hashEntry(row) !== row.hash)
      return fail('The row content was changed after it was written');
    prevHash = row.hash;
    expected++;
    checked++;
  }
  return { ok: true, checked };
}

export const auditDTO = (e: FinancialAuditLogDoc): FinancialAuditEntryDTO => ({
  seq: e.seq,
  at: e.at.toISOString(),
  actorId: e.actorId ? String(e.actorId) : null,
  actorType: e.actorType,
  action: e.action,
  targetType: e.targetType,
  targetId: e.targetId,
  amountMinor: e.amountMinor,
  data: e.data,
  hash: e.hash,
});

export async function listFinancialAudit(query: {
  action?: string | undefined;
  targetId?: string | undefined;
  limit: number;
  cursor?: string | undefined;
}): Promise<CursorPage<FinancialAuditEntryDTO>> {
  const c = decodeCursor(query.cursor);
  const rows = await FinancialAuditLog.find({
    ...(query.action ? { action: query.action } : {}),
    ...(query.targetId ? { targetId: query.targetId } : {}),
    ...(c ? { seq: { $lt: c.k } } : {}),
  })
    .sort({ seq: -1 })
    .limit(query.limit + 1);
  return pageOf(rows, query.limit, (r) => r.seq, auditDTO);
}
