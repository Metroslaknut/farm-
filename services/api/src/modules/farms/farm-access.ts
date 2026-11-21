import type { Types } from 'mongoose';
import {
  effectiveFarmPermissions,
  PLATFORM_FARM_PERMISSIONS,
  type FarmPermission,
  type FarmRole,
} from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { conflict, forbidden, notFound } from '../../lib/errors';
import { Farm, FarmMember, type FarmDoc } from '../../models';

export interface FarmAccess {
  farm: FarmDoc;
  /** The caller's membership role (null for platform staff who are not members). */
  role: FarmRole | null;
  via: 'member' | 'platform';
  permissions: Set<FarmPermission>;
}

const ROLE_RANK: Record<FarmRole, number> = { owner: 4, manager: 3, worker: 2, viewer: 1 };
export const roleRank = (role: FarmRole): number => ROLE_RANK[role];

/** Authority used for "who may I grant/change/remove": members by role, platform managers count as owners. */
export function actingRank(access: FarmAccess): number {
  if (access.role) return ROLE_RANK[access.role];
  return access.permissions.has('members.manage') ? ROLE_RANK.owner : 0;
}

function platformPermissions(actor: Actor): FarmPermission[] {
  const granted = new Set<FarmPermission>();
  for (const [key, perms] of Object.entries(PLATFORM_FARM_PERMISSIONS)) {
    // `actor.access.permissions` already excludes MFA-withheld permissions.
    if (actor.access.permissions.has(key)) perms.forEach((p) => granted.add(p));
  }
  return [...granted];
}

/**
 * The single gate for every farm-scoped request. A farm the caller has no relationship with is reported as
 * 404 (not 403) so farm ids cannot be probed. Platform staff reach farms through the Part 03/04 permissions
 * `farms.read` / `farms.manage` (subject to MFA).
 */
export async function loadFarmAccess(actor: Actor, farmId: Types.ObjectId): Promise<FarmAccess> {
  const [farm, membership] = await Promise.all([
    Farm.findById(farmId),
    FarmMember.findOne({ farmId, userId: actor.userId }),
  ]);
  if (!farm) throw notFound('Farm not found');

  // Role permissions, narrowed by the owner's per-member choice (resolved per request: changes apply at once).
  const permissions = new Set<FarmPermission>(
    membership ? effectiveFarmPermissions(membership.role, membership.permissions) : [],
  );
  for (const p of platformPermissions(actor)) permissions.add(p);

  if (permissions.size === 0) {
    const staffWithheld = ['farms.read', 'farms.manage'].some((k) => actor.access.withheld.has(k));
    if (staffWithheld)
      throw forbidden('Multi-factor authentication is required for this action', 'MFA_REQUIRED');
    throw notFound('Farm not found');
  }
  return {
    farm,
    role: membership?.role ?? null,
    via: membership ? 'member' : 'platform',
    permissions,
  };
}

export function requireFarmPermission(access: FarmAccess, permission: FarmPermission): void {
  if (!access.permissions.has(permission)) {
    throw forbidden('You do not have permission to do this on this farm', 'FARM_FORBIDDEN');
  }
}

/** Archived farms are read-only. */
export function assertFarmActive(access: FarmAccess): void {
  if (access.farm.status === 'archived') throw conflict('This farm is archived', 'FARM_ARCHIVED');
}
