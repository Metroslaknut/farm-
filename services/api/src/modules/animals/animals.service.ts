import { randomBytes } from 'node:crypto';
import type { Types } from 'mongoose';
import type { AnimalDetail, AnimalMedia, AnimalSummary, Page } from '@farmplus/shared-types';
import type { AnimalListQuery, CreateAnimalInput, UpdateAnimalInput } from '@farmplus/validation';
import type { Actor } from '../../context';
import { HttpError, conflict, notFound } from '../../lib/errors';
import {
  Animal,
  AnimalPhoto,
  AnimalType,
  BreedingRecord,
  Farm,
  FeedingRecord,
  HealthRecord,
  WeightRecord,
  type AnimalAttrs,
  type AnimalDoc,
  type AnimalTypeDoc,
} from '../../models';
import { reportError } from '../../lib/error-reporter';
import { recordAudit } from '../../services/audit.service';
import type { PhotoStorage } from './photo-storage';
import {
  assertFarmActive,
  loadFarmAccess,
  requireFarmPermission,
  type FarmAccess,
} from '../farms/farm-access';

const MAX_MEDIA = 20;
const MAX_ANCESTOR_DEPTH = 25;
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const invalid = (path: string, message: string) =>
  new HttpError(400, 'VALIDATION_ERROR', 'Request validation failed', [{ path, message }]);
const toDate = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
const toDay = (date: Date | null | undefined): string | undefined =>
  date ? date.toISOString().slice(0, 10) : undefined;
const isDuplicateKey = (error: unknown): boolean =>
  (error as { code?: unknown } | null)?.code === 11000;

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------
type TypeRef = {
  id: string;
  key: string;
  name: string;
  nameTh?: string;
  breeds: { key: string; name: string; nameTh?: string }[];
};

async function typeRefs(ids: Types.ObjectId[]): Promise<Map<string, TypeRef>> {
  const types = await AnimalType.find({ _id: { $in: ids } }).select('key name nameTh breeds');
  return new Map(
    types.map((t) => [
      String(t._id),
      {
        id: String(t._id),
        key: t.key,
        name: t.name,
        ...(t.nameTh ? { nameTh: t.nameTh } : {}),
        breeds: t.breeds.map((b) => ({
          key: b.key,
          name: b.name,
          ...(b.nameTh ? { nameTh: b.nameTh } : {}),
        })),
      },
    ]),
  );
}

/** Takes a document or a lean row (the list reads lean rows). */
function toSummary(
  a: AnimalAttrs & { _id: Types.ObjectId },
  types: Map<string, TypeRef>,
): AnimalSummary {
  const photo = a.media.find((m) => m.kind === 'photo');
  const type = types.get(String(a.animalTypeId));
  const breed = a.breed ? type?.breeds.find((b) => b.key === a.breed) : undefined;
  return {
    id: String(a._id),
    farmId: String(a.farmId),
    animalCode: a.animalCode,
    animalType: type
      ? {
          id: type.id,
          key: type.key,
          name: type.name,
          ...(type.nameTh ? { nameTh: type.nameTh } : {}),
        }
      : { id: String(a.animalTypeId), key: 'unknown', name: 'Unknown' },
    ...(a.breed ? { breed: a.breed } : {}),
    ...(breed ? { breedName: breed.name } : {}),
    ...(breed?.nameTh ? { breedNameTh: breed.nameTh } : {}),
    ...(a.name ? { name: a.name } : {}),
    sex: a.sex,
    ...(a.birthDate ? { birthDate: toDay(a.birthDate)! } : {}),
    currentStatus: a.currentStatus,
    archived: Boolean(a.archivedAt),
    ...(photo ? { primaryPhotoUrl: photo.url } : {}),
    createdAt: a.createdAt.toISOString(),
  };
}

const toMedia = (m: AnimalDoc['media'][number]): AnimalMedia => ({
  id: String(m._id),
  kind: m.kind,
  url: m.url,
  ...(m.mimeType ? { mimeType: m.mimeType } : {}),
  ...(m.caption ? { caption: m.caption } : {}),
  uploadedAt: m.uploadedAt.toISOString(),
});

async function toDetail(a: AnimalDoc): Promise<AnimalDetail> {
  const types = await typeRefs([a.animalTypeId]);
  const parentIds = [a.sireId, a.damId].filter((id): id is Types.ObjectId => Boolean(id));
  const parents = new Map(
    (await Animal.find({ _id: { $in: parentIds } }).select('animalCode name')).map((p) => [
      String(p._id),
      p,
    ]),
  );
  const ref = (id: Types.ObjectId | null | undefined) => {
    const p = id ? parents.get(String(id)) : undefined;
    return p
      ? { id: String(p._id), animalCode: p.animalCode, ...(p.name ? { name: p.name } : {}) }
      : undefined;
  };
  const sire = ref(a.sireId);
  const dam = ref(a.damId);
  return {
    ...toSummary(a, types),
    birthDateEstimated: a.birthDateEstimated,
    ...(a.acquisitionDate ? { acquisitionDate: toDay(a.acquisitionDate)! } : {}),
    origin: { kind: a.origin.kind, ...(a.origin.note ? { note: a.origin.note } : {}) },
    ...(sire ? { sire } : {}),
    ...(dam ? { dam } : {}),
    offspringCount: await Animal.countDocuments({ $or: [{ sireId: a._id }, { damId: a._id }] }),
    media: a.media.map(toMedia),
    ...(a.color ? { color: a.color } : {}),
    ...(a.notes ? { notes: a.notes } : {}),
    ...(a.archivedAt ? { archivedAt: a.archivedAt.toISOString() } : {}),
    ...(a.archiveReason ? { archiveReason: a.archiveReason } : {}),
    updatedAt: a.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Validation helpers (business rules the schema cannot know)
// ---------------------------------------------------------------------------
async function resolveActiveType(id: string): Promise<AnimalTypeDoc> {
  const type = await AnimalType.findById(id);
  if (!type || type.status !== 'active')
    throw invalid('animalTypeId', 'Unknown or inactive animal type');
  return type;
}

function assertBreed(type: AnimalTypeDoc, breed: string | null | undefined): void {
  if (breed && !type.breeds.some((b) => b.key === breed && b.active)) {
    throw invalid('breed', `Breed "${breed}" is not available for ${type.name}`);
  }
}

/** True if `target` appears among the ancestors of `startId` (walks sire/dam links upwards, bounded). */
export async function isAncestor(
  target: Types.ObjectId,
  startId: Types.ObjectId,
): Promise<boolean> {
  let frontier: Types.ObjectId[] = [startId];
  const seen = new Set<string>();
  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH && frontier.length > 0; depth++) {
    if (frontier.some((id) => String(id) === String(target))) return true;
    const next: Types.ObjectId[] = [];
    for (const animal of await Animal.find({ _id: { $in: frontier } }).select('sireId damId')) {
      for (const parent of [animal.sireId, animal.damId]) {
        if (parent && !seen.has(String(parent))) {
          seen.add(String(parent));
          next.push(parent);
        }
      }
    }
    frontier = next;
  }
  return false;
}

async function validateParents(args: {
  farmId: Types.ObjectId;
  type: AnimalTypeDoc;
  sireId?: string | null | undefined;
  damId?: string | null | undefined;
  selfId?: Types.ObjectId | undefined;
  birthDate?: Date | null | undefined;
}): Promise<void> {
  const { farmId, type, selfId, birthDate } = args;
  if (args.sireId && args.damId && args.sireId === args.damId)
    throw invalid('damId', 'Sire and dam must be different animals');
  const checks = [
    { path: 'sireId', id: args.sireId, forbiddenSex: 'female', label: 'sire' },
    { path: 'damId', id: args.damId, forbiddenSex: 'male', label: 'dam' },
  ] as const;
  for (const { path, id, forbiddenSex, label } of checks) {
    if (!id) continue;
    if (selfId && String(selfId) === id) throw invalid(path, 'An animal cannot be its own parent');
    // Scoped to the same farm: a parent from another farm is indistinguishable from a missing one.
    const parent = await Animal.findOne({ _id: id, farmId });
    if (!parent) throw invalid(path, `The ${label} was not found on this farm`);
    if (String(parent.animalTypeId) !== String(type._id))
      throw invalid(path, `The ${label} must be the same animal type`);
    if (parent.sex === forbiddenSex)
      throw invalid(path, `The ${label} is recorded as ${parent.sex}`);
    if (birthDate && parent.birthDate && birthDate <= parent.birthDate)
      throw invalid('birthDate', `Must be after the ${label}'s birth date`);
    if (selfId && (await isAncestor(selfId, parent._id)))
      throw invalid(path, 'That would make the animal its own ancestor');
  }
}

/**
 * A (new) birth date must not come after what is already recorded about the animal: its own weighings, health and
 * feeding records, breedings it took part in, or the birth of its offspring. Otherwise those records would predate the
 * birth and could no longer be corrected (each correction re-checks "not born yet").
 */
async function assertBirthDateFitsHistory(animal: AnimalDoc, birthDate: Date): Promise<void> {
  const live = { farmId: animal.farmId, voided: false };
  const [w, hl, fd, br, child] = await Promise.all([
    WeightRecord.findOne({ ...live, animalId: animal._id, weighedOn: { $lt: birthDate } }).select(
      '_id',
    ),
    HealthRecord.findOne({ ...live, animalId: animal._id, recordedOn: { $lt: birthDate } }).select(
      '_id',
    ),
    FeedingRecord.findOne({ ...live, animalId: animal._id, date: { $lt: birthDate } }).select(
      '_id',
    ),
    BreedingRecord.findOne({
      ...live,
      $or: [{ damId: animal._id }, { sireId: animal._id }],
      breedingDate: { $lt: birthDate },
    }).select('_id'),
    Animal.findOne({
      $or: [{ damId: animal._id }, { sireId: animal._id }],
      birthDate: { $lte: birthDate },
    }).select('_id'),
  ]);
  if (child) throw invalid('birthDate', 'Must be before the birth of this animal’s offspring');
  if (w || hl || fd || br)
    throw invalid('birthDate', 'Records for this animal exist from before this date');
}

const auditAnimal = (
  actor: Actor,
  action: string,
  animal: AnimalDoc,
  extra: Record<string, unknown> = {},
) =>
  recordAudit({
    actorId: actor.userId,
    action,
    targetType: 'animal',
    targetId: animal._id,
    metadata: { farmId: String(animal.farmId), animalCode: animal.animalCode, ...extra },
    ip: actor.ip,
  });

// ---------------------------------------------------------------------------
// Create / read
// ---------------------------------------------------------------------------
export async function createAnimal(
  actor: Actor,
  access: FarmAccess,
  input: CreateAnimalInput,
): Promise<AnimalDetail> {
  requireFarmPermission(access, 'animals.write');
  assertFarmActive(access);
  const farmId = access.farm._id;
  const type = await resolveActiveType(input.animalTypeId);
  assertBreed(type, input.breed);
  const birthDate = input.birthDate ? toDate(input.birthDate) : null;
  await validateParents({ farmId, type, sireId: input.sireId, damId: input.damId, birthDate });

  const base = {
    farmId,
    animalTypeId: type._id,
    breed: input.breed ?? null,
    name: input.name ?? null,
    sex: input.sex,
    birthDate,
    birthDateEstimated: input.birthDateEstimated,
    acquisitionDate: input.acquisitionDate ? toDate(input.acquisitionDate) : null,
    origin: { kind: input.origin.kind, note: input.origin.note ?? null },
    currentStatus: input.currentStatus,
    sireId: input.sireId ?? null,
    damId: input.damId ?? null,
    color: input.color ?? null,
    notes: input.notes ?? null,
    createdBy: actor.userId,
  };

  let animal: AnimalDoc | undefined;
  if (input.animalCode) {
    try {
      animal = await Animal.create({ ...base, animalCode: input.animalCode });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new HttpError(
          409,
          'DUPLICATE_ANIMAL_CODE',
          `Animal code "${input.animalCode}" is already used on this farm`,
          [{ path: 'animalCode', message: 'Already used on this farm' }],
        );
      }
      throw error;
    }
  } else {
    // Server-issued code. A previously hand-entered "A-00007" can collide with the sequence, so skip over such codes.
    for (let attempt = 0; attempt < 10 && !animal; attempt++) {
      const farm = await Farm.findOneAndUpdate(
        { _id: farmId },
        { $inc: { animalSeq: 1 } },
        { returnDocument: 'after' },
      );
      const code = `A-${String(farm?.animalSeq ?? attempt).padStart(5, '0')}`;
      try {
        animal = await Animal.create({ ...base, animalCode: code });
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
      }
    }
    if (!animal)
      throw conflict(
        'Could not allocate an animal code, please try again',
        'CODE_ALLOCATION_FAILED',
      );
  }
  await auditAnimal(actor, 'animal.created', animal);
  return toDetail(animal);
}

export async function listAnimals(
  access: FarmAccess,
  query: AnimalListQuery,
): Promise<Page<AnimalSummary>> {
  requireFarmPermission(access, 'animals.read');
  const filter: Record<string, unknown> = { farmId: access.farm._id };
  if (query.archived === 'false') filter['archivedAt'] = null;
  else if (query.archived === 'true') filter['archivedAt'] = { $ne: null };
  if (query.animalTypeId) filter['animalTypeId'] = query.animalTypeId;
  if (query.breed) filter['breed'] = query.breed;
  if (query.sex) filter['sex'] = query.sex;
  if (query.status) filter['currentStatus'] = query.status;
  if (query.q) {
    const rx = { $regex: escapeRegex(query.q), $options: 'i' };
    filter['$or'] = [{ animalCode: rx }, { name: rx }];
  }
  const sort = { [query.sortBy]: query.order === 'asc' ? 1 : -1, _id: 1 } as Record<string, 1 | -1>;
  const [rows, total] = await Promise.all([
    Animal.find(filter)
      // List cards need neither hydrated Mongoose documents nor the private/history fields.
      .select(
        'farmId animalCode animalTypeId breed name sex birthDate currentStatus archivedAt media createdAt',
      )
      .lean()
      // numericOrdering: A-2 sorts before A-10; strength 2: case-insensitive.
      .collation({ locale: 'en', strength: 2, numericOrdering: true })
      .sort(sort)
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize),
    Animal.countDocuments(filter),
  ]);
  const types = await typeRefs(rows.map((r) => r.animalTypeId));
  return {
    items: rows.map((r) => toSummary(r, types)),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

/** Animals are always looked up WITH their farm, so an id from another farm is simply "not found". */
async function loadAnimal(access: FarmAccess, animalId: Types.ObjectId): Promise<AnimalDoc> {
  const animal = await Animal.findOne({ _id: animalId, farmId: access.farm._id });
  if (!animal) throw notFound('Animal not found');
  return animal;
}

export async function getAnimal(
  access: FarmAccess,
  animalId: Types.ObjectId,
): Promise<AnimalDetail> {
  requireFarmPermission(access, 'animals.read');
  return toDetail(await loadAnimal(access, animalId));
}

/** `GET /animals/:id` (deep links carry only the animal id): authorise through the animal's farm. */
export async function getAnimalById(actor: Actor, animalId: Types.ObjectId): Promise<AnimalDetail> {
  const animal = await Animal.findById(animalId);
  if (!animal) throw notFound('Animal not found');
  const access = await loadFarmAccess(actor, animal.farmId); // 404 if the caller has no access to that farm
  requireFarmPermission(access, 'animals.read');
  return toDetail(animal);
}

// ---------------------------------------------------------------------------
// Update / archive
// ---------------------------------------------------------------------------
export async function updateAnimal(
  actor: Actor,
  access: FarmAccess,
  animalId: Types.ObjectId,
  input: UpdateAnimalInput,
): Promise<AnimalDetail> {
  requireFarmPermission(access, 'animals.write');
  assertFarmActive(access);
  const animal = await loadAnimal(access, animalId);
  if (animal.archivedAt)
    throw conflict(
      'Archived animals are read-only. Restore the animal to edit it.',
      'ANIMAL_ARCHIVED',
    );

  const type = (await AnimalType.findById(animal.animalTypeId))!;
  if (input.breed !== undefined) assertBreed(type, input.breed);

  const next = {
    birthDate:
      input.birthDate === undefined
        ? animal.birthDate
        : input.birthDate
          ? toDate(input.birthDate)
          : null,
    acquisitionDate:
      input.acquisitionDate === undefined
        ? animal.acquisitionDate
        : input.acquisitionDate
          ? toDate(input.acquisitionDate)
          : null,
    sex: input.sex ?? animal.sex,
  };
  if (next.birthDate && next.acquisitionDate && next.acquisitionDate < next.birthDate) {
    throw invalid('acquisitionDate', 'Acquisition date cannot be before the birth date');
  }
  const sireId =
    input.sireId === undefined ? (animal.sireId ? String(animal.sireId) : null) : input.sireId;
  const damId =
    input.damId === undefined ? (animal.damId ? String(animal.damId) : null) : input.damId;
  if (input.sireId !== undefined || input.damId !== undefined || input.birthDate !== undefined) {
    await validateParents({
      farmId: access.farm._id,
      type,
      sireId,
      damId,
      selfId: animal._id,
      birthDate: next.birthDate,
    });
  }
  if (input.birthDate !== undefined && next.birthDate)
    await assertBirthDateFitsHistory(animal, next.birthDate);
  // Changing sex must not contradict the animal's recorded offspring.
  if (input.sex && input.sex !== animal.sex) {
    if (input.sex === 'female' && (await Animal.exists({ sireId: animal._id })))
      throw conflict('This animal is recorded as a sire; it cannot be female', 'SEX_CONFLICT');
    if (input.sex === 'male' && (await Animal.exists({ damId: animal._id })))
      throw conflict('This animal is recorded as a dam; it cannot be male', 'SEX_CONFLICT');
  }

  if (input.breed !== undefined) animal.breed = input.breed;
  if (input.name !== undefined) animal.name = input.name;
  if (input.sex !== undefined) animal.sex = input.sex;
  if (input.birthDate !== undefined) animal.birthDate = next.birthDate;
  if (input.birthDateEstimated !== undefined) animal.birthDateEstimated = input.birthDateEstimated;
  if (input.acquisitionDate !== undefined) animal.acquisitionDate = next.acquisitionDate;
  if (input.origin !== undefined)
    animal.origin = { kind: input.origin.kind, note: input.origin.note ?? null };
  const previousStatus = animal.currentStatus;
  if (input.currentStatus !== undefined) animal.currentStatus = input.currentStatus;
  if (input.sireId !== undefined)
    animal.sireId = sireId ? (sireId as unknown as Types.ObjectId) : null;
  if (input.damId !== undefined) animal.damId = damId ? (damId as unknown as Types.ObjectId) : null;
  if (input.color !== undefined) animal.color = input.color;
  if (input.notes !== undefined) animal.notes = input.notes;
  await animal.save();

  await auditAnimal(actor, 'animal.updated', animal, {
    fields: Object.keys(input),
    ...(input.currentStatus !== undefined && input.currentStatus !== previousStatus
      ? { status: { from: previousStatus, to: input.currentStatus } }
      : {}),
  });
  return toDetail(animal);
}

export async function setAnimalArchived(
  actor: Actor,
  access: FarmAccess,
  animalId: Types.ObjectId,
  archived: boolean,
  reason?: string,
): Promise<AnimalDetail> {
  requireFarmPermission(access, 'animals.archive');
  assertFarmActive(access);
  const animal = await loadAnimal(access, animalId);
  if (archived === Boolean(animal.archivedAt)) {
    throw conflict(archived ? 'Animal is already archived' : 'Animal is not archived', 'NO_CHANGE');
  }
  animal.archivedAt = archived ? new Date() : null;
  animal.archivedBy = archived ? (actor.userId as unknown as Types.ObjectId) : null;
  animal.archiveReason = archived ? (reason ?? null) : null;
  await animal.save();
  await auditAnimal(
    actor,
    archived ? 'animal.archived' : 'animal.restored',
    animal,
    archived && reason ? { reason } : {},
  );
  return toDetail(animal);
}

// ---------------------------------------------------------------------------
// Media references (files live in external object storage; only metadata/URLs are stored here)
// ---------------------------------------------------------------------------
export interface MediaPolicy {
  allowedHosts: string[];
  production: boolean;
}

export function assertMediaUrlAllowed(url: string, policy: MediaPolicy): void {
  if (policy.allowedHosts.length === 0) {
    if (policy.production)
      throw new HttpError(
        400,
        'MEDIA_NOT_CONFIGURED',
        'Media links are not enabled: no allowed media hosts are configured',
      );
    return;
  }
  const host = new URL(url).hostname.toLowerCase();
  if (!policy.allowedHosts.some((h) => host === h || host.endsWith(`.${h}`))) {
    throw invalid('url', 'This host is not an allowed media source');
  }
}

export async function addMedia(
  actor: Actor,
  access: FarmAccess,
  animalId: Types.ObjectId,
  input: {
    kind: 'photo' | 'document';
    url: string;
    mimeType?: string | undefined;
    caption?: string | undefined;
  },
  policy: MediaPolicy,
): Promise<AnimalDetail> {
  requireFarmPermission(access, 'animals.write');
  assertFarmActive(access);
  const animal = await loadAnimal(access, animalId);
  if (animal.archivedAt) throw conflict('Archived animals are read-only', 'ANIMAL_ARCHIVED');
  assertMediaUrlAllowed(input.url, policy);
  if (
    input.kind === 'photo' &&
    input.mimeType &&
    !input.mimeType.toLowerCase().startsWith('image/')
  ) {
    throw invalid('mimeType', 'A photo must be an image');
  }
  if (animal.media.length >= MAX_MEDIA)
    throw conflict(`An animal can have at most ${MAX_MEDIA} files`, 'MEDIA_LIMIT');
  if (animal.media.some((m) => m.url === input.url))
    throw conflict('This file is already attached', 'MEDIA_EXISTS');

  animal.media.push({
    kind: input.kind,
    url: input.url,
    mimeType: input.mimeType ?? null,
    caption: input.caption ?? null,
    uploadedBy: actor.userId as unknown as Types.ObjectId,
    uploadedAt: new Date(),
  } as AnimalDoc['media'][number]);
  await animal.save();
  await auditAnimal(actor, 'animal.media_added', animal, { kind: input.kind });
  return toDetail(animal);
}

export async function removeMedia(
  actor: Actor,
  access: FarmAccess,
  animalId: Types.ObjectId,
  mediaId: Types.ObjectId,
  photos: PhotoStorage | null = null,
): Promise<AnimalDetail> {
  requireFarmPermission(access, 'animals.write');
  assertFarmActive(access);
  const animal = await loadAnimal(access, animalId);
  if (animal.archivedAt) throw conflict('Archived animals are read-only', 'ANIMAL_ARCHIVED');
  const media = animal.media.find((m) => String(m._id) === String(mediaId));
  if (!media) throw notFound('File not found');
  animal.media = animal.media.filter(
    (m) => String(m._id) !== String(mediaId),
  ) as typeof animal.media;
  await animal.save();
  const key = media.url.startsWith(PHOTO_PATH)
    ? media.url.slice(PHOTO_PATH.length)
    : (photos?.keyOf(media.url) ?? null);
  if (key) {
    const stored = await AnimalPhoto.findOneAndDelete({ key, animalId: animal._id }).select(
      'storage',
    );
    // The media entry is already gone; a failed object delete only leaves an unreachable-by-UI object, so report it.
    if (stored?.storage === 'r2' && photos)
      await photos
        .remove(key)
        .catch((error: unknown) =>
          reportError(error, { source: 'job', route: 'animal-photo-remove' }),
        );
  }
  await auditAnimal(actor, 'animal.media_removed', animal, { kind: media.kind });
  return toDetail(animal);
}

// ---------------------------------------------------------------------------
// Photos uploaded from the user's device (stored by FARM+ itself, see AnimalPhoto)
// ---------------------------------------------------------------------------
/** Where an uploaded photo is served; this prefix is what the animal's media entry stores. */
export const PHOTO_PATH = '/api/v1/animal-photos/';
export const PHOTO_MAX_BYTES = 3 * 1024 * 1024;

/** The image type, read from the file's first bytes (the declared Content-Type is not trusted). */
export function sniffImageType(bytes: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    return 'image/png';
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  return null;
}

export async function uploadPhoto(
  actor: Actor,
  access: FarmAccess,
  animalId: Types.ObjectId,
  bytes: Buffer,
  photos: PhotoStorage | null = null,
): Promise<AnimalDetail> {
  requireFarmPermission(access, 'animals.write');
  assertFarmActive(access);
  const animal = await loadAnimal(access, animalId);
  if (animal.archivedAt) throw conflict('Archived animals are read-only', 'ANIMAL_ARCHIVED');
  if (bytes.length === 0) throw new HttpError(400, 'EMPTY_FILE', 'The file is empty');
  if (bytes.length > PHOTO_MAX_BYTES)
    throw new HttpError(413, 'FILE_TOO_LARGE', 'The photo is too large');
  const mimeType = sniffImageType(bytes);
  if (!mimeType)
    throw new HttpError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Only JPEG, PNG or WebP photos are accepted',
    );
  if (animal.media.length >= MAX_MEDIA)
    throw conflict(`An animal can have at most ${MAX_MEDIA} files`, 'MEDIA_LIMIT');

  const key = randomBytes(24).toString('hex');
  // Object first: if the bucket refuses it nothing is recorded. If recording fails afterwards, the object is removed.
  if (photos) await photos.put(key, bytes, mimeType);
  const undoObject = async () => {
    if (photos) await photos.remove(key).catch(() => undefined);
  };
  try {
    await AnimalPhoto.create({
      key,
      farmId: animal.farmId,
      animalId: animal._id,
      uploadedBy: actor.userId,
      mimeType,
      sizeBytes: bytes.length,
      storage: photos ? 'r2' : 'database',
      ...(photos ? {} : { data: bytes }),
    });
  } catch (error) {
    await undoObject();
    throw error;
  }
  animal.media.push({
    kind: 'photo',
    url: photos ? photos.urlFor(key) : `${PHOTO_PATH}${key}`,
    mimeType,
    caption: null,
    uploadedBy: actor.userId as unknown as Types.ObjectId,
    uploadedAt: new Date(),
  } as AnimalDoc['media'][number]);
  try {
    await animal.save();
  } catch (error) {
    await AnimalPhoto.deleteOne({ key });
    await undoObject();
    throw error;
  }
  await auditAnimal(actor, 'animal.media_added', animal, { kind: 'photo' });
  return toDetail(animal);
}

/** Bytes of a database-stored photo, looked up by its unguessable key (R2 photos are served by the bucket). */
export async function readPhoto(key: string): Promise<{ mimeType: string; data: Buffer } | null> {
  if (!/^[0-9a-f]{48}$/.test(key)) return null;
  const photo = await AnimalPhoto.findOne({ key }).select('mimeType data');
  return photo?.data ? { mimeType: photo.mimeType, data: photo.data } : null;
}
