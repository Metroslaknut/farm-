import type { Types } from 'mongoose';
import type { AiUsageSummary, CriteriaDTO, MarketPointDTO, Page } from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { HttpError, notFound } from '../../lib/errors';
import {
  AiCriteria,
  AiMarketPrice,
  AiUsageLog,
  AnimalType,
  type AiCriteriaDoc,
} from '../../models';
import { recordAudit } from '../../services/audit.service';
import { authorOf, authorsById } from '../community/shared';
import { getNumberSetting } from '../settings/settings.service';
import type { AiProvider } from './provider';

const err = (status: number, code: string, message: string, path?: string) =>
  new HttpError(status, code, message, path ? [{ path, message }] : undefined);

async function criteriaDTOs(rows: AiCriteriaDoc[]): Promise<CriteriaDTO[]> {
  const [people, types] = await Promise.all([
    authorsById(rows.map((r) => r.createdBy)),
    AnimalType.find({ key: { $in: [...new Set(rows.map((r) => r.animalTypeKey))] } }),
  ]);
  const names = new Map(types.map((t) => [t.key, t.name]));
  return rows.map((r) => ({
    id: String(r._id),
    animalTypeKey: r.animalTypeKey,
    animalTypeName: names.get(r.animalTypeKey) ?? r.animalTypeKey,
    version: r.version,
    active: r.active,
    rules: r.rules,
    source: r.source,
    validated: r.validated,
    validationReference: r.validationReference ?? null,
    createdAt: r.createdAt.toISOString(),
    createdBy: authorOf(people, r.createdBy),
  }));
}

export async function listCriteria(q: { activeOnly?: boolean }): Promise<CriteriaDTO[]> {
  return criteriaDTOs(
    await AiCriteria.find(q.activeOnly ? { active: true } : {}).sort({
      animalTypeKey: 1,
      version: -1,
    }),
  );
}

/** A change is always a NEW version (old versions stay, inactive), so an assessment can point at exactly what it used. */
export async function createCriteria(
  actor: Actor,
  input: {
    animalTypeKey: string;
    rules: Record<string, unknown>;
    source: string;
    validated: boolean;
    validationReference?: string | undefined;
  },
): Promise<CriteriaDTO> {
  const type = await AnimalType.findOne({ key: input.animalTypeKey });
  if (!type) throw err(400, 'VALIDATION_ERROR', 'Unknown animal type', 'animalTypeKey');
  const latest = await AiCriteria.findOne({ animalTypeKey: input.animalTypeKey }).sort({
    version: -1,
  });
  const prev = await AiCriteria.findOneAndUpdate(
    { animalTypeKey: input.animalTypeKey, active: true },
    { $set: { active: false } },
  );
  try {
    const doc = await AiCriteria.create({
      animalTypeKey: input.animalTypeKey,
      version: (latest?.version ?? 0) + 1,
      active: true,
      rules: input.rules,
      source: input.source,
      validated: input.validated,
      validationReference: input.validationReference ?? null,
      createdBy: actor.userId,
    });
    await recordAudit({
      actorId: actor.userId,
      action: 'ai.criteria_created',
      targetType: 'ai_criteria',
      targetId: doc._id,
      metadata: {
        animalTypeKey: doc.animalTypeKey,
        version: doc.version,
        validated: doc.validated,
        source: doc.source,
      },
      ...(actor.ip ? { ip: actor.ip } : {}),
    });
    return (await criteriaDTOs([doc]))[0]!;
  } catch (error) {
    if (prev) await AiCriteria.updateOne({ _id: prev._id }, { $set: { active: true } });
    throw error;
  }
}

export async function deactivateCriteria(
  actor: Actor,
  id: Types.ObjectId,
  reason: string,
): Promise<CriteriaDTO> {
  const doc = await AiCriteria.findByIdAndUpdate(
    id,
    { $set: { active: false } },
    { returnDocument: 'after' },
  );
  if (!doc) throw notFound('Criteria not found');
  await recordAudit({
    actorId: actor.userId,
    action: 'ai.criteria_deactivated',
    targetType: 'ai_criteria',
    targetId: doc._id,
    metadata: { reason },
  });
  return (await criteriaDTOs([doc]))[0]!;
}

// ---------------------------------------------------------------------------
export async function createMarketPoint(
  actor: Actor,
  input: {
    animalTypeKey: string;
    kind: 'per_head' | 'per_kg';
    priceMinor: number;
    sex?: string | undefined;
    observedOn: string;
    region?: string | undefined;
    source: string;
    authorization: string;
  },
): Promise<MarketPointDTO> {
  if (!(await AnimalType.exists({ key: input.animalTypeKey })))
    throw err(400, 'VALIDATION_ERROR', 'Unknown animal type', 'animalTypeKey');
  const observedOn = new Date(`${input.observedOn}T00:00:00Z`);
  if (observedOn > new Date())
    throw err(400, 'VALIDATION_ERROR', 'A price cannot be observed in the future', 'observedOn');
  const doc = await AiMarketPrice.create({
    ...input,
    observedOn,
    sex: input.sex && input.sex !== 'unknown' ? input.sex : null,
    region: input.region ?? null,
    createdBy: actor.userId,
  });
  await recordAudit({
    actorId: actor.userId,
    action: 'ai.market_price_imported',
    targetType: 'ai_market_price',
    targetId: doc._id,
    metadata: { animalTypeKey: doc.animalTypeKey, kind: doc.kind, source: doc.source },
  });
  return marketDTO(doc);
}
const marketDTO = (d: InstanceType<typeof AiMarketPrice>): MarketPointDTO => ({
  id: String(d._id),
  animalTypeKey: d.animalTypeKey,
  kind: d.kind,
  priceMinor: d.priceMinor,
  sex: d.sex ?? null,
  observedOn: d.observedOn.toISOString().slice(0, 10),
  region: d.region ?? null,
  source: d.source,
  authorization: d.authorization,
  active: d.active,
});
export async function listMarketPoints(q: {
  animalTypeKey?: string | undefined;
  page: number;
  pageSize: number;
}): Promise<Page<MarketPointDTO>> {
  const filter = q.animalTypeKey ? { animalTypeKey: q.animalTypeKey } : {};
  const [total, rows] = await Promise.all([
    AiMarketPrice.countDocuments(filter),
    AiMarketPrice.find(filter)
      .sort({ observedOn: -1, _id: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize),
  ]);
  return { items: rows.map(marketDTO), page: q.page, pageSize: q.pageSize, total };
}
export async function deactivateMarketPoint(
  actor: Actor,
  id: Types.ObjectId,
  reason: string,
): Promise<MarketPointDTO> {
  const doc = await AiMarketPrice.findByIdAndUpdate(
    id,
    { $set: { active: false } },
    { returnDocument: 'after' },
  );
  if (!doc) throw notFound('Market price not found');
  await recordAudit({
    actorId: actor.userId,
    action: 'ai.market_price_deactivated',
    targetType: 'ai_market_price',
    targetId: doc._id,
    metadata: { reason },
  });
  return marketDTO(doc);
}

// ---------------------------------------------------------------------------
export async function usageSummary(
  days: number,
  provider: AiProvider | null,
): Promise<AiUsageSummary> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await AiUsageLog.find({ createdAt: { $gte: since } })
    .select('status errorCode inputTokens outputTokens costMicros latencyMs createdAt')
    .lean();
  const t = {
    calls: 0,
    ok: 0,
    errors: 0,
    rejected: 0,
    skipped: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostMicros: 0,
  };
  const byDay = new Map<string, AiUsageSummary['byDay'][number]>();
  const codes = new Map<string, number>();
  const latencies: number[] = [];
  for (const r of rows) {
    t.calls++;
    if (r.status === 'ok') t.ok++;
    else if (r.status === 'error') t.errors++;
    else if (r.status === 'rejected') t.rejected++;
    else t.skipped++;
    t.inputTokens += r.inputTokens;
    t.outputTokens += r.outputTokens;
    t.estimatedCostMicros += r.costMicros;
    if (r.status === 'ok' || r.status === 'error') latencies.push(r.latencyMs);
    if (r.errorCode) codes.set(r.errorCode, (codes.get(r.errorCode) ?? 0) + 1);
    const day = r.createdAt.toISOString().slice(0, 10);
    const d = byDay.get(day) ?? {
      day,
      calls: 0,
      errors: 0,
      rejected: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostMicros: 0,
    };
    d.calls++;
    if (r.status === 'error') d.errors++;
    if (r.status === 'rejected') d.rejected++;
    d.inputTokens += r.inputTokens;
    d.outputTokens += r.outputTokens;
    d.estimatedCostMicros += r.costMicros;
    byDay.set(day, d);
  }
  latencies.sort((a, b) => a - b);
  const attempted = t.ok + t.errors + t.rejected;
  const startOfDay = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()),
  );
  const [limit, usedToday, inRate, outRate] = await Promise.all([
    getNumberSetting('ai.dailyNarrativeLimit', 0, 1_000_000),
    AiUsageLog.countDocuments({ createdAt: { $gte: startOfDay }, status: { $ne: 'skipped' } }),
    getNumberSetting('ai.inputCostPerMillionMicros', 0, 1e12),
    getNumberSetting('ai.outputCostPerMillionMicros', 0, 1e12),
  ]);
  return {
    days,
    provider: provider?.name ?? 'none',
    configured: provider !== null,
    totals: {
      ...t,
      errorRate:
        attempted > 0 ? Math.round(((t.errors + t.rejected) / attempted) * 1000) / 1000 : null,
      p95LatencyMs: latencies.length
        ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)]!
        : null,
    },
    byDay: [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)),
    byErrorCode: [...codes.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count),
    budget: { dailyLimit: limit, usedToday },
    costRatesConfigured: inRate > 0 || outRate > 0,
  };
}
