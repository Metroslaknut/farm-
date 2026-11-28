import type { Types } from 'mongoose';
import type { AdminFarmDetail, AdminFarmOwner, AdminFarmRow, Page } from '@farmplus/shared-types';
import type { AdminFarmListQuery } from '@farmplus/validation';
import type { Actor } from '../../context';
import { Animal, AuditLog, Farm, FarmMember, User } from '../../models';
import { listAuditLogs } from '../../services/audit.service';
import { loadFarmAccess } from '../farms/farm-access';
import { farmAnimalSummary, getFarmDetail } from '../farms/farms.service';
import { listMembers } from '../farms/members.service';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Same cap as a display-name search in the admin users list: the regex has no index. */
const OWNER_MATCH_CAP = 50;

/**
 * Owner filter → farm ids. An exact e-mail uses the unique `users.email` index; anything else is a case-insensitive
 * display-name match capped at 50 users. The users' farms are then found through `farm_members` (role owner).
 */
async function farmIdsOwnedBy(owner: string): Promise<Types.ObjectId[]> {
  const users = await User.find(
    EMAIL.test(owner)
      ? // `$type` matches the unique index's partial filter, so the planner can use it.
        { email: { $eq: owner.toLowerCase(), $type: 'string' } }
      : { displayName: { $regex: escapeRegex(owner), $options: 'i' } },
  )
    .select('_id')
    .limit(OWNER_MATCH_CAP);
  if (users.length === 0) return [];
  const links = await FarmMember.find({
    userId: { $in: users.map((u) => u._id) },
    role: 'owner',
  }).select('farmId');
  return links.map((l) => l.farmId);
}

/** Owners of the given farms, with e-mail only for staff who may read users anyway. */
async function ownersOf(
  farmIds: Types.ObjectId[],
  withEmail: boolean,
): Promise<Map<string, AdminFarmOwner>> {
  const links = await FarmMember.find({ farmId: { $in: farmIds }, role: 'owner' }).select(
    'farmId userId',
  );
  const users = new Map(
    (await User.find({ _id: { $in: links.map((l) => l.userId) } }).select('displayName email')).map(
      (u) => [String(u._id), u],
    ),
  );
  const owners = new Map<string, AdminFarmOwner>();
  for (const link of links) {
    const u = users.get(String(link.userId));
    if (!u) continue;
    owners.set(String(link.farmId), {
      id: String(u._id),
      displayName: u.displayName,
      ...(withEmail && u.email ? { email: u.email } : {}),
    });
  }
  return owners;
}

type FarmCount = { _id: Types.ObjectId; n: number };
const byFarm = (match: Record<string, unknown>) => [
  { $match: match },
  { $group: { _id: '$farmId', n: { $sum: 1 } } },
];
const toCounts = (rows: FarmCount[]): Map<string, number> =>
  new Map(rows.map((r) => [String(r._id), r.n]));

export async function listAdminFarms(
  actor: Actor,
  query: AdminFarmListQuery,
): Promise<Page<AdminFarmRow>> {
  const filter: Record<string, unknown> = {};
  if (query.status) filter['status'] = query.status;
  if (query.province) filter['location.province'] = query.province;
  if (query.q) filter['name'] = { $regex: escapeRegex(query.q), $options: 'i' };
  if (query.from || query.to) {
    filter['createdAt'] = {
      ...(query.from ? { $gte: new Date(query.from) } : {}),
      ...(query.to ? { $lte: new Date(query.to) } : {}),
    };
  }
  if (query.owner) filter['_id'] = { $in: await farmIdsOwnedBy(query.owner) };

  // One sort key only: `{ createdAt: 1 }`, `{ name: 1 }` and `{ 'location.province': 1, createdAt: -1 }` can then
  // serve the sort (an `_id` tie-breaker would force a full collection scan and an in-memory sort).
  const sort = { [query.sortBy]: query.order === 'asc' ? 1 : -1 } as Record<string, 1 | -1>;
  const [farms, total] = await Promise.all([
    Farm.find(filter)
      .sort(sort)
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .select('name status location createdAt archivedAt'),
    Farm.countDocuments(filter),
  ]);
  const ids = farms.map((f) => f._id);
  const [owners, members, animals] = await Promise.all([
    ownersOf(ids, actor.access.permissions.has('users.read')),
    FarmMember.aggregate<FarmCount>(byFarm({ farmId: { $in: ids } })).then(toCounts),
    Animal.aggregate<FarmCount>(byFarm({ farmId: { $in: ids }, archivedAt: null })).then(toCounts),
  ]);
  return {
    items: farms.map((f) => {
      const id = String(f._id);
      return {
        id,
        name: f.name,
        status: f.status,
        ...(f.location?.province ? { province: f.location.province } : {}),
        owner: owners.get(id) ?? null,
        memberCount: members.get(id) ?? 0,
        animalCount: animals.get(id) ?? 0,
        createdAt: f.createdAt.toISOString(),
        ...(f.archivedAt ? { archivedAt: f.archivedAt.toISOString() } : {}),
      };
    }),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

/**
 * Read-only detail for platform staff. Access goes through the same gate as every farm route (`loadFarmAccess`:
 * unknown farm → 404), and the profile, members and per-type counts reuse the farm module's own read functions.
 */
export async function getAdminFarmDetail(
  actor: Actor,
  farmId: Types.ObjectId,
): Promise<AdminFarmDetail> {
  const access = await loadFarmAccess(actor, farmId);
  const [farm, members, summary, owners, lastAnimal, lastAudit] = await Promise.all([
    getFarmDetail(access),
    listMembers(access),
    farmAnimalSummary(access),
    ownersOf([farmId], actor.access.permissions.has('users.read')),
    Animal.findOne({ farmId }).sort({ updatedAt: -1 }).select('updatedAt'),
    AuditLog.findOne({ targetType: 'farm', targetId: String(farmId) })
      .sort({ createdAt: -1 })
      .select('createdAt'),
  ]);
  const times = [access.farm.updatedAt, lastAnimal?.updatedAt, lastAudit?.createdAt]
    .filter((d): d is Date => d instanceof Date)
    .map((d) => d.getTime());
  const detail: AdminFarmDetail = {
    farm,
    owner: owners.get(String(farmId)) ?? null,
    members,
    animalsByType: summary.byType,
    lastActivityAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
  };
  // Audit history is a separate permission: never leak it through the farm endpoint.
  if (actor.access.permissions.has('audit_logs.read')) {
    detail.recentAudit = (
      await listAuditLogs({ page: 1, pageSize: 20, targetType: 'farm', targetId: String(farmId) })
    ).items;
  }
  return detail;
}
