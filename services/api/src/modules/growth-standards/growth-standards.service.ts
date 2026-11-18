import type { Types } from 'mongoose';
import type { GrowthStandardDTO, GrowthStandardKind } from '@farmplus/shared-types';
import {
  createGrowthStandardSchema,
  type CreateGrowthStandardInput,
  type UpdateGrowthStandardInput,
} from '@farmplus/validation';
import type { Actor } from '../../context';
import { HttpError, conflict, notFound } from '../../lib/errors';
import { AnimalType, GrowthStandard, type GrowthStandardDoc } from '../../models';
import { recordAudit } from '../../services/audit.service';
import { sourceOf } from './evaluate';

const invalid = (path: string, message: string) =>
  new HttpError(400, 'VALIDATION_ERROR', 'Request validation failed', [{ path, message }]);

const BOUND_FIELDS = [
  'minWeightKg',
  'maxWeightKg',
  'minHeightCm',
  'maxHeightCm',
  'minLengthCm',
  'maxLengthCm',
] as const;

export async function toGrowthStandardDTOs(
  docs: GrowthStandardDoc[],
): Promise<GrowthStandardDTO[]> {
  const types = new Map(
    (
      await AnimalType.find({
        _id: { $in: [...new Set(docs.map((d) => String(d.animalTypeId)))] },
      }).select('key name nameTh')
    ).map((t) => [String(t._id), t]),
  );
  return docs.map((d) => {
    const t = types.get(String(d.animalTypeId));
    return {
      id: String(d._id),
      animalType: {
        id: String(d.animalTypeId),
        key: t?.key ?? '?',
        name: t?.name ?? '?',
        ...(t?.nameTh ? { nameTh: t.nameTh } : {}),
      },
      ...(d.breed ? { breed: d.breed } : {}),
      sex: d.sex,
      kind: d.kind,
      ageFromDays: d.ageFromDays,
      ageToDays: d.ageToDays,
      ...Object.fromEntries(BOUND_FIELDS.filter((f) => d[f] !== null).map((f) => [f, d[f]])),
      source: sourceOf(d),
      active: d.active,
      updatedAt: d.updatedAt.toISOString(),
    };
  });
}

export async function listGrowthStandards(q: {
  animalTypeId?: string | undefined;
  kind?: GrowthStandardKind | undefined;
  includeInactive: 'true' | 'false';
}): Promise<GrowthStandardDTO[]> {
  const docs = await GrowthStandard.find({
    ...(q.animalTypeId ? { animalTypeId: q.animalTypeId } : {}),
    ...(q.kind ? { kind: q.kind } : {}),
    ...(q.includeInactive === 'true' ? {} : { active: true }),
  }).sort({ animalTypeId: 1, kind: 1, breed: 1, sex: 1, ageFromDays: 1 });
  return toGrowthStandardDTOs(docs);
}

/** The type must exist and the breed (if any) must be one of its breeds. Active ranges of the same scope must not overlap. */
async function assertConsistent(input: CreateGrowthStandardInput, selfId?: Types.ObjectId) {
  const type = await AnimalType.findById(input.animalTypeId).select('breeds');
  if (!type) throw invalid('animalTypeId', 'Unknown or inactive animal type');
  if (input.breed && !type.breeds.some((b) => b.key === input.breed))
    throw invalid('breed', 'Breed is not part of this animal type');
  const overlapping = await GrowthStandard.exists({
    animalTypeId: input.animalTypeId,
    kind: input.kind,
    breed: input.breed ?? null,
    sex: input.sex,
    active: true,
    ageFromDays: { $lt: input.ageToDays },
    ageToDays: { $gt: input.ageFromDays },
    ...(selfId ? { _id: { $ne: selfId } } : {}),
  });
  if (overlapping)
    throw conflict(
      'An active criterion for the same type, breed, sex and kind already covers part of this age range',
      'OVERLAPPING_STANDARD',
    );
}

const fieldsOf = (input: CreateGrowthStandardInput) => ({
  breed: input.breed ?? null,
  sex: input.sex,
  ageFromDays: input.ageFromDays,
  ageToDays: input.ageToDays,
  ...Object.fromEntries(BOUND_FIELDS.map((f) => [f, input[f] ?? null])),
  source: {
    kind: input.source.kind,
    citation: input.source.citation ?? null,
    note: input.source.note ?? null,
  },
});

export async function createGrowthStandard(
  actor: Actor,
  input: CreateGrowthStandardInput,
): Promise<GrowthStandardDTO> {
  await assertConsistent(input);
  const doc = await GrowthStandard.create({
    animalTypeId: input.animalTypeId,
    kind: input.kind,
    ...fieldsOf(input),
    active: true,
    createdBy: actor.userId,
    updatedBy: actor.userId,
  });
  await recordAudit({
    actorId: actor.userId,
    action: 'growth_standard.created',
    targetType: 'growth_standard',
    targetId: doc._id,
    metadata: { animalTypeId: input.animalTypeId, kind: input.kind, source: input.source.kind },
    ip: actor.ip,
  });
  return (await toGrowthStandardDTOs([doc]))[0]!;
}

/** Merge, re-validate the whole criterion with the create schema, then save (type and kind never change). */
export async function updateGrowthStandard(
  actor: Actor,
  id: Types.ObjectId,
  input: UpdateGrowthStandardInput,
): Promise<GrowthStandardDTO> {
  const doc = await GrowthStandard.findById(id);
  if (!doc) throw notFound('Growth standard not found');
  const current: Record<string, unknown> = {
    animalTypeId: String(doc.animalTypeId),
    kind: doc.kind,
    sex: doc.sex,
    ageFromDays: doc.ageFromDays,
    ageToDays: doc.ageToDays,
    ...(doc.breed ? { breed: doc.breed } : {}),
    ...Object.fromEntries(BOUND_FIELDS.filter((f) => doc[f] !== null).map((f) => [f, doc[f]])),
    source: sourceOf(doc),
  };
  const { active, ...changes } = input;
  // `null` clears an optional value.
  const merged: Record<string, unknown> = Object.fromEntries(
    Object.entries({ ...current, ...changes }).filter(([, v]) => v !== null),
  );
  const parsed = createGrowthStandardSchema.safeParse(merged);
  if (!parsed.success)
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Request validation failed',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  const willBeActive = active ?? doc.active;
  if (willBeActive) await assertConsistent(parsed.data, doc._id);
  doc.set({ ...fieldsOf(parsed.data), active: willBeActive, updatedBy: actor.userId });
  await doc.save();
  await recordAudit({
    actorId: actor.userId,
    action:
      active === false
        ? 'growth_standard.deactivated'
        : active === true
          ? 'growth_standard.reactivated'
          : 'growth_standard.updated',
    targetType: 'growth_standard',
    targetId: doc._id,
    metadata: { fields: Object.keys(input) },
    ip: actor.ip,
  });
  return (await toGrowthStandardDTOs([doc]))[0]!;
}
