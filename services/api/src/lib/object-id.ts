import { Types, isValidObjectId } from 'mongoose';
import { notFound } from './errors';

/** Parse a path parameter; malformed ids are simply "not found". */
export function parseObjectId(value: unknown): Types.ObjectId {
  if (typeof value !== 'string' || !isValidObjectId(value) || value.length !== 24) throw notFound();
  return new Types.ObjectId(value);
}
