import type { Types } from 'mongoose';
import type { Page, PublicUser, UserStatus } from '@farmplus/shared-types';
import type { UpdateProfileInput } from '@farmplus/validation';
import type { Actor } from '../context';
import { conflict, forbidden, notFound } from '../lib/errors';
import { Role, User, UserRole, type UserDoc } from '../models';
import { isSubset, resolveAccess } from '../rbac/access';
import { PROTECTED_ROLE_KEYS } from '../rbac/definitions';
import { recordAudit } from './audit.service';
import { revokeAllSessions } from './session.service';

export async function roleKeysByUser(userIds: Types.ObjectId[]): Promise<Map<string, string[]>> {
  const links = await UserRole.find({ userId: { $in: userIds } });
  const roles = await Role.find({ _id: { $in: links.map((l) => l.roleId) } });
  const keyById = new Map(roles.map((r) => [String(r._id), r.key]));
  const result = new Map<string, string[]>();
  for (const link of links) {
    const key = keyById.get(String(link.roleId));
    if (!key) continue;
    const list = result.get(String(link.userId)) ?? [];
    list.push(key);
    result.set(String(link.userId), list);
  }
  return result;
}

/** The only place a User document becomes API output: never includes hashes or secrets. */
export function toPublicUser(user: UserDoc, roles: string[]): PublicUser {
  return {
    id: String(user._id),
    ...(user.email ? { email: user.email } : {}),
    ...(user.phone ? { phone: user.phone } : {}),
    displayName: user.displayName,
    ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    ...(user.locale ? { locale: user.locale } : {}),
    status: user.status,
    emailVerified: Boolean(user.emailVerifiedAt),
    phoneVerified: Boolean(user.phoneVerifiedAt),
    mfaEnabled: user.mfa.enabled,
    roles: [...roles].sort(),
    createdAt: user.createdAt.toISOString(),
  };
}

export async function loadPublicUser(user: UserDoc): Promise<PublicUser> {
  const roles = (await roleKeysByUser([user._id])).get(String(user._id)) ?? [];
  return toPublicUser(user, roles);
}

export async function getPublicUser(id: Types.ObjectId): Promise<PublicUser> {
  const user = await User.findById(id);
  if (!user) throw notFound('User not found');
  return loadPublicUser(user);
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function listUsers(query: {
  page: number;
  pageSize: number;
  q?: string | undefined;
}): Promise<Page<PublicUser>> {
  const filter = query.q
    ? {
        $or: [
          { displayName: { $regex: escapeRegex(query.q), $options: 'i' } },
          { email: { $regex: `^${escapeRegex(query.q.toLowerCase())}` } },
        ],
      }
    : {};
  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize),
    User.countDocuments(filter),
  ]);
  const roles = await roleKeysByUser(users.map((u) => u._id));
  return {
    items: users.map((u) => toPublicUser(u, roles.get(String(u._id)) ?? [])),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function updateProfile(
  actor: Actor,
  targetId: Types.ObjectId,
  input: UpdateProfileInput,
): Promise<PublicUser> {
  const user = await User.findById(targetId);
  if (!user) throw notFound('User not found');
  if (input.displayName !== undefined) user.displayName = input.displayName;
  if (input.avatarUrl !== undefined) user.avatarUrl = input.avatarUrl;
  if (input.locale !== undefined) user.locale = input.locale;
  await user.save();
  if (String(targetId) !== actor.userId) {
    await recordAudit({
      actorId: actor.userId,
      action: 'user.profile_updated_by_admin',
      targetType: 'user',
      targetId,
      metadata: { fields: Object.keys(input) },
      ip: actor.ip,
    });
  }
  return loadPublicUser(user);
}

/** Admin action. Callers must already hold `users.suspend`. */
export async function setUserStatus(
  actor: Actor,
  targetId: Types.ObjectId,
  status: Exclude<UserStatus, 'pending_verification'>,
  reason: string,
): Promise<PublicUser> {
  if (String(targetId) === actor.userId)
    throw forbidden('You cannot change your own account status');
  const user = await User.findById(targetId);
  if (!user) throw notFound('User not found');

  // Never act on someone holding powers you lack (evaluated as if their MFA were verified).
  const targetAccess = await resolveAccess(user._id, true);
  const holdsProtectedRole = targetAccess.roleKeys.some((k) => PROTECTED_ROLE_KEYS.includes(k));
  if (!isSubset(targetAccess.permissions, actor.access.permissions)) {
    throw forbidden('You cannot manage an account with greater privileges than yours');
  }
  if (holdsProtectedRole && !actor.access.roleKeys.includes('super_admin')) {
    throw forbidden('Only a super admin can manage this account');
  }
  if (user.status === status) throw conflict(`Account is already ${status}`, 'NO_CHANGE');

  const previous = user.status;
  user.status = status;
  if (status === 'active') {
    user.failedLoginCount = 0;
    user.lockedUntil = null;
  }
  await user.save();
  if (status !== 'active') await revokeAllSessions(user._id, `status_${status}`);
  await recordAudit({
    actorId: actor.userId,
    action: 'user.status_changed',
    targetType: 'user',
    targetId: user._id,
    metadata: { from: previous, to: status, reason },
    ip: actor.ip,
  });
  return loadPublicUser(user);
}
