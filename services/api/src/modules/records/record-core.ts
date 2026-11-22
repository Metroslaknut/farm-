/* eslint-disable @typescript-eslint/no-explicit-any -- generic record engine: shape is driven by the per-kind config/schema */
import type { Model, Types } from 'mongoose';
import type { z } from 'zod';
import type {
  ActorRef,
  AnimalLite,
  FarmPermission,
  RecordAttachment,
  RecordHistoryEntry,
  RecordKind,
  RecordMeta,
} from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { HttpError, conflict, notFound } from '../../lib/errors';
import { Animal, User } from '../../models';
import type { RecordBaseAttrs } from '../../models';
import { recordAudit } from '../../services/audit.service';
import {
  assertMediaUrlAllowed,
  deleteDevicePhoto,
  storeDevicePhoto,
  type MediaPolicy,
} from '../animals/animals.service';
import type { PhotoStorage } from '../animals/photo-storage';
import { assertFarmActive, requireFarmPermission, type FarmAccess } from '../farms/farm-access';

/**
 * The shared machinery behind breeding, health, feeding, weight and expense records.
 *
 * Guarantees, for every kind:
 *  - nothing is ever deleted: a mistaken record is VOIDED (flag + who/when/why), never removed;
 *  - a change is a CORRECTION that needs a reason; the previous value of every changed field is kept in `history`;
 *  - every record knows who created it, who last changed it, and its revision number;
 *  - after a correction the WHOLE record is re-validated with the same schema as creation, so a correction can
 *    never produce something creation would have refused.
 */
export type RecordDoc = RecordBaseAttrs & Record<string, any> & { save(): Promise<unknown> };

export interface RecordContext {
  actor: Actor;
  access: FarmAccess;
  policy: MediaPolicy;
  /** Object storage for device-uploaded photos (null/absent = stored in MongoDB). */
  photos?: PhotoStorage | null;
}

export interface RecordSpec<D extends RecordDoc = RecordDoc, DTO = unknown> {
  kind: RecordKind;
  model: Model<any>;
  permissions: { read: FarmPermission; write: FarmPermission; correct: FarmPermission };
  /** The creation schema; corrections are validated against it after merging. */
  createSchema: z.ZodType<any>;
  /** Input fields that may be corrected. Identity (animal, dam, kind) is deliberately absent: void and re-create instead. */
  editable: readonly string[];
  /** Stored document → creation-shaped input (dates as YYYY-MM-DD), without attachments. */
  toInput(doc: D): Record<string, unknown>;
  /** Apply validated input onto a document. */
  assign(doc: D, input: any, extra?: any): void;
  /**
   * Cross-record rules (parents, ranges, duplicates…). `existing` is set for corrections. Whatever it returns is
   * handed to `assign` (e.g. computed informational warnings).
   */
  validate?(ctx: RecordContext, input: any, existing?: D): Promise<unknown>;
  serialize(docs: D[], ctx: { access: FarmAccess }): Promise<DTO[]>;
  /** Side effects of voiding (e.g. releasing offspring links). */
  onVoid?(ctx: RecordContext, doc: D): Promise<void>;
}

export const day = (d: Date | null | undefined): string | undefined =>
  d ? d.toISOString().slice(0, 10) : undefined;
export const toDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

// ---------------------------------------------------------------------------
// People and metadata
// ---------------------------------------------------------------------------
export async function resolveActors(
  ids: (Types.ObjectId | string | null | undefined)[],
): Promise<Map<string, ActorRef>> {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  const users = await User.find({ _id: { $in: unique } }).select('displayName');
  return new Map(
    users.map((u) => [String(u._id), { id: String(u._id), displayName: u.displayName }]),
  );
}

const actorOf = (map: Map<string, ActorRef>, id: Types.ObjectId | string): ActorRef =>
  map.get(String(id)) ?? { id: String(id), displayName: 'Unknown user' };

export async function metaFor(docs: RecordDoc[]): Promise<(doc: RecordDoc) => RecordMeta> {
  const actors = await resolveActors(
    docs.flatMap((d) => [
      d.createdBy,
      d.updatedBy,
      d.voidedBy,
      ...d.attachments.map((a) => a.addedBy),
    ]),
  );
  return (d) => ({
    id: String(d._id),
    farmId: String(d.farmId),
    revision: d.revision,
    createdBy: actorOf(actors, d.createdBy),
    createdAt: d.createdAt.toISOString(),
    ...(d.updatedBy ? { updatedBy: actorOf(actors, d.updatedBy) } : {}),
    updatedAt: d.updatedAt.toISOString(),
    ...(d.voided && d.voidedAt && d.voidedBy
      ? {
          voided: {
            at: d.voidedAt.toISOString(),
            by: actorOf(actors, d.voidedBy),
            reason: d.voidReason ?? '',
          },
        }
      : {}),
    attachments: d.attachments.map((a): RecordAttachment => ({
      id: String(a._id),
      kind: a.kind,
      url: a.url,
      ...(a.mimeType ? { mimeType: a.mimeType } : {}),
      ...(a.caption ? { caption: a.caption } : {}),
      addedBy: actorOf(actors, a.addedBy),
      addedAt: a.addedAt.toISOString(),
    })),
  });
}

export async function historyFor(doc: RecordDoc): Promise<RecordHistoryEntry[]> {
  const actors = await resolveActors(doc.history.map((h) => h.by));
  return doc.history.map((h) => ({
    at: h.at.toISOString(),
    by: actorOf(actors, h.by),
    kind: h.kind,
    ...(h.reason ? { reason: h.reason } : {}),
    changes: h.changes.map((c) => ({ field: c.field, from: c.from ?? null, to: c.to ?? null })),
  }));
}

export async function animalLites(
  farmId: Types.ObjectId,
  ids: (Types.ObjectId | string | null | undefined)[],
): Promise<Map<string, AnimalLite>> {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  const animals = await Animal.find({ _id: { $in: unique }, farmId }).select('animalCode name');
  return new Map(
    animals.map((a) => [
      String(a._id),
      { id: String(a._id), animalCode: a.animalCode, ...(a.name ? { name: a.name } : {}) },
    ]),
  );
}

// ---------------------------------------------------------------------------
// Shared checks
// ---------------------------------------------------------------------------
const invalid = (path: string, message: string) =>
  new HttpError(400, 'VALIDATION_ERROR', 'Request validation failed', [{ path, message }]);

/** An animal referenced by a record must belong to this farm and must not be archived (archived = frozen). */
export async function requireFarmAnimal(access: FarmAccess, id: string, path = 'animalId') {
  const animal = await Animal.findOne({ _id: id, farmId: access.farm._id });
  if (!animal) throw invalid(path, 'Animal not found on this farm');
  if (animal.archivedAt) throw conflict('This animal is archived and read-only', 'ANIMAL_ARCHIVED');
  return animal;
}

/**
 * Changing an existing record of an archived animal (correct, void, attach, detach) is refused like creating one:
 * archived animals are read-only (docs/architecture/records.md). Restore the animal first to change its history.
 * Breeding records are keyed by the dam (no `animalId`) and keep their own rules.
 */
async function assertRecordAnimalWritable(doc: RecordDoc): Promise<void> {
  const animalId = (doc as unknown as { animalId?: Types.ObjectId | null }).animalId;
  if (!animalId) return;
  const animal = await Animal.findOne({ _id: animalId, farmId: doc.farmId }).select('archivedAt');
  if (animal?.archivedAt)
    throw conflict('This animal is archived and read-only', 'ANIMAL_ARCHIVED');
}

export function buildAttachments(
  inputs: {
    kind: 'photo' | 'document';
    url: string;
    mimeType?: string | undefined;
    caption?: string | undefined;
  }[],
  actor: Actor,
  policy: MediaPolicy,
) {
  const urls = new Set<string>();
  return inputs.map((a, index) => {
    assertMediaUrlAllowed(a.url, policy);
    if (a.kind === 'photo' && a.mimeType && !a.mimeType.toLowerCase().startsWith('image/')) {
      throw invalid(`attachments.${index}.mimeType`, 'A photo must be an image');
    }
    if (urls.has(a.url)) throw invalid(`attachments.${index}.url`, 'Attached twice');
    urls.add(a.url);
    return {
      kind: a.kind,
      url: a.url,
      mimeType: a.mimeType ?? null,
      caption: a.caption ?? null,
      addedBy: actor.userId,
      addedAt: new Date(),
    };
  });
}

const MAX_ATTACHMENTS = 20;

/**
 * Save a correction/void only if nobody else changed the record since it was read (compare-and-set on `revision`):
 * two simultaneous edits can never both apply on top of the same state, the later one gets a 409 and can retry.
 */
async function saveAtRevision(doc: RecordDoc, readRevision: number): Promise<void> {
  (doc as any).$where = { revision: readRevision };
  try {
    await doc.save();
  } catch (error) {
    // no document matched the read revision (or Mongoose's own array version): someone else saved in between
    if (['DocumentNotFoundError', 'VersionError'].includes((error as Error).name))
      throw conflict(
        'This record was changed by someone else at the same time. Reload it and try again.',
        'RECORD_CHANGED',
      );
    throw error;
  }
}
const stable = (v: unknown): string => JSON.stringify(v ?? null);

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------
export async function loadRecord<D extends RecordDoc>(
  spec: RecordSpec<D>,
  access: FarmAccess,
  id: Types.ObjectId,
): Promise<D> {
  // Always looked up WITH the farm: a record id from another farm is simply "not found".
  const doc = await spec.model.findOne({ _id: id, farmId: access.farm._id });
  if (!doc) throw notFound('Record not found');
  return doc as unknown as D;
}

export async function getRecord<D extends RecordDoc, T>(
  spec: RecordSpec<D, T>,
  access: FarmAccess,
  id: Types.ObjectId,
) {
  requireFarmPermission(access, spec.permissions.read);
  const doc = await loadRecord(spec, access, id);
  const [dto] = await spec.serialize([doc], { access });
  return { ...(dto as object), history: await historyFor(doc) } as T & {
    history: RecordHistoryEntry[];
  };
}

// ---------------------------------------------------------------------------
// Correct
// ---------------------------------------------------------------------------
export async function correctRecord<D extends RecordDoc, T>(
  spec: RecordSpec<D, T>,
  ctx: RecordContext,
  id: Types.ObjectId,
  body: { reason: string; changes: Record<string, unknown> },
) {
  requireFarmPermission(ctx.access, spec.permissions.correct);
  assertFarmActive(ctx.access);
  const doc = await loadRecord(spec, ctx.access, id);
  await assertRecordAnimalWritable(doc);
  if (doc.voided)
    throw conflict(
      'A voided record cannot be corrected. Create a new record instead.',
      'RECORD_VOIDED',
    );

  const unknown = Object.keys(body.changes).filter((k) => !spec.editable.includes(k));
  if (unknown.length > 0) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Some fields cannot be corrected',
      unknown.map((k) => ({
        path: `changes.${k}`,
        message: 'This field cannot be corrected. Void the record and create a new one.',
      })),
    );
  }

  const before = spec.toInput(doc);
  const candidate: Record<string, unknown> = { ...before };
  for (const [key, value] of Object.entries(body.changes)) {
    if (value === null) delete candidate[key];
    else candidate[key] = value;
  }
  const parsed = spec.createSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Request validation failed',
      parsed.error.issues.map((i) => ({ path: i.path.join('.') || '_form', message: i.message })),
    );
  }
  const extra = await spec.validate?.(ctx, parsed.data, doc);

  const after = { ...(parsed.data as Record<string, unknown>) };
  delete after['attachments'];
  const changes = Object.keys({ ...before, ...after })
    .filter((field) => stable(before[field]) !== stable(after[field]))
    .map((field) => ({ field, from: before[field] ?? null, to: after[field] ?? null }));
  if (changes.length === 0) throw conflict('Nothing changed', 'NO_CHANGE');

  const readRevision = doc.revision;
  spec.assign(doc, parsed.data, extra);
  doc.revision += 1;
  doc.updatedBy = ctx.actor.userId as unknown as Types.ObjectId;
  doc.history.push({
    at: new Date(),
    by: ctx.actor.userId as unknown as Types.ObjectId,
    kind: 'correction',
    reason: body.reason,
    changes,
  });
  await saveAtRevision(doc, readRevision);
  await recordAudit({
    actorId: ctx.actor.userId,
    action: `${spec.kind}.corrected`,
    targetType: spec.kind,
    targetId: doc._id,
    metadata: {
      farmId: String(doc.farmId),
      fields: changes.map((c) => c.field),
      reason: body.reason,
      revision: doc.revision,
    },
    ip: ctx.actor.ip,
  });
  return getRecord(spec, ctx.access, doc._id);
}

// ---------------------------------------------------------------------------
// Void (the only "delete" there is)
// ---------------------------------------------------------------------------
export async function voidRecord<D extends RecordDoc, T>(
  spec: RecordSpec<D, T>,
  ctx: RecordContext,
  id: Types.ObjectId,
  reason: string,
) {
  requireFarmPermission(ctx.access, spec.permissions.correct);
  assertFarmActive(ctx.access);
  const doc = await loadRecord(spec, ctx.access, id);
  await assertRecordAnimalWritable(doc);
  if (doc.voided) throw conflict('This record is already voided', 'NO_CHANGE');

  const readRevision = doc.revision;
  doc.voided = true;
  doc.voidedAt = new Date();
  doc.voidedBy = ctx.actor.userId as unknown as Types.ObjectId;
  doc.voidReason = reason;
  doc.revision += 1;
  doc.updatedBy = ctx.actor.userId as unknown as Types.ObjectId;
  doc.history.push({
    at: new Date(),
    by: ctx.actor.userId as unknown as Types.ObjectId,
    kind: 'void',
    reason,
    changes: [{ field: 'voided', from: false, to: true }],
  });
  // Claim the void first (a parallel void loses with 409), then run its side effects exactly once.
  await saveAtRevision(doc, readRevision);
  await spec.onVoid?.(ctx, doc);
  await recordAudit({
    actorId: ctx.actor.userId,
    action: `${spec.kind}.voided`,
    targetType: spec.kind,
    targetId: doc._id,
    metadata: { farmId: String(doc.farmId), reason },
    ip: ctx.actor.ip,
  });
  return getRecord(spec, ctx.access, doc._id);
}

// ---------------------------------------------------------------------------
// Attachments (references to files in external storage)
// ---------------------------------------------------------------------------
export async function addAttachment<D extends RecordDoc, T>(
  spec: RecordSpec<D, T>,
  ctx: RecordContext,
  id: Types.ObjectId,
  input: {
    kind: 'photo' | 'document';
    url: string;
    mimeType?: string | undefined;
    caption?: string | undefined;
  },
) {
  const doc = await loadWritableForAttachment(spec, ctx, id);
  if (doc.attachments.some((a) => a.url === input.url))
    throw conflict('This file is already attached', 'ATTACHMENT_EXISTS');
  const [attachment] = buildAttachments([input], ctx.actor, ctx.policy);
  await pushAttachment(spec, ctx, doc, attachment!);
  return getRecord(spec, ctx.access, doc._id);
}

async function loadWritableForAttachment<D extends RecordDoc, T>(
  spec: RecordSpec<D, T>,
  ctx: RecordContext,
  id: Types.ObjectId,
) {
  requireFarmPermission(ctx.access, spec.permissions.write);
  assertFarmActive(ctx.access);
  const doc = await loadRecord(spec, ctx.access, id);
  await assertRecordAnimalWritable(doc);
  if (doc.voided) throw conflict('A voided record is read-only', 'RECORD_VOIDED');
  if (doc.attachments.length >= MAX_ATTACHMENTS)
    throw conflict(`A record can have at most ${MAX_ATTACHMENTS} files`, 'ATTACHMENT_LIMIT');
  return doc;
}

/** Add one attachment, with its history entry and audit (shared by links and uploaded photos). */
async function pushAttachment<D extends RecordDoc, T>(
  spec: RecordSpec<D, T>,
  ctx: RecordContext,
  doc: D,
  attachment: { kind: 'photo' | 'document'; url: string; [k: string]: unknown },
) {
  doc.attachments.push(attachment as never);
  doc.history.push({
    at: new Date(),
    by: ctx.actor.userId as unknown as Types.ObjectId,
    kind: 'attachment_added',
    changes: [
      { field: 'attachments', from: null, to: { kind: attachment.kind, url: attachment.url } },
    ],
  });
  doc.updatedBy = ctx.actor.userId as unknown as Types.ObjectId;
  await doc.save();
  await recordAudit({
    actorId: ctx.actor.userId,
    action: `${spec.kind}.attachment_added`,
    targetType: spec.kind,
    targetId: doc._id,
    metadata: { farmId: String(doc.farmId), kind: attachment.kind },
    ip: ctx.actor.ip,
  });
}

/**
 * A photo uploaded from the device (the request body is the image): stored like animal photos (same checks, same
 * storage, served by `/animal-photos/:key`) and attached to the record. Filed under the record's animal (its dam for
 * breeding records).
 */
export async function addUploadedPhoto<D extends RecordDoc, T>(
  spec: RecordSpec<D, T>,
  ctx: RecordContext,
  id: Types.ObjectId,
  bytes: Buffer,
) {
  const doc = await loadWritableForAttachment(spec, ctx, id);
  const owner = doc as unknown as { animalId?: Types.ObjectId; damId?: Types.ObjectId };
  const stored = await storeDevicePhoto({
    actor: ctx.actor,
    farmId: doc.farmId as Types.ObjectId,
    animalId: (owner.animalId ?? owner.damId)!,
    ...(spec.kind === 'breeding' ? { breedingRecordId: doc._id as Types.ObjectId } : {}),
    bytes,
    photos: ctx.photos ?? null,
  });
  try {
    await pushAttachment(spec, ctx, doc, {
      kind: 'photo',
      url: stored.url,
      mimeType: stored.mimeType,
      caption: null,
      addedBy: ctx.actor.userId,
      addedAt: new Date(),
    });
  } catch (error) {
    await stored.discard();
    throw error;
  }
  return getRecord(spec, ctx.access, doc._id);
}

/** Removing a file needs the corrector permission and a reason: it changes what the record shows. */
export async function removeAttachment<D extends RecordDoc, T>(
  spec: RecordSpec<D, T>,
  ctx: RecordContext,
  id: Types.ObjectId,
  attachmentId: Types.ObjectId,
  reason: string,
) {
  requireFarmPermission(ctx.access, spec.permissions.correct);
  assertFarmActive(ctx.access);
  const doc = await loadRecord(spec, ctx.access, id);
  await assertRecordAnimalWritable(doc);
  if (doc.voided) throw conflict('A voided record is read-only', 'RECORD_VOIDED');
  const attachment = doc.attachments.find((a) => String(a._id) === String(attachmentId));
  if (!attachment) throw notFound('File not found');
  doc.attachments = doc.attachments.filter(
    (a) => String(a._id) !== String(attachmentId),
  ) as typeof doc.attachments;
  doc.history.push({
    at: new Date(),
    by: ctx.actor.userId as unknown as Types.ObjectId,
    kind: 'attachment_removed',
    reason,
    changes: [
      { field: 'attachments', from: { kind: attachment.kind, url: attachment.url }, to: null },
    ],
  });
  doc.updatedBy = ctx.actor.userId as unknown as Types.ObjectId;
  await doc.save();
  // An uploaded photo's file goes with it (external links are left alone); the history keeps the URL.
  await deleteDevicePhoto(attachment.url, { farmId: doc.farmId }, ctx.photos ?? null);
  await recordAudit({
    actorId: ctx.actor.userId,
    action: `${spec.kind}.attachment_removed`,
    targetType: spec.kind,
    targetId: doc._id,
    metadata: { farmId: String(doc.farmId), reason },
    ip: ctx.actor.ip,
  });
  return getRecord(spec, ctx.access, doc._id);
}

// ---------------------------------------------------------------------------
// Create / list helpers
// ---------------------------------------------------------------------------
export async function audited<T extends RecordDoc>(
  ctx: RecordContext,
  kind: RecordKind,
  doc: T,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await recordAudit({
    actorId: ctx.actor.userId,
    action: `${kind}.created`,
    targetType: kind,
    targetId: doc._id,
    metadata: { farmId: String(doc.farmId), ...extra },
    ip: ctx.actor.ip,
  });
}

export function dateRange(field: string, from?: string, to?: string): Record<string, unknown> {
  if (!from && !to) return {};
  return {
    [field]: { ...(from ? { $gte: toDate(from) } : {}), ...(to ? { $lte: toDate(to) } : {}) },
  };
}

/** Drop null / undefined / empty-string values (storage uses null for "not set"; inputs omit the field). */
export function compactObject(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const out = Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  );
  return Object.keys(out).length > 0 ? out : undefined;
}

export function stripEmpty<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  );
}
