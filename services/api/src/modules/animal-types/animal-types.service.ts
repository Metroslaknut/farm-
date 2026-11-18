import type { Types } from 'mongoose';
import type { AnimalTypeSummary } from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { HttpError, conflict, notFound } from '../../lib/errors';
import { AnimalType, type AnimalTypeDoc } from '../../models';
import { recordAudit } from '../../services/audit.service';

export function toAnimalTypeSummary(type: AnimalTypeDoc): AnimalTypeSummary {
  return {
    id: String(type._id),
    key: type.key,
    name: type.name,
    ...(type.nameTh ? { nameTh: type.nameTh } : {}),
    status: type.status,
    ...(type.gestationDays ? { gestationDays: type.gestationDays } : {}),
    ...(type.minBreedingAgeDays != null ? { minBreedingAgeDays: type.minBreedingAgeDays } : {}),
    ...(type.maxWeightKg ? { maxWeightKg: type.maxWeightKg } : {}),
    breeds: type.breeds.map((b) => ({
      key: b.key,
      name: b.name,
      ...(b.nameTh ? { nameTh: b.nameTh } : {}),
      active: b.active,
    })),
  };
}

export async function listAnimalTypes(includeInactive: boolean): Promise<AnimalTypeSummary[]> {
  const types = await AnimalType.find(includeInactive ? {} : { status: 'active' }).sort({
    name: 1,
  });
  return types.map((t) => toAnimalTypeSummary(includeInactive ? t : withActiveBreeds(t)));
}

/** Pickers only offer active breeds; admins (includeInactive) see everything. */
function withActiveBreeds(type: AnimalTypeDoc): AnimalTypeDoc {
  type.breeds = type.breeds.filter((b) => b.active) as typeof type.breeds;
  return type;
}

async function requireType(id: Types.ObjectId): Promise<AnimalTypeDoc> {
  const type = await AnimalType.findById(id);
  if (!type) throw notFound('Animal type not found');
  return type;
}

export async function createAnimalType(
  actor: Actor,
  input: {
    key: string;
    name: string;
    nameTh?: string | undefined;
    gestationDays?: number | undefined;
    minBreedingAgeDays?: number | undefined;
    maxWeightKg?: number | undefined;
    breeds: { key: string; name: string; nameTh?: string | undefined }[];
  },
): Promise<AnimalTypeSummary> {
  const keys = input.breeds.map((b) => b.key);
  const duplicate = keys.find((k, i) => keys.indexOf(k) !== i);
  if (duplicate)
    throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid breeds', [
      { path: 'breeds', message: `Duplicate breed key "${duplicate}"` },
    ]);
  if (await AnimalType.exists({ key: input.key }))
    throw conflict('An animal type with this key already exists', 'ANIMAL_TYPE_EXISTS');

  const type = await AnimalType.create({
    key: input.key,
    name: input.name,
    nameTh: input.nameTh ?? null,
    gestationDays: input.gestationDays ?? null,
    minBreedingAgeDays: input.minBreedingAgeDays ?? null,
    maxWeightKg: input.maxWeightKg ?? null,
    breeds: input.breeds.map((b) => ({ ...b, nameTh: b.nameTh ?? null, active: true })),
  });
  await recordAudit({
    actorId: actor.userId,
    action: 'animal_type.created',
    targetType: 'animal_type',
    targetId: type._id,
    metadata: { key: type.key, breeds: keys },
    ip: actor.ip,
  });
  return toAnimalTypeSummary(type);
}

export async function updateAnimalType(
  actor: Actor,
  id: Types.ObjectId,
  input: {
    name?: string | undefined;
    nameTh?: string | null | undefined;
    status?: 'active' | 'inactive' | undefined;
    gestationDays?: number | null | undefined;
    minBreedingAgeDays?: number | null | undefined;
    maxWeightKg?: number | null | undefined;
  },
): Promise<AnimalTypeSummary> {
  const type = await requireType(id);
  const changes: Record<string, unknown> = {};
  for (const key of ['gestationDays', 'minBreedingAgeDays', 'maxWeightKg'] as const) {
    const next = input[key];
    if (next !== undefined && next !== (type[key] ?? null)) {
      changes[key] = { from: type[key] ?? null, to: next };
      type[key] = next;
    }
  }
  if (input.name !== undefined && input.name !== type.name) {
    changes['name'] = { from: type.name, to: input.name };
    type.name = input.name;
  }
  if (input.nameTh !== undefined && input.nameTh !== (type.nameTh ?? null)) {
    changes['nameTh'] = { from: type.nameTh ?? null, to: input.nameTh };
    type.nameTh = input.nameTh;
  }
  if (input.status !== undefined && input.status !== type.status) {
    changes['status'] = { from: type.status, to: input.status };
    type.status = input.status;
  }
  if (Object.keys(changes).length === 0) throw conflict('Nothing to change', 'NO_CHANGE');
  await type.save();
  await recordAudit({
    actorId: actor.userId,
    action: 'animal_type.updated',
    targetType: 'animal_type',
    targetId: type._id,
    metadata: { key: type.key, changes },
    ip: actor.ip,
  });
  return toAnimalTypeSummary(type);
}

export async function addBreed(
  actor: Actor,
  id: Types.ObjectId,
  input: { key: string; name: string; nameTh?: string | undefined },
): Promise<AnimalTypeSummary> {
  const type = await requireType(id);
  if (type.breeds.some((b) => b.key === input.key))
    throw conflict('This breed key already exists for the animal type', 'BREED_EXISTS');
  type.breeds.push({
    key: input.key,
    name: input.name,
    nameTh: input.nameTh ?? null,
    active: true,
  });
  await type.save();
  await recordAudit({
    actorId: actor.userId,
    action: 'animal_type.breed_added',
    targetType: 'animal_type',
    targetId: type._id,
    metadata: { key: type.key, breed: input.key },
    ip: actor.ip,
  });
  return toAnimalTypeSummary(type);
}

export async function updateBreed(
  actor: Actor,
  id: Types.ObjectId,
  breedKey: string,
  input: {
    name?: string | undefined;
    nameTh?: string | null | undefined;
    active?: boolean | undefined;
  },
): Promise<AnimalTypeSummary> {
  const type = await requireType(id);
  const breed = type.breeds.find((b) => b.key === breedKey);
  if (!breed) throw notFound('Breed not found');
  if (input.name !== undefined) breed.name = input.name;
  if (input.nameTh !== undefined) breed.nameTh = input.nameTh;
  if (input.active !== undefined) breed.active = input.active;
  await type.save();
  await recordAudit({
    actorId: actor.userId,
    action: 'animal_type.breed_updated',
    targetType: 'animal_type',
    targetId: type._id,
    metadata: { key: type.key, breed: breedKey, fields: Object.keys(input) },
    ip: actor.ip,
  });
  return toAnimalTypeSummary(type);
}
