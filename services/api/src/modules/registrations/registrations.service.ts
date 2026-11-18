import type { HydratedDocument, Types } from 'mongoose';
import { notify } from '../notifications/service';
import type {
  IdentityVerificationStatus,
  Page,
  RegistrationStatus,
  RegistrationSummary,
  RegistrationType,
  SellerVerificationStatus,
} from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { conflict, forbidden, notFound } from '../../lib/errors';
import { Registration, User, type RegistrationAttrs } from '../../models';
import { recordAudit } from '../../services/audit.service';
import { grantRoleInternal, revokeRoleInternal } from '../../services/role.service';
import { getBooleanSetting } from '../settings/settings.service';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type RegistrationDoc = HydratedDocument<RegistrationAttrs>;

export async function toRegistrationSummaries(
  rows: RegistrationDoc[],
): Promise<RegistrationSummary[]> {
  const users = new Map(
    (
      await User.find({ _id: { $in: rows.map((r) => r.userId) } }).select('displayName email phone')
    ).map((u) => [String(u._id), u]),
  );
  return rows.map((r) => {
    const u = users.get(String(r.userId));
    return {
      id: String(r._id),
      type: r.type,
      status: r.status,
      applicant: {
        id: String(r.userId),
        displayName: u?.displayName ?? 'Unknown user',
        ...(u?.email ? { email: u.email } : {}),
        ...(u?.phone ? { phone: u.phone } : {}),
      },
      ...(r.businessName ? { businessName: r.businessName } : {}),
      ...(r.note ? { note: r.note } : {}),
      documents: r.documents.map((d) => ({ kind: d.kind, url: d.url })),
      submittedAt: r.submittedAt.toISOString(),
      ...(r.review ? { review: { byId: String(r.review.by), at: r.review.at.toISOString() } } : {}),
      ...(r.decision
        ? {
            decision: {
              outcome: r.decision.outcome,
              byId: String(r.decision.by),
              at: r.decision.at.toISOString(),
              reason: r.decision.reason,
            },
          }
        : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// Applicant side
// ---------------------------------------------------------------------------

export async function submitRegistration(
  actor: Actor,
  input: Pick<RegistrationAttrs, 'type' | 'businessName' | 'note' | 'documents'>,
): Promise<RegistrationSummary> {
  const user = await User.findById(actor.userId);
  if (!user) throw notFound('User not found');
  if (input.type === 'identity' && user.identityVerification === 'verified') {
    throw conflict('Identity is already verified', 'ALREADY_VERIFIED');
  }
  let registration;
  try {
    registration = await Registration.create({
      userId: user._id,
      type: input.type,
      ...(input.businessName ? { businessName: input.businessName } : {}),
      ...(input.note ? { note: input.note } : {}),
      documents: input.documents,
    });
  } catch (error) {
    if ((error as { code?: unknown }).code === 11000) {
      throw conflict('You already have an active registration of this type', 'REGISTRATION_EXISTS');
    }
    throw error;
  }
  // Independent dimensions: submitting moves only the matching one to "pending".
  if (input.type === 'identity') user.identityVerification = 'pending';
  if (input.type === 'seller') user.sellerVerification = 'pending';
  await user.save();
  await recordAudit({
    actorId: actor.userId,
    action: 'registration.submitted',
    targetType: 'registration',
    targetId: registration._id,
    metadata: { type: input.type },
    ip: actor.ip,
  });
  return (await toRegistrationSummaries([registration]))[0]!;
}

export async function listMyRegistrations(userId: Types.ObjectId): Promise<RegistrationSummary[]> {
  return toRegistrationSummaries(await Registration.find({ userId }).sort({ submittedAt: -1 }));
}

// ---------------------------------------------------------------------------
// Reviewer side
// ---------------------------------------------------------------------------

export async function listRegistrations(query: {
  page: number;
  pageSize: number;
  q?: string | undefined;
  status?: RegistrationStatus | undefined;
  type?: RegistrationType | undefined;
  sortBy: 'submittedAt' | 'status';
  order: 'asc' | 'desc';
}): Promise<Page<RegistrationSummary>> {
  const filter: Record<string, unknown> = {};
  if (query.status) filter['status'] = query.status;
  if (query.type) filter['type'] = query.type;
  if (query.q) {
    const rx = escapeRegex(query.q);
    const users = await User.find({
      $or: [
        { displayName: { $regex: rx, $options: 'i' } },
        { email: { $regex: `^${escapeRegex(query.q.toLowerCase())}` } },
      ],
    })
      .select('_id')
      .limit(200);
    filter['$or'] = [
      { userId: { $in: users.map((u) => u._id) } },
      { businessName: { $regex: rx, $options: 'i' } },
    ];
  }
  const sort = { [query.sortBy]: query.order === 'asc' ? 1 : -1 } as Record<string, 1 | -1>;
  const [rows, total] = await Promise.all([
    Registration.find(filter)
      .sort(sort)
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize),
    Registration.countDocuments(filter),
  ]);
  return {
    items: await toRegistrationSummaries(rows),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function getRegistration(id: Types.ObjectId): Promise<RegistrationSummary> {
  const row = await Registration.findById(id);
  if (!row) throw notFound('Registration not found');
  return (await toRegistrationSummaries([row]))[0]!;
}

async function assertNotOwnRegistration(
  actor: Actor,
  id: Types.ObjectId,
): Promise<RegistrationDoc> {
  const row = await Registration.findById(id);
  if (!row) throw notFound('Registration not found');
  if (String(row.userId) === actor.userId) {
    throw forbidden('You cannot review or decide your own registration', 'SELF_DECISION');
  }
  return row;
}

/** PENDING → UNDER_REVIEW. Requires `registrations.review`. */
export async function startReview(actor: Actor, id: Types.ObjectId): Promise<RegistrationSummary> {
  await assertNotOwnRegistration(actor, id);
  const updated = await Registration.findOneAndUpdate(
    { _id: id, status: 'PENDING' },
    { $set: { status: 'UNDER_REVIEW', review: { by: actor.userId, at: new Date() } } },
    { returnDocument: 'after' },
  );
  if (!updated)
    throw conflict('Only PENDING registrations can be put under review', 'INVALID_TRANSITION');
  await recordAudit({
    actorId: actor.userId,
    action: 'registration.review_started',
    targetType: 'registration',
    targetId: id,
    metadata: { type: updated.type, from: 'PENDING', to: 'UNDER_REVIEW' },
    ip: actor.ip,
  });
  return (await toRegistrationSummaries([updated]))[0]!;
}

export type Decision = 'approve' | 'reject' | 'suspend' | 'reinstate';

const TRANSITIONS: Record<
  Decision,
  {
    from: RegistrationStatus[];
    to: RegistrationStatus;
    outcome: 'APPROVED' | 'REJECTED' | 'SUSPENDED';
    audit: string;
  }
> = {
  approve: {
    from: ['PENDING', 'UNDER_REVIEW'],
    to: 'APPROVED',
    outcome: 'APPROVED',
    audit: 'registration.approved',
  },
  reject: {
    from: ['PENDING', 'UNDER_REVIEW'],
    to: 'REJECTED',
    outcome: 'REJECTED',
    audit: 'registration.rejected',
  },
  suspend: {
    from: ['APPROVED'],
    to: 'SUSPENDED',
    outcome: 'SUSPENDED',
    audit: 'registration.suspended',
  },
  reinstate: {
    from: ['SUSPENDED'],
    to: 'APPROVED',
    outcome: 'APPROVED',
    audit: 'registration.reinstated',
  },
};

/**
 * Record a decision. Requires `registrations.approve`; every decision stores actor, timestamp and reason
 * on the registration AND in the audit log. The status change is an atomic compare-and-set, so two
 * reviewers can never both decide the same registration.
 */
export async function decide(
  actor: Actor,
  id: Types.ObjectId,
  decision: Decision,
  reason: string,
): Promise<RegistrationSummary> {
  const row = await assertNotOwnRegistration(actor, id);
  const rule = TRANSITIONS[decision];

  // Pre-conditions that must hold *before* the state changes.
  const grantsSeller = row.type === 'seller' && rule.to === 'APPROVED';
  if (grantsSeller && (await getBooleanSetting('registrations.requireIdentityForSeller'))) {
    const applicant = await User.findById(row.userId).select('identityVerification');
    if (applicant?.identityVerification !== 'verified') {
      throw conflict(
        'The applicant’s identity must be verified before a seller can be approved',
        'IDENTITY_NOT_VERIFIED',
      );
    }
  }

  const now = new Date();
  const updated = await Registration.findOneAndUpdate(
    { _id: id, status: { $in: rule.from } },
    {
      $set: {
        status: rule.to,
        decision: { outcome: rule.outcome, by: actor.userId, at: now, reason },
      },
    },
    { returnDocument: 'after' },
  );
  if (!updated) {
    throw conflict(
      `A ${row.status} registration cannot be ${TRANSITIONS[decision].outcome.toLowerCase()}`,
      'INVALID_TRANSITION',
    );
  }

  try {
    await applyEffects(actor, updated.userId, updated.type, rule.to);
  } catch (error) {
    // Do not leave a decision recorded whose side-effects failed.
    await Registration.updateOne(
      { _id: id },
      { $set: { status: row.status, decision: row.decision ?? null } },
    );
    throw error;
  }

  await recordAudit({
    actorId: actor.userId,
    action: rule.audit,
    targetType: 'registration',
    targetId: id,
    metadata: {
      type: updated.type,
      applicantId: String(updated.userId),
      from: row.status,
      to: rule.to,
      reason,
    },
    ip: actor.ip,
  });
  await notify({
    to: [updated.userId],
    type: 'moderation.registration_decided',
    params: { type: updated.type, outcome: rule.outcome, reason },
    eventKey: `registration:${id}:${rule.to}`,
  });
  return (await toRegistrationSummaries([updated]))[0]!;
}

/** Maps a registration outcome onto the (separate) user-level dimensions and roles. */
async function applyEffects(
  actor: Actor,
  userId: Types.ObjectId,
  type: RegistrationType,
  to: RegistrationStatus,
): Promise<void> {
  const set: {
    identityVerification?: IdentityVerificationStatus;
    sellerVerification?: SellerVerificationStatus;
  } = {};
  if (type === 'identity') {
    set.identityVerification =
      to === 'APPROVED' ? 'verified' : to === 'REJECTED' ? 'rejected' : 'unverified';
  } else if (type === 'seller') {
    set.sellerVerification =
      to === 'APPROVED' ? 'verified' : to === 'REJECTED' ? 'rejected' : 'suspended';
  }
  if (Object.keys(set).length > 0) await User.updateOne({ _id: userId }, { $set: set });

  const role = type === 'seller' ? 'seller' : type === 'farm_owner' ? 'farm_owner' : null;
  if (role && to === 'APPROVED') await grantRoleInternal(userId, role, actor.userId);
  if (role && to === 'SUSPENDED') await revokeRoleInternal(userId, role);
}
