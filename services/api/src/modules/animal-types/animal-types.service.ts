import type { Types } from 'mongoose';
import type { AnimalTypeSummary, ReproductionMode } from '@farmplus/shared-types';
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
      ...(b.groupKey ? { groupKey: b.groupKey } : {}),
      ...(b.composition?.length ? { composition: [...b.composition] } : {}),
    })),
    reproduction: type.reproduction ?? 'live_birth',
    rearingTypes: (type.rearingTypes ?? []).map((r) => ({
      key: r.key,
      name: r.name,
      ...(r.nameTh ? { nameTh: r.nameTh } : {}),
      active: r.active,
    })),
    breedGroups: (type.breedGroups ?? []).map((g) => ({
      key: g.key,
      name: g.name,
      ...(g.nameTh ? { nameTh: g.nameTh } : {}),
      ...(g.rearingTypeKey ? { rearingTypeKey: g.rearingTypeKey } : {}),
      active: g.active,
    })),
  };
}

export async function listAnimalTypes(includeInactive: boolean): Promise<AnimalTypeSummary[]> {
  const types = await AnimalType.find(includeInactive ? {} : { status: 'active' }).sort({
    name: 1,
  });
  return types.map((t) => toAnimalTypeSummary(includeInactive ? t : withActiveBreeds(t)));
}

/**
 * Pickers only offer active entries; admins (includeInactive) see everything. A breed in a deactivated group is
 * hidden with its group. Animals already registered keep their breed either way.
 */
function withActiveBreeds(type: AnimalTypeDoc): AnimalTypeDoc {
  const inactiveGroups = new Set(
    (type.breedGroups ?? []).filter((g) => !g.active).map((g) => g.key),
  );
  type.breeds = type.breeds.filter(
    (b) => b.active && !(b.groupKey && inactiveGroups.has(b.groupKey)),
  ) as typeof type.breeds;
  type.breedGroups = (type.breedGroups ?? []).filter((g) => g.active) as typeof type.breedGroups;
  type.rearingTypes = (type.rearingTypes ?? []).filter((r) => r.active) as typeof type.rearingTypes;
  return type;
}

function invalid(path: string, message: string): HttpError {
  return new HttpError(400, 'VALIDATION_ERROR', message, [{ path, message }]);
}

/**
 * A breed's group must exist on the same type. Composition components are free keys (a component may be a line with
 * no group of its own, such as "pakoi"), validated for shape only.
 */
function assertBreedRefs(
  type: AnimalTypeDoc,
  input: { groupKey?: string | null | undefined },
): void {
  const groups = new Set((type.breedGroups ?? []).map((g) => g.key));
  if (input.groupKey && !groups.has(input.groupKey))
    throw invalid('groupKey', `Unknown breed group "${input.groupKey}"`);
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
    reproduction?: ReproductionMode | undefined;
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
    reproduction: input.reproduction ?? 'live_birth',
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
    reproduction?: ReproductionMode | undefined;
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
  const reproduction = type.reproduction ?? 'live_birth';
  if (input.reproduction !== undefined && input.reproduction !== reproduction) {
    changes['reproduction'] = { from: reproduction, to: input.reproduction };
    type.reproduction = input.reproduction;
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
  input: {
    key: string;
    name: string;
    nameTh?: string | undefined;
    groupKey?: string | undefined;
    composition?: string[] | undefined;
  },
): Promise<AnimalTypeSummary> {
  const type = await requireType(id);
  if (type.breeds.some((b) => b.key === input.key))
    throw conflict('This breed key already exists for the animal type', 'BREED_EXISTS');
  assertBreedRefs(type, input);
  type.breeds.push({
    key: input.key,
    name: input.name,
    nameTh: input.nameTh ?? null,
    active: true,
    groupKey: input.groupKey ?? null,
    ...(input.composition ? { composition: input.composition } : {}),
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
    groupKey?: string | null | undefined;
    composition?: string[] | null | undefined;
  },
): Promise<AnimalTypeSummary> {
  const type = await requireType(id);
  const breed = type.breeds.find((b) => b.key === breedKey);
  if (!breed) throw notFound('Breed not found');
  assertBreedRefs(type, input);
  if (input.name !== undefined) breed.name = input.name;
  if (input.nameTh !== undefined) breed.nameTh = input.nameTh;
  if (input.active !== undefined) breed.active = input.active;
  if (input.groupKey !== undefined) breed.groupKey = input.groupKey;
  if (input.composition !== undefined) breed.composition = input.composition;
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

// ---------------------------------------------------------------------------
// Rearing types and breed groups (catalogue data; deactivated, never deleted)
// ---------------------------------------------------------------------------
type EntryInput = { key: string; name: string; nameTh?: string | undefined };
type EntryPatch = {
  name?: string | undefined;
  nameTh?: string | null | undefined;
  active?: boolean | undefined;
};

async function auditCatalogue(
  actor: Actor,
  type: AnimalTypeDoc,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await recordAudit({
    actorId: actor.userId,
    action,
    targetType: 'animal_type',
    targetId: type._id,
    metadata: { key: type.key, ...metadata },
    ip: actor.ip,
  });
}

export async function addRearingType(
  actor: Actor,
  id: Types.ObjectId,
  input: EntryInput,
): Promise<AnimalTypeSummary> {
  const type = await requireType(id);
  if ((type.rearingTypes ?? []).some((r) => r.key === input.key))
    throw conflict('This rearing type already exists', 'REARING_TYPE_EXISTS');
  type.rearingTypes.push({ ...input, nameTh: input.nameTh ?? null, active: true });
  await type.save();
  await auditCatalogue(actor, type, 'animal_type.rearing_type_added', { rearingType: input.key });
  return toAnimalTypeSummary(type);
}

export async function updateRearingType(
  actor: Actor,
  id: Types.ObjectId,
  key: string,
  input: EntryPatch,
): Promise<AnimalTypeSummary> {
  const type = await requireType(id);
  const entry = (type.rearingTypes ?? []).find((r) => r.key === key);
  if (!entry) throw notFound('Rearing type not found');
  if (input.name !== undefined) entry.name = input.name;
  if (input.nameTh !== undefined) entry.nameTh = input.nameTh;
  if (input.active !== undefined) entry.active = input.active;
  await type.save();
  await auditCatalogue(actor, type, 'animal_type.rearing_type_updated', {
    rearingType: key,
    fields: Object.keys(input),
  });
  return toAnimalTypeSummary(type);
}

function assertRearingType(type: AnimalTypeDoc, key: string | null | undefined): void {
  if (key && !(type.rearingTypes ?? []).some((r) => r.key === key))
    throw invalid('rearingTypeKey', `Unknown rearing type "${key}"`);
}

export async function addBreedGroup(
  actor: Actor,
  id: Types.ObjectId,
  input: EntryInput & { rearingTypeKey?: string | undefined },
): Promise<AnimalTypeSummary> {
  const type = await requireType(id);
  if ((type.breedGroups ?? []).some((g) => g.key === input.key))
    throw conflict('This breed group already exists', 'BREED_GROUP_EXISTS');
  assertRearingType(type, input.rearingTypeKey);
  type.breedGroups.push({
    key: input.key,
    name: input.name,
    nameTh: input.nameTh ?? null,
    rearingTypeKey: input.rearingTypeKey ?? null,
    active: true,
  });
  await type.save();
  await auditCatalogue(actor, type, 'animal_type.breed_group_added', { breedGroup: input.key });
  return toAnimalTypeSummary(type);
}

export async function updateBreedGroup(
  actor: Actor,
  id: Types.ObjectId,
  key: string,
  input: EntryPatch & { rearingTypeKey?: string | null | undefined },
): Promise<AnimalTypeSummary> {
  const type = await requireType(id);
  const group = (type.breedGroups ?? []).find((g) => g.key === key);
  if (!group) throw notFound('Breed group not found');
  assertRearingType(type, input.rearingTypeKey);
  if (input.name !== undefined) group.name = input.name;
  if (input.nameTh !== undefined) group.nameTh = input.nameTh;
  if (input.active !== undefined) group.active = input.active;
  if (input.rearingTypeKey !== undefined) group.rearingTypeKey = input.rearingTypeKey;
  await type.save();
  await auditCatalogue(actor, type, 'animal_type.breed_group_updated', {
    breedGroup: key,
    fields: Object.keys(input),
  });
  return toAnimalTypeSummary(type);
}
