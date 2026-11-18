import type { Types } from 'mongoose';
import type { SessionInfo } from '@farmplus/shared-types';
import { RefreshToken, Session } from '../models';

export async function revokeSession(
  sessionId: Types.ObjectId | string,
  reason: string,
): Promise<void> {
  await Session.updateOne(
    { _id: sessionId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
  await RefreshToken.deleteMany({ sessionId });
}

export async function revokeAllSessions(
  userId: Types.ObjectId | string,
  reason: string,
  exceptSessionId?: Types.ObjectId | string,
): Promise<void> {
  const filter = {
    userId,
    revokedAt: null,
    ...(exceptSessionId ? { _id: { $ne: exceptSessionId } } : {}),
  };
  const sessions = await Session.find(filter).select('_id');
  if (sessions.length === 0) return;
  const ids = sessions.map((s) => s._id);
  await Session.updateMany(
    { _id: { $in: ids } },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
  await RefreshToken.deleteMany({ sessionId: { $in: ids } });
}

export async function listSessions(
  userId: Types.ObjectId,
  currentSessionId: string,
): Promise<SessionInfo[]> {
  const sessions = await Session.find({
    userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({
    lastUsedAt: -1,
  });
  return sessions.map((s) => ({
    id: String(s._id),
    current: String(s._id) === currentSessionId,
    mfaVerified: s.mfaVerified,
    ...(s.userAgent ? { userAgent: s.userAgent } : {}),
    ...(s.ip ? { ip: s.ip } : {}),
    createdAt: s.createdAt.toISOString(),
    lastUsedAt: s.lastUsedAt.toISOString(),
  }));
}
