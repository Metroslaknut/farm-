import { Buffer } from 'node:buffer';
import { Types } from 'mongoose';
import { z } from 'zod';
import type { ModerationEntry, PublicAuthor } from '@farmplus/shared-types';
import { HttpError } from '../../lib/errors';
import { Follow, Reaction, User } from '../../models';
import type { ModerationEntryAttrs } from '../../models/post.model';

export const invalid = (path: string, message: string) =>
  new HttpError(400, 'VALIDATION_ERROR', 'Request validation failed', [{ path, message }]);

// ---------------------------------------------------------------------------
// Cursors: opaque to clients, validated on the way back in (a forged cursor is a 400, never a crash).
// ---------------------------------------------------------------------------
const cursorSchema = z.object({
  /** createdAt (ms) for chronological lists, or engagement for the trending list. */
  k: z.number().finite(),
  id: z.string().regex(/^[0-9a-f]{24}$/),
});
export interface Cursor {
  k: number;
  id: Types.ObjectId;
}
export const encodeCursor = (k: number, id: Types.ObjectId): string =>
  Buffer.from(JSON.stringify({ k, id: String(id) })).toString('base64url');

export function decodeCursor(raw: string | undefined): Cursor | undefined {
  if (!raw) return undefined;
  try {
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
    return { k: parsed.k, id: new Types.ObjectId(parsed.id) };
  } catch {
    throw invalid('cursor', 'Invalid cursor');
  }
}

// ---------------------------------------------------------------------------
// Hydration helpers
// ---------------------------------------------------------------------------
export async function authorsById(ids: Types.ObjectId[]): Promise<Map<string, PublicAuthor>> {
  const unique = [...new Set(ids.map(String))];
  const users = await User.find({ _id: { $in: unique } }).select('displayName avatarUrl');
  return new Map(
    users.map((u) => [
      String(u._id),
      { id: String(u._id), displayName: u.displayName, avatarUrl: u.avatarUrl ?? null },
    ]),
  );
}
export const authorOf = (map: Map<string, PublicAuthor>, id: Types.ObjectId): PublicAuthor =>
  map.get(String(id)) ?? { id: String(id), displayName: 'Former member', avatarUrl: null };

export async function reactedSet(
  userId: string,
  targetType: 'post' | 'comment' | 'video',
  ids: Types.ObjectId[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await Reaction.find({ userId, targetType, targetId: { $in: ids } }).select(
    'targetId',
  );
  return new Set(rows.map((r) => String(r.targetId)));
}

export async function followedSet(userId: string, ids: Types.ObjectId[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await Follow.find({ followerId: userId, followeeId: { $in: ids } }).select(
    'followeeId',
  );
  return new Set(rows.map((r) => String(r.followeeId)));
}

export const toModerationEntry = (m: ModerationEntryAttrs): ModerationEntry => ({
  at: m.at.toISOString(),
  by: String(m.by),
  action: m.action,
  reason: m.reason ?? null,
});

export const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;

export const MODERATION_NOTICE: Record<string, string> = {
  hidden: 'A moderator hid this. Only you can see it, and it can no longer be edited.',
  removed: 'A moderator removed this for breaking the community rules.',
};
