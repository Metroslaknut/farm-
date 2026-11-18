import type { Types } from 'mongoose';
import type { CursorPage } from '@farmplus/shared-types';
import { HttpError } from '../../lib/errors';
import { decodeCursor, encodeCursor } from '../community/shared';

export const err = (status: number, code: string, message: string) =>
  new HttpError(status, code, message);

/** createdAt-descending keyset filter. */
export function beforeCursor(cursor: string | undefined): Record<string, unknown> {
  const c = decodeCursor(cursor);
  if (!c) return {};
  return {
    $or: [{ createdAt: { $lt: new Date(c.k) } }, { createdAt: new Date(c.k), _id: { $lt: c.id } }],
  };
}

/** Rows fetched with `limit + 1`: the extra row only tells us whether another page exists. */
export function pageOf<D extends { _id: Types.ObjectId }, T>(
  rows: D[],
  limit: number,
  key: (d: D) => number,
  dto: (d: D) => T,
): CursorPage<T> {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items: items.map(dto),
    ...(rows.length > limit && last ? { nextCursor: encodeCursor(key(last), last._id) } : {}),
  };
}

export const createdKey = (d: { createdAt: Date }) => d.createdAt.getTime();
