import type { Types } from 'mongoose';
import {
  calculateCommission,
  rulesOverlap,
  selectCommissionRule,
  type CommissionRuleLike,
} from '@farmplus/shared-utils';
import type { CommissionRuleDTO, FeeSnapshot } from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { notFound } from '../../lib/errors';
import { CommissionRule, type CommissionRuleDoc } from '../../models';
import { getNumberSetting } from '../settings/settings.service';
import { recordFinancial, userActor } from './audit';
import { err } from './shared';

export const ruleDTO = (r: CommissionRuleDoc): CommissionRuleDTO => ({
  id: String(r._id),
  name: r.name,
  feeBps: r.feeBps,
  minFeeMinor: r.minFeeMinor ?? null,
  maxFeeMinor: r.maxFeeMinor ?? null,
  priceMinMinor: r.priceMinMinor ?? null,
  priceMaxMinor: r.priceMaxMinor ?? null,
  categories: r.categories,
  startsAt: r.startsAt.toISOString(),
  endsAt: r.endsAt?.toISOString() ?? null,
  priority: r.priority,
  active: r.active,
  version: r.version,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const like = (r: CommissionRuleDoc): CommissionRuleLike & { id: string } => ({
  id: String(r._id),
  name: r.name,
  version: r.version,
  feeBps: r.feeBps,
  minFeeMinor: r.minFeeMinor ?? null,
  maxFeeMinor: r.maxFeeMinor ?? null,
  priceMinMinor: r.priceMinMinor ?? null,
  priceMaxMinor: r.priceMaxMinor ?? null,
  categories: r.categories,
  startsAt: r.startsAt,
  endsAt: r.endsAt ?? null,
  priority: r.priority,
  active: r.active,
});

/**
 * The fee for a sale, decided ONCE at checkout and returned together with the full calculation. The caller stores the
 * snapshot on the order, so later rule edits can never change an existing order's fee.
 */
export async function computeFee(
  baseMinor: number,
  categoryKey: string | null,
  at = new Date(),
): Promise<FeeSnapshot> {
  const rules = (await CommissionRule.find({ active: true, startsAt: { $lte: at } })).map(like);
  const rule = selectCommissionRule(rules, { priceMinor: baseMinor, categoryKey, at });
  if (rule) {
    const b = calculateCommission(baseMinor, rule.feeBps, rule);
    return {
      source: 'rule',
      ruleId: rule.id,
      ruleName: rule.name,
      ruleVersion: rule.version,
      categoryKey,
      evaluatedAt: at.toISOString(),
      ...b,
    };
  }
  // No rule matches: fall back to the platform-wide default (0 = no fee).
  const bps = await getNumberSetting('orders.platformFeeBps', 0, 3000);
  return {
    source: 'default_setting',
    ruleId: null,
    ruleName: null,
    ruleVersion: null,
    categoryKey,
    evaluatedAt: at.toISOString(),
    ...calculateCommission(baseMinor, bps),
  };
}

type RuleInput = {
  name: string;
  feeBps: number;
  minFeeMinor?: number | null | undefined;
  maxFeeMinor?: number | null | undefined;
  priceMinMinor?: number | null | undefined;
  priceMaxMinor?: number | null | undefined;
  categories: string[];
  startsAt: string;
  endsAt?: string | null | undefined;
  priority: number;
  reason: string;
};

/** Equal-priority rules that could match the same sale would make the outcome ambiguous: refuse them at save time. */
async function assertNoConflict(candidate: CommissionRuleLike, exceptId?: Types.ObjectId) {
  if (!candidate.active) return;
  const others = await CommissionRule.find({
    active: true,
    priority: candidate.priority,
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  });
  const clash = others.find((o) => rulesOverlap(candidate, like(o)));
  if (clash)
    throw err(
      409,
      'RULE_CONFLICT',
      `“${clash.name}” has the same priority and could apply to the same sales. Give one of them a different priority or narrow its scope.`,
    );
}

export async function listRules(): Promise<CommissionRuleDTO[]> {
  return (await CommissionRule.find().sort({ active: -1, priority: -1, createdAt: -1 })).map(
    ruleDTO,
  );
}

export async function createRule(actor: Actor, input: RuleInput): Promise<CommissionRuleDTO> {
  const doc = new CommissionRule({
    name: input.name,
    feeBps: input.feeBps,
    minFeeMinor: input.minFeeMinor ?? null,
    maxFeeMinor: input.maxFeeMinor ?? null,
    priceMinMinor: input.priceMinMinor ?? null,
    priceMaxMinor: input.priceMaxMinor ?? null,
    categories: [...new Set(input.categories)],
    startsAt: new Date(input.startsAt),
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
    priority: input.priority,
    active: true,
    createdBy: actor.userId,
    updatedBy: actor.userId,
  });
  await assertNoConflict(like(doc));
  await doc.save();
  await recordFinancial({
    actor: userActor(actor.userId),
    action: 'commission_rule.created',
    targetType: 'commission_rule',
    targetId: doc._id,
    data: { reason: input.reason, rule: ruleDTO(doc) },
  });
  return ruleDTO(doc);
}

export async function updateRule(
  actor: Actor,
  id: Types.ObjectId,
  input: Partial<RuleInput> & { reason: string; active?: boolean | undefined },
): Promise<CommissionRuleDTO> {
  const doc = await CommissionRule.findById(id);
  if (!doc) throw notFound('Commission rule not found');
  const before = ruleDTO(doc);
  const set = <K extends keyof RuleInput>(
    key: K,
    apply: (v: NonNullable<RuleInput[K]>) => void,
  ) => {
    if (input[key] !== undefined) apply(input[key] as NonNullable<RuleInput[K]>);
  };
  set('name', (v) => (doc.name = v));
  set('feeBps', (v) => (doc.feeBps = v));
  if (input.minFeeMinor !== undefined) doc.minFeeMinor = input.minFeeMinor;
  if (input.maxFeeMinor !== undefined) doc.maxFeeMinor = input.maxFeeMinor;
  if (input.priceMinMinor !== undefined) doc.priceMinMinor = input.priceMinMinor;
  if (input.priceMaxMinor !== undefined) doc.priceMaxMinor = input.priceMaxMinor;
  set('categories', (v) => (doc.categories = [...new Set(v)]));
  set('startsAt', (v) => (doc.startsAt = new Date(v)));
  if (input.endsAt !== undefined) doc.endsAt = input.endsAt ? new Date(input.endsAt) : null;
  set('priority', (v) => (doc.priority = v));
  if (input.active !== undefined) doc.active = input.active;
  if (doc.minFeeMinor != null && doc.maxFeeMinor != null && doc.minFeeMinor > doc.maxFeeMinor)
    throw err(400, 'VALIDATION_ERROR', 'Maximum fee must not be below the minimum fee');
  if (
    doc.priceMinMinor != null &&
    doc.priceMaxMinor != null &&
    doc.priceMinMinor > doc.priceMaxMinor
  )
    throw err(400, 'VALIDATION_ERROR', 'Maximum price must not be below the minimum price');
  if (doc.endsAt && doc.endsAt <= doc.startsAt)
    throw err(400, 'VALIDATION_ERROR', 'The end date must be after the start date');
  await assertNoConflict(like(doc), doc._id);
  doc.version += 1;
  doc.updatedBy = actor.userId as never;
  await doc.save();
  await recordFinancial({
    actor: userActor(actor.userId),
    action: input.active === false ? 'commission_rule.deactivated' : 'commission_rule.updated',
    targetType: 'commission_rule',
    targetId: doc._id,
    data: { reason: input.reason, before, after: ruleDTO(doc) },
  });
  return ruleDTO(doc);
}

/** What fee would apply to a sale of `priceMinor` in `categoryKey` right now (or at `at`)? Read-only. */
export const previewFee = (priceMinor: number, categoryKey: string | null, at?: Date) =>
  computeFee(priceMinor, categoryKey, at ?? new Date());
