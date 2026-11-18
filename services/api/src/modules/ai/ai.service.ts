import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import {
  ASSESSMENT_DISCLAIMER,
  type AiNarrative,
  type AssessmentDTO,
  type AssessmentListItem,
  type Page,
  type ReviewDecision,
} from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { conflict, forbidden, notFound } from '../../lib/errors';
import {
  AiAssessment,
  AiCriteria,
  AiUsageLog,
  Animal,
  AnimalType,
  FarmExpense,
  HealthRecord,
  Listing,
  WeightRecord,
  type AiAssessmentDoc,
} from '../../models';
import { recordAudit } from '../../services/audit.service';
import { authorOf, authorsById } from '../community/shared';
import { computeFee } from '../finance/commission.service';
import { assertFarmActive, requireFarmPermission, type FarmAccess } from '../farms/farm-access';
import { OPEN_LISTING_STATUSES } from '@farmplus/shared-types';
import {
  getBooleanSetting,
  getNumberSetting,
  getStringSetting,
} from '../settings/settings.service';
import { ENGINE_VERSION, computeAssessment, type EngineInput, type EngineResult } from './engine';
import { loadMarketBases } from './market';
import {
  NARRATIVE_LABEL,
  SYSTEM_PROMPT,
  buildFacts,
  noNarrative,
  userPrompt,
  validateNarrative,
} from './narrative';
import { AiProviderError, type AiProvider } from './provider';

export interface AiDeps {
  provider: AiProvider | null;
  timeoutMs: number;
  maxOutputTokens: number;
}

const startOfUtcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

// ---------------------------------------------------------------------------
// Monitoring: every provider call (or skipped call) is a row with tokens, cost, latency and error code — never any text.
// ---------------------------------------------------------------------------
async function costMicros(inputTokens: number, outputTokens: number): Promise<number> {
  const [i, o] = await Promise.all([
    getNumberSetting('ai.inputCostPerMillionMicros', 0, 1e12),
    getNumberSetting('ai.outputCostPerMillionMicros', 0, 1e12),
  ]);
  return Math.round((inputTokens * i + outputTokens * o) / 1_000_000);
}

async function log(row: {
  provider: string;
  model: string;
  status: 'ok' | 'error' | 'rejected' | 'skipped';
  errorCode?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  assessmentId?: Types.ObjectId;
  userId: string;
  farmId: Types.ObjectId;
}) {
  const inputTokens = row.inputTokens ?? 0;
  const outputTokens = row.outputTokens ?? 0;
  await AiUsageLog.create({
    provider: row.provider,
    model: row.model,
    status: row.status,
    errorCode: row.errorCode ?? null,
    inputTokens,
    outputTokens,
    costMicros: await costMicros(inputTokens, outputTokens),
    latencyMs: row.latencyMs ?? 0,
    assessmentId: row.assessmentId ?? null,
    userId: row.userId,
    farmId: row.farmId,
  }).catch(() => undefined); // monitoring must never break an assessment
}

async function narrativeBudget(
  userId: string,
  now: Date,
): Promise<{ ok: boolean; code?: string; reason?: string }> {
  if (!(await getBooleanSetting('ai.narrativeEnabled')))
    return {
      ok: false,
      code: 'disabled',
      reason: 'AI explanations are switched off by the platform',
    };
  const since = startOfUtcDay(now);
  const [platform, mine, platformMax, userMax] = await Promise.all([
    AiUsageLog.countDocuments({ createdAt: { $gte: since }, status: { $ne: 'skipped' } }),
    AiUsageLog.countDocuments({ createdAt: { $gte: since }, status: { $ne: 'skipped' }, userId }),
    getNumberSetting('ai.dailyNarrativeLimit', 0, 1_000_000),
    getNumberSetting('ai.perUserDailyNarratives', 0, 10_000),
  ]);
  if (platform >= platformMax)
    return {
      ok: false,
      code: 'budget_platform',
      reason: 'The daily AI budget of the platform is used up',
    };
  if (mine >= userMax)
    return {
      ok: false,
      code: 'budget_user',
      reason: 'You reached your daily limit of AI explanations',
    };
  return { ok: true };
}

// ---------------------------------------------------------------------------
export async function createAssessment(
  actor: Actor,
  access: FarmAccess,
  animalId: Types.ObjectId,
  opts: { includeAiExplanation: boolean },
  deps: AiDeps,
  now: Date = new Date(),
): Promise<AssessmentDTO> {
  requireFarmPermission(access, 'animals.read');
  requireFarmPermission(access, 'records.read');
  // Running an assessment can cost money (AI) and creates a record in the farm's history: members only, not platform staff.
  if (access.via !== 'member')
    throw forbidden('Only members of the farm can run an assessment', 'MEMBERS_ONLY');
  assertFarmActive(access); // archived farms are read-only: no new assessments (and no AI spend)
  const animal = await Animal.findOne({ _id: animalId, farmId: access.farm._id });
  if (!animal) throw notFound('Animal not found');
  if (animal.archivedAt) throw conflict('This animal is archived', 'ANIMAL_ARCHIVED');
  const type = await AnimalType.findById(animal.animalTypeId);
  if (!type) throw notFound('Animal type not found');
  const canSeeCosts = access.permissions.has('expenses.read');

  const [
    weights,
    health,
    expenses,
    farmWide,
    criteriaDoc,
    openListing,
    minSamples,
    windowDays,
    freshDays,
  ] = await Promise.all([
    WeightRecord.find({ farmId: access.farm._id, animalId, voided: false })
      .sort({ weighedOn: 1 })
      .limit(500)
      .lean(),
    HealthRecord.find({ farmId: access.farm._id, animalId, voided: false })
      .sort({ recordedOn: -1 })
      .limit(500)
      .lean(),
    canSeeCosts
      ? FarmExpense.find({ farmId: access.farm._id, animalId, voided: false }).lean()
      : Promise.resolve(null),
    canSeeCosts
      ? FarmExpense.countDocuments({ farmId: access.farm._id, animalId: null, voided: false })
      : Promise.resolve(null),
    AiCriteria.findOne({ animalTypeKey: type.key, active: true }),
    Listing.exists({ animalId, status: { $in: OPEN_LISTING_STATUSES } }),
    getNumberSetting('ai.minMarketSamples', 1, 1000),
    getNumberSetting('ai.marketWindowDays', 7, 3650),
    getNumberSetting('ai.weightFreshDays', 1, 365),
  ]);
  const market = await loadMarketBases({
    typeKey: type.key,
    typeName: type.name,
    sex: animal.sex,
    farmId: access.farm._id,
    windowDays,
    now,
  });

  const base: Omit<EngineInput, 'fee'> = {
    now,
    animal: {
      status: animal.currentStatus,
      sex: animal.sex,
      typeKey: type.key,
      typeName: type.name,
      birthDate: animal.birthDate ?? null,
      birthDateEstimated: animal.birthDateEstimated,
      acquisitionDate: animal.acquisitionDate ?? null,
      originKind: animal.origin.kind,
    },
    weights: weights.map((w) => ({ on: w.weighedOn, kg: w.weightKg, method: w.method })),
    health: health.map((h) => ({
      type: h.type,
      on: h.recordedOn,
      outcome: h.outcome ?? null,
      withdrawalEndsOn: h.withdrawalEndsOn ?? null,
    })),
    expenses: expenses
      ? expenses.map((e) => ({
          category: e.category,
          on: e.expenseDate,
          amountMinor: e.amountMinor,
        }))
      : null,
    farmWideExpenseCount: farmWide,
    criteria: criteriaDoc
      ? {
          key: criteriaDoc.animalTypeKey,
          version: criteriaDoc.version,
          validated: criteriaDoc.validated,
          validationReference: criteriaDoc.validationReference ?? null,
          source: criteriaDoc.source,
          rules: criteriaDoc.rules,
        }
      : null,
    settings: { weightFreshDays: freshDays, minMarketSamples: minSamples },
    market,
    hasOpenListing: Boolean(openListing),
  };
  // Pass 1 finds the price range; the platform fee for those prices comes from the commission rules (read-only); pass 2 is final.
  const first = computeAssessment({ ...base, fee: () => 0 });
  const fees = new Map<number, number>();
  if (first.estimatedPriceRange)
    for (const p of [
      first.estimatedPriceRange.lowMinor,
      first.estimatedPriceRange.midMinor,
      first.estimatedPriceRange.highMinor,
    ])
      fees.set(p, (await computeFee(p, type.key, now)).feeMinor);
  const result = computeAssessment({ ...base, fee: (p) => fees.get(p) ?? 0 });

  // ---- optional AI explanation (never required, never trusted until validated)
  const assessmentId = new Types.ObjectId();
  const facts = buildFacts(result, { typeName: type.name, sex: animal.sex });
  let narrative: AiNarrative = noNarrative('not_requested', 'No AI explanation was requested');
  if (opts.includeAiExplanation)
    narrative = await explain(actor, access, assessmentId, facts, deps, now);

  const recommendations = result.recommendations.map((r, i) => ({
    id: `rec-${i + 1}-${randomUUID().slice(0, 6)}`,
    code: r.code,
    text: r.text,
    dismissedAt: null,
    dismissedBy: null,
  }));
  const aiPart = narrative.status === 'ok' ? ` · ai:${narrative.provider}:${narrative.model}` : '';
  const criteriaPart = criteriaDoc
    ? ` · criteria:${criteriaDoc.animalTypeKey}@v${criteriaDoc.version}${criteriaDoc.validated ? '' : ' (unvalidated)'}`
    : '';
  const modelVersion = `${ENGINE_VERSION}${criteriaPart}${aiPart}`;

  const inputs = {
    asOf: now.toISOString(),
    animal: {
      typeKey: type.key,
      sex: animal.sex,
      breed: animal.breed ?? null,
      status: animal.currentStatus,
      ageDays: result.ageDays,
      originKind: animal.origin.kind,
    },
    weights: weights
      .slice(-100)
      .map((w) => [w.weighedOn.toISOString().slice(0, 10), w.weightKg, w.method]),
    healthRecordCount: health.length,
    expenseTotalsByCategory: result.costSummary?.byCategory ?? null,
    settings: {
      minMarketSamples: minSamples,
      marketWindowDays: windowDays,
      weightFreshDays: freshDays,
    },
    market: result.priceBases.map((b) => ({
      source: b.source,
      sampleSize: b.sampleSize,
      p25Minor: b.p25Minor,
      medianMinor: b.medianMinor,
      p75Minor: b.p75Minor,
      used: b.used,
    })),
    criteria: criteriaDoc
      ? { id: String(criteriaDoc._id), version: criteriaDoc.version, rules: criteriaDoc.rules }
      : null,
    permissions: { health: true, costs: canSeeCosts },
    aiFactsSent: narrative.status === 'ok' || narrative.status === 'rejected' ? facts : null,
  };
  const { recommendations: _recs, ...stored } = result;
  void _recs;
  const doc = (await AiAssessment.create({
    _id: assessmentId,
    farmId: access.farm._id,
    animalId,
    animalCode: animal.animalCode,
    requestedBy: actor.userId,
    assessmentDate: now,
    animalTypeKey: type.key,
    animalTypeName: type.name,
    sex: animal.sex,
    result: stored,
    inputs,
    engineVersion: ENGINE_VERSION,
    criteriaRef: criteriaDoc
      ? {
          id: criteriaDoc._id,
          key: criteriaDoc.animalTypeKey,
          version: criteriaDoc.version,
          validated: criteriaDoc.validated,
          source: criteriaDoc.source,
        }
      : null,
    narrative,
    modelVersion,
    recommendations,
    review: { status: 'pending', history: [] },
  } as never)) as unknown as AiAssessmentDoc;
  await recordAudit({
    actorId: actor.userId,
    action: 'ai.assessment_created',
    targetType: 'animal',
    targetId: animalId,
    metadata: {
      assessmentId: String(assessmentId),
      modelVersion,
      confidence: result.confidence.level,
      ai: narrative.status,
    },
    ...(actor.ip ? { ip: actor.ip } : {}),
  });
  return toDTO(doc, canSeeCosts);
}

async function explain(
  actor: Actor,
  access: FarmAccess,
  assessmentId: Types.ObjectId,
  facts: Record<string, unknown>,
  deps: AiDeps,
  now: Date,
): Promise<AiNarrative> {
  const provider = deps.provider;
  if (!provider) return noNarrative('skipped', 'No AI provider is configured on this server');
  const meta = {
    provider: provider.name,
    model: provider.model,
    userId: actor.userId,
    farmId: access.farm._id,
    assessmentId,
  };
  const budget = await narrativeBudget(actor.userId, now);
  if (!budget.ok) {
    await log({ ...meta, status: 'skipped', errorCode: budget.code ?? 'skipped' });
    return noNarrative('skipped', budget.reason ?? 'Skipped', provider.name, provider.model);
  }
  const t0 = Date.now();
  let response;
  try {
    response = await provider.complete({
      system: SYSTEM_PROMPT,
      user: userPrompt(facts),
      maxTokens: deps.maxOutputTokens,
      timeoutMs: deps.timeoutMs,
    });
  } catch (error) {
    const code = error instanceof AiProviderError ? error.code : 'unavailable';
    await log({ ...meta, status: 'error', errorCode: code, latencyMs: Date.now() - t0 });
    return noNarrative(
      'failed',
      'The AI service could not be reached, so there is no explanation. The figures are unaffected.',
      provider.name,
      provider.model,
    );
  }
  const latencyMs = Date.now() - t0;
  const check = validateNarrative(
    response.text,
    facts,
    await getStringSetting('ai.blockedNarrativeTerms'),
  );
  if (!check.ok) {
    // Invalid output is discarded safely: it is neither shown nor stored, and the assessment carries on without it.
    await log({
      ...meta,
      model: response.model,
      status: 'rejected',
      errorCode: check.code,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      latencyMs,
    });
    return noNarrative(
      'rejected',
      `The AI output failed validation (${check.code}) and was discarded.`,
      provider.name,
      response.model,
    );
  }
  await log({
    ...meta,
    model: response.model,
    status: 'ok',
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    latencyMs,
  });
  return {
    status: 'ok',
    provider: provider.name,
    model: response.model,
    summary: check.value.summary,
    observations: check.value.observations,
    questionsForOwner: check.value.questionsForOwner,
    reason: null,
    label: NARRATIVE_LABEL,
  };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------
/**
 * Recorded costs are money: only members with `expenses.read` may see them (owners and managers). An assessment stores
 * the full result once, so the redaction happens here, per reader — including the AI explanation, which may have been
 * written from those cost figures.
 */
async function toDTO(doc: AiAssessmentDoc, canSeeCosts: boolean): Promise<AssessmentDTO> {
  const ids = [
    doc.requestedBy,
    ...(doc.review.by ? [doc.review.by] : []),
    ...doc.recommendations.flatMap((r) => (r.dismissedBy ? [r.dismissedBy] : [])),
  ];
  const people = await authorsById(ids);
  const r = doc.result as unknown as Omit<EngineResult, 'recommendations'>;
  return {
    id: String(doc._id),
    animalId: String(doc.animalId),
    animalCode: doc.animalCode,
    farmId: String(doc.farmId),
    assessmentDate: doc.assessmentDate.toISOString(),
    animalType: { key: doc.animalTypeKey, name: doc.animalTypeName },
    sex: doc.sex,
    readinessScore: r.readinessScore,
    readinessScoreNote: r.readinessScoreNote,
    readinessFactors: r.readinessFactors,
    readinessCounts: r.readinessCounts,
    estimatedPriceRange: r.estimatedPriceRange,
    priceBases: r.priceBases,
    expectedProceeds: canSeeCosts
      ? r.expectedProceeds
      : r.expectedProceeds.map((p) => ({ ...p, netOverRecordedCostMinor: null })),
    costSummary: canSeeCosts ? r.costSummary : null,
    growth: r.growth,
    health: r.health,
    dataQualityWarnings: r.dataQualityWarnings,
    confidence: r.confidence,
    recommendations: doc.recommendations.map((x) => ({
      id: x.id,
      code: x.code,
      text: x.text,
      dismissed: Boolean(x.dismissedAt),
      dismissedAt: x.dismissedAt ? new Date(x.dismissedAt).toISOString() : null,
      dismissedBy: x.dismissedBy ? authorOf(people, x.dismissedBy) : null,
    })),
    narrative:
      canSeeCosts || !r.costSummary
        ? (doc.narrative as unknown as AiNarrative)
        : withheldNarrative(doc.narrative as unknown as AiNarrative),
    modelVersion: doc.modelVersion,
    criteria: doc.criteriaRef
      ? {
          key: doc.criteriaRef.key,
          version: doc.criteriaRef.version,
          validated: doc.criteriaRef.validated,
          source: doc.criteriaRef.source,
        }
      : null,
    review: {
      status: doc.review.status,
      reviewedBy: doc.review.by ? authorOf(people, doc.review.by) : null,
      reviewedAt: doc.review.at ? new Date(doc.review.at).toISOString() : null,
      note: doc.review.note ?? null,
    },
    requestedBy: authorOf(people, doc.requestedBy),
    disclaimer: ASSESSMENT_DISCLAIMER,
  };
}

const withheldNarrative = (n: AiNarrative): AiNarrative =>
  n.status === 'ok'
    ? {
        ...n,
        status: 'skipped',
        summary: null,
        observations: [],
        questionsForOwner: [],
        reason: 'The explanation refers to recorded costs, which your farm role cannot see.',
      }
    : n;

const item = (d: AiAssessmentDoc): AssessmentListItem => {
  const r = d.result as unknown as Omit<EngineResult, 'recommendations'>;
  return {
    id: String(d._id),
    animalId: String(d.animalId),
    animalCode: d.animalCode,
    assessmentDate: d.assessmentDate.toISOString(),
    readinessScore: r.readinessScore,
    priceRange: r.estimatedPriceRange
      ? { lowMinor: r.estimatedPriceRange.lowMinor, highMinor: r.estimatedPriceRange.highMinor }
      : null,
    confidence: r.confidence.level,
    warningCount: r.dataQualityWarnings.filter((w) => w.severity !== 'info').length,
    review: d.review.status,
    modelVersion: d.modelVersion,
  };
};

export async function loadFarmAssessment(
  access: FarmAccess,
  id: Types.ObjectId,
): Promise<AiAssessmentDoc> {
  const d = await AiAssessment.findOne({ _id: id, farmId: access.farm._id }); // the farm id is part of every lookup
  if (!d) throw notFound('Assessment not found');
  return d;
}

export async function getAssessment(
  access: FarmAccess,
  id: Types.ObjectId,
): Promise<AssessmentDTO> {
  requireFarmPermission(access, 'animals.read');
  return toDTO(await loadFarmAssessment(access, id), access.permissions.has('expenses.read'));
}

export async function listAssessments(
  access: FarmAccess,
  q: {
    page: number;
    pageSize: number;
    status?: 'pending' | 'accepted' | 'dismissed' | undefined;
    animalId?: string | undefined;
  },
  /** Listing under `/animals/:animalId`: an animal of another farm (or none) is a 404, like every animal sub-route. */
  animalScoped = false,
): Promise<Page<AssessmentListItem>> {
  requireFarmPermission(access, 'animals.read');
  if (
    animalScoped &&
    !(await Animal.exists({ _id: new Types.ObjectId(q.animalId), farmId: access.farm._id }))
  )
    throw notFound('Animal not found');
  const filter = {
    farmId: access.farm._id,
    ...(q.animalId ? { animalId: new Types.ObjectId(q.animalId) } : {}),
    ...(q.status ? { 'review.status': q.status } : {}),
  };
  const [total, rows] = await Promise.all([
    AiAssessment.countDocuments(filter),
    AiAssessment.find(filter)
      .sort({ assessmentDate: -1, _id: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize),
  ]);
  return { items: rows.map(item), page: q.page, pageSize: q.pageSize, total };
}

/** The owner's decision about a recommendation set. It records a decision; it does not list, price or sell anything. */
export async function reviewAssessment(
  actor: Actor,
  access: FarmAccess,
  id: Types.ObjectId,
  decision: ReviewDecision,
  note?: string,
): Promise<AssessmentDTO> {
  requireFarmPermission(access, 'listings.manage');
  assertFarmActive(access); // archived farms are read-only: no new decisions either
  const d = await loadFarmAssessment(access, id);
  const at = new Date();
  const updated = await AiAssessment.findOneAndUpdate(
    { _id: d._id, farmId: access.farm._id },
    {
      $set: {
        'review.status': decision,
        'review.by': new Types.ObjectId(actor.userId),
        'review.at': at,
        'review.note': note ?? null,
      },
      $push: {
        'review.history': {
          status: decision,
          by: new Types.ObjectId(actor.userId),
          at,
          note: note ?? null,
        },
      },
    },
    { returnDocument: 'after' },
  );
  await recordAudit({
    actorId: actor.userId,
    action: `ai.assessment_${decision}`,
    targetType: 'animal',
    targetId: d.animalId,
    metadata: { assessmentId: String(d._id) },
    ...(actor.ip ? { ip: actor.ip } : {}),
  });
  return toDTO(updated!, access.permissions.has('expenses.read'));
}

export async function dismissRecommendation(
  actor: Actor,
  access: FarmAccess,
  id: Types.ObjectId,
  recId: string,
): Promise<AssessmentDTO> {
  requireFarmPermission(access, 'listings.manage');
  assertFarmActive(access); // archived farms are read-only: no new decisions either
  const d = await loadFarmAssessment(access, id);
  if (!d.recommendations.some((r) => r.id === recId)) throw notFound('Recommendation not found');
  const updated = await AiAssessment.findOneAndUpdate(
    { _id: d._id, farmId: access.farm._id, 'recommendations.id': recId } as never,
    {
      $set: {
        'recommendations.$.dismissedAt': new Date(),
        'recommendations.$.dismissedBy': new Types.ObjectId(actor.userId),
      },
    } as never,
    { returnDocument: 'after' },
  );
  return toDTO(updated!, access.permissions.has('expenses.read'));
}
