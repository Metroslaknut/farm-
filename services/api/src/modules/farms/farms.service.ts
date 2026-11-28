import type { Types } from 'mongoose';
import type {
  FarmAnimalSummaryDTO,
  FarmAnimalTypeCount,
  FarmDetail,
  FarmRole,
  FarmSetupDTO,
  FarmSummary,
  Page,
} from '@farmplus/shared-types';
import { thaiDayStart, type CreateFarmInput, type UpdateFarmInput } from '@farmplus/validation';
import type { Actor } from '../../context';
import { HttpError, conflict, forbidden } from '../../lib/errors';
import {
  Animal,
  AnimalType,
  Farm,
  FarmMember,
  GrowthStandard,
  Listing,
  Order,
  User,
  WeightRecord,
  type FarmDoc,
} from '../../models';
import { recordAudit } from '../../services/audit.service';
import { evaluateMeasurement } from '../growth-standards/evaluate';
import { getBooleanSetting, getNumberSetting } from '../settings/settings.service';
import { assertFarmActive, requireFarmPermission, type FarmAccess } from './farm-access';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function toFarmSummary(farm: FarmDoc, myRole: FarmRole | null): FarmSummary {
  return {
    id: String(farm._id),
    name: farm.name,
    ...(farm.description ? { description: farm.description } : {}),
    status: farm.status,
    location: farm.location ?? {},
    contact: farm.contact ?? {},
    animalTypeIds: (farm.animalTypeIds ?? []).map(String),
    myRole,
    createdAt: farm.createdAt.toISOString(),
  };
}

/** Creating farms is for approved farm owners (setting `farms.requireFarmOwnerRole`), or platform staff with farms.manage. */
export async function mayCreateFarm(actor: Actor): Promise<boolean> {
  if (actor.access.permissions.has('farms.manage')) return true;
  if (!(await getBooleanSetting('farms.requireFarmOwnerRole'))) return true;
  return actor.access.roleKeys.includes('farm_owner');
}

async function assertMayCreateFarm(actor: Actor): Promise<void> {
  if (!(await mayCreateFarm(actor))) {
    throw forbidden(
      'Only approved farm owners can create farms. Submit a farm-owner registration first.',
      'FARM_OWNER_REQUIRED',
    );
  }
}

/** The declared animal types must exist and be active (unchanged ids of now-inactive types may be kept on update). */
async function resolveAnimalTypeIds(ids: string[], keep: Types.ObjectId[] = []): Promise<string[]> {
  const kept = new Set(keep.map(String));
  const active = new Set(
    (await AnimalType.find({ _id: { $in: ids }, status: 'active' }).select('_id')).map((t) =>
      String(t._id),
    ),
  );
  const bad = ids.findIndex((id) => !active.has(id) && !kept.has(id));
  if (bad >= 0)
    throw new HttpError(400, 'VALIDATION_ERROR', 'Request validation failed', [
      { path: `animalTypeIds.${bad}`, message: 'Unknown or inactive animal type' },
    ]);
  return ids;
}

export async function createFarm(actor: Actor, input: CreateFarmInput): Promise<FarmSummary> {
  await assertMayCreateFarm(actor);
  const animalTypeIds = await resolveAnimalTypeIds(input.animalTypeIds);
  const farm = await Farm.create({
    name: input.name,
    description: input.description ?? null,
    location: input.location,
    contact: input.contact,
    animalTypeIds,
    createdBy: actor.userId,
  });
  // The creator becomes the (single) owner.
  await FarmMember.create({ farmId: farm._id, userId: actor.userId, role: 'owner', addedBy: null });
  await recordAudit({
    actorId: actor.userId,
    action: 'farm.created',
    targetType: 'farm',
    targetId: farm._id,
    metadata: { name: farm.name },
    ip: actor.ip,
  });
  return toFarmSummary(farm, 'owner');
}

export async function listFarms(
  actor: Actor,
  query: {
    page: number;
    pageSize: number;
    q?: string | undefined;
    status?: 'active' | 'archived' | undefined;
    scope: 'mine' | 'all';
    relation?: 'owned' | 'managed' | undefined;
  },
): Promise<Page<FarmSummary>> {
  const filter: Record<string, unknown> = {};
  if (query.status) filter['status'] = query.status;
  if (query.q) filter['name'] = { $regex: escapeRegex(query.q), $options: 'i' };

  const memberships = await FarmMember.find({ userId: actor.userId });
  const roleByFarm = new Map(memberships.map((m) => [String(m.farmId), m.role]));

  if (query.scope === 'all') {
    if (
      !actor.access.permissions.has('farms.read') &&
      !actor.access.permissions.has('farms.manage')
    ) {
      throw forbidden('Listing every farm requires platform permission', 'FORBIDDEN');
    }
  } else {
    const wanted = memberships.filter((m) =>
      query.relation === 'owned'
        ? m.role === 'owner'
        : query.relation === 'managed'
          ? m.role !== 'owner'
          : true,
    );
    filter['_id'] = { $in: wanted.map((m) => m.farmId) };
  }
  const [farms, total] = await Promise.all([
    Farm.find(filter)
      .sort({ name: 1, _id: 1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize),
    Farm.countDocuments(filter),
  ]);
  return {
    items: farms.map((f) => toFarmSummary(f, roleByFarm.get(String(f._id)) ?? null)),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function getFarmDetail(access: FarmAccess): Promise<FarmDetail> {
  const [rows, ownerMember] = await Promise.all([
    Animal.aggregate<{ _id: string; count: number }>([
      { $match: { farmId: access.farm._id, archivedAt: null } },
      { $group: { _id: '$currentStatus', count: { $sum: 1 } } },
    ]),
    FarmMember.findOne({ farmId: access.farm._id, role: 'owner' }).select('userId'),
  ]);
  const owner = ownerMember ? await User.findById(ownerMember.userId).select('displayName') : null;
  const byStatus = Object.fromEntries(rows.map((r) => [r._id, r.count]));
  const animalsTotal = rows.reduce((n, r) => n + r.count, 0);
  return {
    ...toFarmSummary(access.farm, access.role),
    ...(owner ? { owner: { id: String(owner._id), displayName: owner.displayName } } : {}),
    access: { via: access.via, permissions: [...access.permissions].sort() },
    stats: { animalsTotal, animalsActive: byStatus['active'] ?? 0, byStatus },
  };
}

export async function updateFarm(
  actor: Actor,
  access: FarmAccess,
  input: UpdateFarmInput,
): Promise<FarmSummary> {
  requireFarmPermission(access, 'farm.update');
  assertFarmActive(access);
  const farm = access.farm;
  if (input.name !== undefined) farm.name = input.name;
  if (input.description !== undefined) farm.description = input.description;
  if (input.location !== undefined) farm.location = input.location;
  if (input.contact !== undefined) farm.contact = input.contact;
  if (input.animalTypeIds !== undefined) {
    const ids = await resolveAnimalTypeIds(input.animalTypeIds, farm.animalTypeIds);
    farm.set('animalTypeIds', ids);
  }
  await farm.save();
  await recordAudit({
    actorId: actor.userId,
    action: 'farm.updated',
    targetType: 'farm',
    targetId: farm._id,
    metadata: { fields: Object.keys(input) },
    ip: actor.ip,
  });
  return toFarmSummary(farm, access.role);
}

export async function setFarmArchived(
  actor: Actor,
  access: FarmAccess,
  archived: boolean,
): Promise<FarmSummary> {
  requireFarmPermission(access, 'farm.archive');
  const farm = access.farm;
  if (Boolean(farm.archivedAt) === archived)
    throw conflict(archived ? 'Farm is already archived' : 'Farm is not archived', 'NO_CHANGE');
  farm.status = archived ? 'archived' : 'active';
  farm.archivedAt = archived ? new Date() : null;
  await farm.save();
  await recordAudit({
    actorId: actor.userId,
    action: archived ? 'farm.archived' : 'farm.restored',
    targetType: 'farm',
    targetId: farm._id,
    ip: actor.ip,
  });
  return toFarmSummary(farm, access.role);
}

/** `GET /farms/me`: whether the caller still has to set up a farm (derived from memberships, never stored). */
export async function farmSetupStatus(actor: Actor): Promise<FarmSetupDTO> {
  const [farms, canCreateFarm] = await Promise.all([
    listFarms(actor, { page: 1, pageSize: 20, scope: 'mine' }),
    mayCreateFarm(actor),
  ]);
  return {
    status:
      farms.total > 0
        ? 'farm_setup_completed'
        : canCreateFarm
          ? 'farm_setup_required'
          : 'not_applicable',
    canCreateFarm,
    farms: farms.items,
  };
}

const DAY_MS = 86_400_000;

/** An on-farm animal as the summary's first aggregate returns it: enough to evaluate its growth. */
interface OnFarmAnimal {
  _id: Types.ObjectId;
  breed?: string | null;
  sex: string;
  birthDate?: Date | null;
  birthDateEstimated?: boolean;
}

/** Per animal type: how many of these animals' LATEST measurement is below or above its growth criterion. */
async function outsideStandardByType(
  farmId: Types.ObjectId,
  animalsByType: Map<string, OnFarmAnimal[]>,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const animalIds = [...animalsByType.values()].flat().map((a) => a._id);
  if (animalIds.length === 0) return counts;
  // The animals' facts came with the counts, so the latest measurements and the criteria are read together.
  const [latest, standards] = await Promise.all([
    WeightRecord.aggregate<{
      _id: Types.ObjectId;
      date: Date;
      weightKg: number;
      heightCm: number | null;
      lengthCm: number | null;
    }>([
      { $match: { farmId, voided: false, animalId: { $in: animalIds } } },
      { $sort: { weighedOn: -1, createdAt: -1 } },
      {
        $group: {
          _id: '$animalId',
          date: { $first: '$weighedOn' },
          weightKg: { $first: '$weightKg' },
          heightCm: { $first: '$heightCm' },
          lengthCm: { $first: '$lengthCm' },
        },
      },
    ]),
    GrowthStandard.find({
      animalTypeId: { $in: [...animalsByType.keys()] },
      kind: 'weight_for_age',
      active: true,
    }),
  ]);
  const byAnimal = new Map<string, { typeId: string; animal: OnFarmAnimal }>();
  for (const [typeId, animals] of animalsByType)
    for (const animal of animals) byAnimal.set(String(animal._id), { typeId, animal });
  for (const m of latest) {
    const hit = byAnimal.get(String(m._id));
    if (!hit) continue;
    const ofType = standards.filter((s) => String(s.animalTypeId) === hit.typeId);
    const { evaluation } = evaluateMeasurement(ofType, hit.animal, m);
    if (evaluation.status === 'below' || evaluation.status === 'above')
      counts.set(hit.typeId, (counts.get(hit.typeId) ?? 0) + 1);
  }
  return counts;
}

/** `GET /farms/:farmId/summary`: live per-type animal counts for the "My farm" home (archived animals excluded). */
export async function farmAnimalSummary(access: FarmAccess): Promise<FarmAnimalSummaryDTO> {
  requireFarmPermission(access, 'animals.read');
  const farmId = access.farm._id;
  const withRecords = access.permissions.has('records.read');
  // Two rounds of independent reads instead of a chain: (1) the setting, the counts and the trade figures,
  // (2) everything that needs the setting or the animals found in (1). Every figure is still read live.
  const [growthCheckDays, rows, trade] = await Promise.all([
    getNumberSetting('farms.growthCheckDays', 1, 365),
    Animal.aggregate<{ _id: { t: Types.ObjectId; s: string }; n: number; on: OnFarmAnimal[] }>([
      { $match: { farmId, archivedAt: null } },
      {
        $group: {
          _id: { t: '$animalTypeId', s: '$currentStatus' },
          n: { $sum: 1 },
          on: {
            $push: {
              $cond: [
                { $in: ['$currentStatus', ['active', 'for_sale']] },
                {
                  _id: '$_id',
                  breed: '$breed',
                  sex: '$sex',
                  birthDate: '$birthDate',
                  birthDateEstimated: '$birthDateEstimated',
                },
                '$$REMOVE',
              ],
            },
          },
        },
      },
    ]),
    access.permissions.has('listings.manage')
      ? Promise.all([
          Listing.aggregate<{ _id: string; n: number }>([
            { $match: { farmId } },
            { $group: { _id: '$status', n: { $sum: 1 } } },
          ]),
          Order.countDocuments({ farmId, kind: 'animal' }),
        ])
      : Promise.resolve(undefined),
  ]);
  const animalsByType = new Map<string, OnFarmAnimal[]>();
  for (const r of rows) {
    if (r.on.length === 0) continue;
    const t = String(r._id.t);
    animalsByType.set(t, [...(animalsByType.get(t) ?? []), ...r.on]);
  }
  // Types the farm declared show up even before the first animal is registered.
  const typeIds = new Set([
    ...rows.map((r) => String(r._id.t)),
    ...access.farm.animalTypeIds.map(String),
  ]);
  const [recentlyWeighed, types, outside] = await Promise.all([
    withRecords
      ? WeightRecord.distinct('animalId', {
          farmId,
          voided: false,
          // Weighed after the day N days ago, counted on the Thai calendar (weighedOn is date-only).
          weighedOn: { $gt: new Date(thaiDayStart().getTime() - growthCheckDays * DAY_MS) },
        })
      : Promise.resolve([]),
    AnimalType.find({ _id: { $in: [...typeIds] } }).select('key name nameTh'),
    withRecords
      ? outsideStandardByType(farmId, animalsByType)
      : Promise.resolve(new Map<string, number>()),
  ]);
  const weighed = new Set(recentlyWeighed.map(String));
  const byType = new Map<string, FarmAnimalTypeCount>(
    types.map((t) => [
      String(t._id),
      {
        animalTypeId: String(t._id),
        key: t.key,
        name: t.name,
        ...(t.nameTh ? { nameTh: t.nameTh } : {}),
        total: 0,
        onFarm: 0,
        forSale: 0,
        sold: 0,
        needsGrowthCheck: withRecords ? 0 : null,
        outsideStandard: withRecords ? 0 : null,
      },
    ]),
  );
  for (const r of rows) {
    const card = byType.get(String(r._id.t));
    if (!card) continue;
    card.total += r.n;
    if (r._id.s === 'for_sale') card.forSale += r.n;
    if (r._id.s === 'sold') card.sold += r.n;
    card.onFarm += r.on.length;
    if (card.needsGrowthCheck !== null)
      card.needsGrowthCheck += r.on.filter((a) => !weighed.has(String(a._id))).length;
  }
  for (const [typeId, n] of outside) {
    const card = byType.get(typeId);
    if (card) card.outsideStandard = n;
  }
  const cards = [...byType.values()].sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name),
  );
  const sum = (k: 'total' | 'onFarm' | 'forSale' | 'sold') => cards.reduce((n, c) => n + c[k], 0);
  const summary: FarmAnimalSummaryDTO = {
    totals: {
      total: sum('total'),
      onFarm: sum('onFarm'),
      forSale: sum('forSale'),
      sold: sum('sold'),
      needsGrowthCheck: withRecords
        ? cards.reduce((n, c) => n + (c.needsGrowthCheck ?? 0), 0)
        : null,
      outsideStandard: withRecords ? cards.reduce((n, c) => n + (c.outsideStandard ?? 0), 0) : null,
    },
    byType: cards,
    growthCheckDays,
  };
  if (trade) {
    const [listingRows, animalOrders] = trade;
    summary.trade = {
      listingsByStatus: Object.fromEntries(listingRows.map((r) => [r._id, r.n])),
      listingsTotal: listingRows.reduce((n, r) => n + r.n, 0),
      animalOrders,
    };
  }
  return summary;
}
