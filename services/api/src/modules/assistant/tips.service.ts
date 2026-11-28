import { Types } from 'mongoose';
import type { AssistantTipDTO, AssistantTipRule } from '@farmplus/shared-types';
import { nextDay, thaiDayStart, thaiToday } from '@farmplus/validation';
import type { Actor } from '../../context';
import {
  Animal,
  AssistantTipState,
  FarmMember,
  HealthRecord,
  Listing,
  Negotiation,
  Registration,
  User,
} from '../../models';
import { loadFarmAccess, type FarmAccess } from '../farms/farm-access';
import { farmAnimalSummary, mayCreateFarm } from '../farms/farms.service';
import { sellEligibility } from '../marketplace/listings.service';

/**
 * Contextual tips (PR 5 of the help / assistant plan, docs/architecture/assistant.md): FIXED rules decide what is
 * suggested — no model is involved. Each rule reads only what the person may see: farm tips go through
 * `loadFarmAccess` (a stranger's farm is 404) and check the farm permission the figure needs. At most 3 tips, most
 * important first; tips the person hid, or snoozed until a later Thai day, are left out.
 *
 * Not built: "add and verify a second contact channel" — FARM+ has no way to add a phone or e-mail to an account
 * after registration, so there is nothing to point to.
 */
const SEVERITY_ORDER = { warning: 0, action: 1, info: 2 } as const;
/** Fixed order within a severity: the earlier, the more important. */
const RULE_ORDER: AssistantTipRule[] = [
  'withdrawal',
  'growth-outside',
  'seller-rejected',
  'offers-waiting',
  'first-animal',
  'weigh-overdue',
  'create-farm',
  'owner-request',
  'seller-apply',
  'enable-mfa',
  'owner-request-pending',
  'seller-pending',
  'listings-in-review',
];
export const MAX_TIPS = 3;
export const SNOOZE_DAYS = 7;

const ON_FARM = ['active', 'for_sale'] as const;
const OPEN_REGISTRATION = ['PENDING', 'UNDER_REVIEW'];

type Tip = AssistantTipDTO;
const tip = (
  rule: AssistantTipRule,
  severity: Tip['severity'],
  params: Tip['params'],
  action?: Tip['action'],
  farmId?: string,
): Tip => ({
  key: farmId ? `${rule}:${farmId}` : rule,
  rule,
  severity,
  params,
  ...(action ? { action } : {}),
});

const latest = (userId: string, type: 'farm_owner' | 'seller') =>
  Registration.findOne({ userId, type })
    .sort({ submittedAt: -1, _id: -1 })
    .select('status decision')
    .lean();

/** Tips about the person: farms, registrations, offers, listings, account security. */
async function personTips(actor: Actor, now: Date): Promise<Tip[]> {
  const userId = actor.userId;
  const uid = new Types.ObjectId(userId);
  const [memberships, owner, seller, user, eligibility] = await Promise.all([
    FarmMember.find({ userId: uid }).select('farmId role').lean(),
    latest(userId, 'farm_owner'),
    latest(userId, 'seller'),
    User.findById(uid).select('mfa.enabled').lean(),
    sellEligibility(actor),
  ]);
  const tips: Tip[] = [];

  if (memberships.length === 0) {
    if (await mayCreateFarm(actor))
      tips.push(tip('create-farm', 'action', {}, { route: '/farms/new' }));
    else if (owner && OPEN_REGISTRATION.includes(owner.status))
      tips.push(tip('owner-request-pending', 'info', {}, { route: '/farms/owner-request' }));
    else
      tips.push(
        tip(
          'owner-request',
          'action',
          owner?.status === 'REJECTED' ? { reason: owner.decision?.reason ?? '' } : {},
          { route: '/farms/owner-request' },
        ),
      );
  }

  // Selling: farms where this person is on the seller side (owner or manager).
  const sellerFarms = memberships
    .filter((m) => m.role === 'owner' || m.role === 'manager')
    .map((m) => m.farmId);
  const nowOpen = { status: 'open' as const, offerExpiresAt: { $gt: now } };
  const [readyToSell, offersAsBuyer, offersAsSeller, inReview] = await Promise.all([
    !eligibility.canSell && sellerFarms.length
      ? Animal.countDocuments({
          farmId: { $in: sellerFarms },
          archivedAt: null,
          currentStatus: 'for_sale',
        })
      : Promise.resolve(0),
    Negotiation.countDocuments({ buyerId: uid, turn: 'buyer', ...nowOpen }),
    sellerFarms.length
      ? Negotiation.countDocuments({ farmId: { $in: sellerFarms }, turn: 'seller', ...nowOpen })
      : Promise.resolve(0),
    Listing.countDocuments({ sellerId: uid, status: 'PENDING_REVIEW' }),
  ]);

  if (!eligibility.canSell) {
    if (seller?.status === 'REJECTED')
      tips.push(
        tip(
          'seller-rejected',
          'action',
          { reason: seller.decision?.reason ?? '' },
          { route: '/farms/seller' },
        ),
      );
    else if (seller && OPEN_REGISTRATION.includes(seller.status))
      tips.push(tip('seller-pending', 'info', {}, { route: '/farms/seller' }));
    else if (readyToSell > 0)
      tips.push(tip('seller-apply', 'action', { count: readyToSell }, { route: '/farms/seller' }));
  }
  const offers = offersAsBuyer + offersAsSeller;
  if (offers > 0)
    tips.push(tip('offers-waiting', 'action', { count: offers }, { route: '/market/offers' }));
  if (inReview > 0)
    tips.push(tip('listings-in-review', 'info', { count: inReview }, { route: '/market/sell' }));
  if (actor.access.roleKeys.includes('seller') && !user?.mfa?.enabled)
    tips.push(tip('enable-mfa', 'action', {}, { route: '/farms/settings' }));
  return tips;
}

/** Tips about one farm, limited to what this person may see on it. */
async function farmTips(access: FarmAccess, now: Date): Promise<Tip[]> {
  if (access.farm.status !== 'active' || !access.permissions.has('animals.read')) return [];
  const farmId = access.farm._id;
  const id = String(farmId);
  const base = `/farms/${id}`;
  const tips: Tip[] = [];
  const summary = await farmAnimalSummary(access);

  if (summary.totals.onFarm === 0) {
    if (access.permissions.has('animals.write'))
      tips.push(tip('first-animal', 'action', {}, { route: `${base}/animals/new` }, id));
    return tips;
  }
  // Growth figures are null without records.read, so these rules stay silent for such staff.
  if ((summary.totals.outsideStandard ?? 0) > 0)
    tips.push(
      tip(
        'growth-outside',
        'warning',
        { count: summary.totals.outsideStandard! },
        { route: `${base}/animals` },
        id,
      ),
    );
  if ((summary.totals.needsGrowthCheck ?? 0) > 0)
    tips.push(
      tip(
        'weigh-overdue',
        'action',
        { count: summary.totals.needsGrowthCheck!, days: summary.growthCheckDays },
        { route: `${base}/weights` },
        id,
      ),
    );

  // Withdrawal period: health records whose withdrawal end is today or later, for animals still on the farm.
  if (access.permissions.has('records.read')) {
    const today = thaiDayStart(now.getTime());
    const rows = await HealthRecord.aggregate<{ _id: Types.ObjectId; until: Date }>([
      { $match: { farmId, voided: false, withdrawalEndsOn: { $gte: today } } },
      { $group: { _id: '$animalId', until: { $max: '$withdrawalEndsOn' } } },
    ]);
    if (rows.length) {
      const onFarm = await Animal.find({
        _id: { $in: rows.map((r) => r._id) },
        farmId,
        archivedAt: null,
        currentStatus: { $in: [...ON_FARM] },
      })
        .select('_id')
        .lean();
      const keep = new Set(onFarm.map((a) => String(a._id)));
      const inWithdrawal = rows.filter((r) => keep.has(String(r._id)));
      if (inWithdrawal.length) {
        const until = new Date(Math.max(...inWithdrawal.map((r) => r.until.getTime())));
        tips.push(
          tip(
            'withdrawal',
            'warning',
            { count: inWithdrawal.length, until: until.toISOString().slice(0, 10) },
            { route: `${base}/health` },
            id,
          ),
        );
      }
    }
  }
  return tips;
}

export async function suggestions(
  actor: Actor,
  input: { farmId?: string | undefined },
  now: Date = new Date(),
): Promise<AssistantTipDTO[]> {
  // Farm access first: a farm the person cannot see is 404 before anything else is read.
  const access = input.farmId
    ? await loadFarmAccess(actor, new Types.ObjectId(input.farmId))
    : null;
  const [mine, farm, states] = await Promise.all([
    personTips(actor, now),
    access ? farmTips(access, now) : Promise.resolve([]),
    AssistantTipState.find({ userId: actor.userId }).select('key hidden snoozedUntil').lean(),
  ]);
  const today = thaiToday(now.getTime());
  const quiet = new Set(
    states.filter((s) => s.hidden || (s.snoozedUntil && s.snoozedUntil > today)).map((s) => s.key),
  );
  return [...farm, ...mine]
    .filter((t) => !quiet.has(t.key))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule),
    )
    .slice(0, MAX_TIPS);
}

/** "Hide" for good, or "remind me in 7 days" (counted in Thai calendar days). */
export async function saveTipState(
  userId: string,
  key: string,
  action: 'hide' | 'snooze',
  now: Date = new Date(),
): Promise<{ key: string; hidden: boolean; snoozedUntil: string | null }> {
  let until = thaiToday(now.getTime());
  for (let i = 0; i < SNOOZE_DAYS; i++) until = nextDay(until);
  const set =
    action === 'hide'
      ? { hidden: true, snoozedUntil: null }
      : { hidden: false, snoozedUntil: until };
  await AssistantTipState.updateOne({ userId, key }, { $set: set }, { upsert: true });
  return { key, ...set };
}
