import type { Types } from 'mongoose';
import type { AdminUser, AdminUserDetail, Page } from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { notFound } from '../../lib/errors';
import { Registration, Role, Session, User, UserRole, type UserDoc } from '../../models';
import { listAuditLogs } from '../../services/audit.service';
import { roleKeysByUser, toPublicUser } from '../../services/user.service';
import { toRegistrationSummaries } from '../registrations/registrations.service';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function toAdminUser(user: UserDoc, roles: string[]): AdminUser {
  return {
    ...toPublicUser(user, roles),
    identityVerification: user.identityVerification,
    sellerVerification: user.sellerVerification,
    subscriptionStatus: user.subscriptionStatus,
    ...(user.lastLoginAt ? { lastLoginAt: user.lastLoginAt.toISOString() } : {}),
  };
}

export interface AdminUserQuery {
  page: number;
  pageSize: number;
  q?: string | undefined;
  status?: AdminUser['status'] | undefined;
  role?: string | undefined;
  identity?: AdminUser['identityVerification'] | undefined;
  seller?: AdminUser['sellerVerification'] | undefined;
  sortBy: 'createdAt' | 'displayName' | 'lastLoginAt';
  order: 'asc' | 'desc';
}

export async function listAdminUsers(query: AdminUserQuery): Promise<Page<AdminUser>> {
  const filter: Record<string, unknown> = {};
  if (query.status) filter['status'] = query.status;
  if (query.identity) filter['identityVerification'] = query.identity;
  if (query.seller) filter['sellerVerification'] = query.seller;
  if (query.q) {
    filter['$or'] = [
      { displayName: { $regex: escapeRegex(query.q), $options: 'i' } },
      { email: { $regex: `^${escapeRegex(query.q.toLowerCase())}` } },
      { phone: { $regex: `^${escapeRegex(query.q)}` } },
    ];
  }
  if (query.role) {
    const role = await Role.findOne({ key: query.role });
    const links = role ? await UserRole.find({ roleId: role._id }).select('userId') : [];
    filter['_id'] = { $in: links.map((l) => l.userId) };
  }
  const sort = { [query.sortBy]: query.order === 'asc' ? 1 : -1, _id: 1 } as Record<string, 1 | -1>;
  const [users, total] = await Promise.all([
    User.find(filter)
      .sort(sort)
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize),
    User.countDocuments(filter),
  ]);
  const roles = await roleKeysByUser(users.map((u) => u._id));
  return {
    items: users.map((u) => toAdminUser(u, roles.get(String(u._id)) ?? [])),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function getAdminUserDetail(
  actor: Actor,
  id: Types.ObjectId,
): Promise<AdminUserDetail> {
  const user = await User.findById(id);
  if (!user) throw notFound('User not found');
  const roles = (await roleKeysByUser([user._id])).get(String(user._id)) ?? [];
  const [activeSessions, registrations] = await Promise.all([
    Session.countDocuments({ userId: id, revokedAt: null, expiresAt: { $gt: new Date() } }),
    Registration.find({ userId: id }).sort({ submittedAt: -1 }),
  ]);
  const detail: AdminUserDetail = {
    user: toAdminUser(user, roles),
    activeSessions,
    registrations: await toRegistrationSummaries(registrations),
  };
  // Audit history is a separate permission: never leak it through the user endpoint.
  if (actor.access.permissions.has('audit_logs.read')) {
    detail.recentAudit = (
      await listAuditLogs({ page: 1, pageSize: 20, targetType: 'user', targetId: String(id) })
    ).items;
  }
  return detail;
}
