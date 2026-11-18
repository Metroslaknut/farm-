import type { Types } from 'mongoose';
import type {
  AnimalLite,
  BreedingRecordDTO,
  BreedingStatus,
  LineageResponse,
  Page,
  PedigreeAnimal,
  PedigreeNode,
} from '@farmplus/shared-types';
import {
  createBreedingSchema,
  type CreateBreedingInput,
  type RecordDeliveryInput,
} from '@farmplus/validation';
import { HttpError, conflict, notFound } from '../../lib/errors';
import {
  Animal,
  AnimalType,
  BreedingRecord,
  type AnimalDoc,
  type AnimalTypeDoc,
  type BreedingRecordDoc,
} from '../../models';
import { recordAudit } from '../../services/audit.service';
import { createAnimal, isAncestor } from '../animals/animals.service';
import { assertFarmActive, requireFarmPermission, type FarmAccess } from '../farms/farm-access';
import {
  animalLites,
  audited,
  buildAttachments,
  dateRange,
  day,
  metaFor,
  toDate,
  type RecordContext,
  type RecordSpec,
} from '../records/record-core';

const DAY_MS = 86_400_000;
const invalid = (path: string, message: string) =>
  new HttpError(400, 'VALIDATION_ERROR', 'Request validation failed', [{ path, message }]);
const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY_MS);
const ageDays = (animal: AnimalDoc, on: Date): number | undefined =>
  animal.birthDate ? Math.floor((on.getTime() - animal.birthDate.getTime()) / DAY_MS) : undefined;
const EDITABLE = ['sireId', 'sireExternal', 'method', 'breedingDate', 'notes'] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const cleanExternal = (
  ext: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined => {
  const out = ext ? Object.fromEntries(Object.entries(ext).filter(([, v]) => v)) : {};
  return Object.keys(out).length ? out : undefined;
};

interface Computed {
  expectedDeliveryDate: Date | null;
  warnings: string[];
}

function ageRule(
  animal: AnimalDoc,
  type: AnimalTypeDoc,
  on: Date,
  label: string,
  path: string,
): void {
  // Only where an administrator configured a minimum age for the species, and only when the birth date is known.
  const age = ageDays(animal, on);
  if (type.minBreedingAgeDays != null && age !== undefined && age < type.minBreedingAgeDays) {
    throw invalid(
      path,
      `The ${label} was ${age} days old; the minimum configured for ${type.name} is ${type.minBreedingAgeDays} days`,
    );
  }
}

/**
 * Breeding records link EXISTING animal identities (Part 07) — a birth never creates a second copy of an animal.
 * Rules checked here: dam female, sire male, same species, ages (where configured), no parent×offspring pairing,
 * no overlapping pregnancies for one dam. Shared ancestry is reported as an informational warning, not blocked.
 */
export const breedingSpec: RecordSpec<BreedingRecordDoc, BreedingRecordDTO> = {
  kind: 'breeding',
  model: BreedingRecord,
  permissions: { read: 'records.read', write: 'records.write', correct: 'records.correct' },
  createSchema: createBreedingSchema,
  editable: EDITABLE,
  toInput(doc) {
    const input: Record<string, unknown> = {
      damId: String(doc.damId),
      method: doc.method,
      breedingDate: day(doc.breedingDate),
    };
    if (doc.sireId) input['sireId'] = String(doc.sireId);
    const ext = cleanExternal(doc.sireExternal as Record<string, unknown> | null);
    if (ext) input['sireExternal'] = ext;
    if (doc.notes) input['notes'] = doc.notes;
    return input;
  },
  assign(doc, input: CreateBreedingInput, extra: Computed) {
    doc.sireId = (input.sireId as unknown as Types.ObjectId) ?? null;
    doc.sireExternal = input.sireExternal ?? null;
    doc.method = input.method;
    doc.breedingDate = toDate(input.breedingDate);
    doc.notes = input.notes ?? null;
    doc.expectedDeliveryDate = extra.expectedDeliveryDate;
    doc.warnings = extra.warnings;
  },
  async validate(ctx, input: CreateBreedingInput, existing): Promise<Computed> {
    const farmId = ctx.access.farm._id;
    const damId = existing ? String(existing.damId) : input.damId;
    const dam = await Animal.findOne({ _id: damId, farmId });
    if (!dam) throw invalid('damId', 'The dam was not found on this farm');
    if (!existing && dam.archivedAt)
      throw conflict('The dam is archived and read-only', 'ANIMAL_ARCHIVED');
    if (dam.sex !== 'female') throw invalid('damId', 'The dam must be recorded as female');
    const type = (await AnimalType.findById(dam.animalTypeId))!;
    const date = toDate(input.breedingDate);
    if (dam.birthDate && date < dam.birthDate)
      throw invalid('breedingDate', 'The dam was not born yet on this date');
    ageRule(dam, type, date, 'dam', 'breedingDate');

    const warnings: string[] = [];
    // A corrected breeding date must stay before every later event already recorded on it.
    if (existing?.pregnancyConfirmedOn && date > existing.pregnancyConfirmedOn)
      throw invalid('breedingDate', 'Breeding cannot be after the recorded pregnancy check');
    if (existing?.failedOn && date > existing.failedOn)
      throw invalid('breedingDate', 'Breeding cannot be after the recorded failure date');
    if (existing?.status === 'delivered') {
      if (existing.delivery && date > existing.delivery.date)
        throw invalid('breedingDate', 'Breeding cannot be after the recorded delivery');
      if (
        !same(input.sireId, existing.sireId ? String(existing.sireId) : undefined) ||
        !same(
          input.sireExternal,
          cleanExternal(existing.sireExternal as Record<string, unknown> | null),
        )
      ) {
        throw conflict(
          'The sire cannot be corrected after delivery: the offspring were linked to it. Void this record and create a new one.',
          'SIRE_LOCKED',
        );
      }
    }
    if (input.sireId) {
      const sire = await Animal.findOne({ _id: input.sireId, farmId });
      if (!sire) throw invalid('sireId', 'The sire was not found on this farm');
      if (!existing && sire.archivedAt)
        throw conflict('The sire is archived and read-only', 'ANIMAL_ARCHIVED');
      if (sire.sex !== 'male') throw invalid('sireId', 'The sire must be recorded as male');
      if (String(sire.animalTypeId) !== String(dam.animalTypeId))
        throw invalid('sireId', 'The sire must be the same animal type as the dam');
      if (sire.birthDate && date < sire.birthDate)
        throw invalid('breedingDate', 'The sire was not born yet on this date');
      ageRule(sire, type, date, 'sire', 'breedingDate');
      if (dam.sireId && String(dam.sireId) === String(sire._id))
        throw invalid('sireId', 'The sire is the dam’s own father');
      if (sire.damId && String(sire.damId) === String(dam._id))
        throw invalid('sireId', 'The sire is the dam’s own son');
      const sharesSire = sire.sireId && dam.sireId && String(sire.sireId) === String(dam.sireId);
      const sharesDam = sire.damId && dam.damId && String(sire.damId) === String(dam.damId);
      if (sharesSire || sharesDam)
        warnings.push('The sire and dam share a parent (siblings or half-siblings).');
    }

    // One pregnancy at a time per dam.
    const others = await BreedingRecord.find({
      farmId,
      damId: dam._id,
      voided: false,
      ...(existing ? { _id: { $ne: existing._id } } : {}),
    });
    for (const other of others) {
      if (other.status === 'bred' || other.status === 'pregnant') {
        throw conflict(
          'This dam already has an open breeding record. Record its delivery or failure first.',
          'DAM_ALREADY_BRED',
        );
      }
      const end = other.status === 'delivered' ? other.delivery?.date : other.failedOn;
      if (end && date >= other.breedingDate && date <= end) {
        throw conflict(
          'This date falls inside an earlier breeding record of the same dam.',
          'OVERLAPPING_BREEDING',
        );
      }
    }
    return {
      expectedDeliveryDate: type.gestationDays ? addDays(date, type.gestationDays) : null,
      warnings,
    };
  },
  async serialize(docs) {
    const ids = docs.flatMap((d) => [
      d.damId,
      d.sireId,
      ...(d.delivery?.offspring.map((o) => o.animalId) ?? []),
    ]);
    const [meta, animals] = await Promise.all([
      metaFor(docs),
      animalLites(docs[0]?.farmId as Types.ObjectId, ids),
    ]);
    const lite = (id: Types.ObjectId | null | undefined): AnimalLite | undefined =>
      id ? (animals.get(String(id)) ?? { id: String(id), animalCode: '?' }) : undefined;
    return docs.map((d) => {
      const sire = lite(d.sireId);
      const ext = cleanExternal(d.sireExternal as Record<string, unknown> | null);
      return {
        ...meta(d),
        dam: lite(d.damId)!,
        ...(sire ? { sire } : {}),
        ...(ext ? { sireExternal: ext } : {}),
        method: d.method,
        breedingDate: day(d.breedingDate)!,
        status: d.status,
        ...(d.expectedDeliveryDate ? { expectedDeliveryDate: day(d.expectedDeliveryDate)! } : {}),
        ...(d.pregnancyConfirmedOn ? { pregnancyConfirmedOn: day(d.pregnancyConfirmedOn)! } : {}),
        ...(d.failedOn
          ? {
              failedOn: day(d.failedOn)!,
              ...(d.failureReason ? { failureReason: d.failureReason } : {}),
            }
          : {}),
        ...(d.delivery
          ? {
              delivery: {
                date: day(d.delivery.date)!,
                offspring: d.delivery.offspring.map((o) => ({
                  ...(o.animalId ? { animal: lite(o.animalId)! } : {}),
                  outcome: o.outcome,
                  ...(o.sex ? { sex: o.sex } : {}),
                  ...(o.note ? { note: o.note } : {}),
                })),
              },
            }
          : {}),
        ...(d.notes ? { notes: d.notes } : {}),
        warnings: d.warnings ?? [],
      };
    });
  },
  /** Voiding a delivered record releases its offspring links (the animals themselves stay, with their own identity). */
  async onVoid(ctx, doc) {
    for (const o of doc.delivery?.offspring ?? []) {
      if (!o.animalId) continue;
      const animal = await Animal.findOne({ _id: o.animalId, farmId: doc.farmId });
      if (!animal) continue;
      const cleared: string[] = [];
      if (animal.damId && String(animal.damId) === String(doc.damId)) {
        animal.damId = null;
        cleared.push('damId');
      }
      if (doc.sireId && animal.sireId && String(animal.sireId) === String(doc.sireId)) {
        animal.sireId = null;
        cleared.push('sireId');
      }
      if (cleared.length) {
        await animal.save();
        await recordAudit({
          actorId: ctx.actor.userId,
          action: 'breeding.offspring_unlinked',
          targetType: 'animal',
          targetId: animal._id,
          metadata: { farmId: String(doc.farmId), breedingRecordId: String(doc._id), cleared },
          ip: ctx.actor.ip,
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------
// Create / list
// ---------------------------------------------------------------------------
export async function createBreeding(
  ctx: RecordContext,
  input: CreateBreedingInput,
): Promise<BreedingRecordDTO> {
  requireFarmPermission(ctx.access, 'records.write');
  assertFarmActive(ctx.access);
  const computed = (await breedingSpec.validate!(ctx, input)) as Computed;
  const doc = new BreedingRecord({
    farmId: ctx.access.farm._id,
    damId: input.damId,
    createdBy: ctx.actor.userId,
    status: 'bred',
    attachments: buildAttachments(input.attachments, ctx.actor, ctx.policy),
  });
  breedingSpec.assign(doc, input, computed);
  await doc.save();
  await audited(ctx, 'breeding', doc, { damId: input.damId, sireId: input.sireId ?? null });
  return (await breedingSpec.serialize([doc], { access: ctx.access }))[0]!;
}

export async function listBreeding(
  access: FarmAccess,
  q: {
    page: number;
    pageSize: number;
    damId?: string | undefined;
    sireId?: string | undefined;
    status?: BreedingStatus | undefined;
    from?: string | undefined;
    to?: string | undefined;
    includeVoided: 'true' | 'false';
    sortBy: 'breedingDate' | 'createdAt';
    order: 'asc' | 'desc';
  },
): Promise<Page<BreedingRecordDTO>> {
  requireFarmPermission(access, 'records.read');
  const filter: Record<string, unknown> = {
    farmId: access.farm._id,
    ...dateRange('breedingDate', q.from, q.to),
  };
  if (q.includeVoided === 'false') filter['voided'] = false;
  if (q.damId) filter['damId'] = q.damId;
  if (q.sireId) filter['sireId'] = q.sireId;
  if (q.status) filter['status'] = q.status;
  const sort = { [q.sortBy]: q.order === 'asc' ? 1 : -1, _id: -1 } as Record<string, 1 | -1>;
  const [rows, total] = await Promise.all([
    BreedingRecord.find(filter)
      .sort(sort)
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize),
    BreedingRecord.countDocuments(filter),
  ]);
  return {
    items: rows.length ? await breedingSpec.serialize(rows, { access }) : [],
    page: q.page,
    pageSize: q.pageSize,
    total,
  };
}

// ---------------------------------------------------------------------------
// Status events (these RECORD things that happened; they are not corrections)
// ---------------------------------------------------------------------------
async function loadOpen(
  ctx: RecordContext,
  id: Types.ObjectId,
  allowed: BreedingStatus[],
): Promise<BreedingRecordDoc> {
  requireFarmPermission(ctx.access, 'records.write');
  assertFarmActive(ctx.access);
  const doc = await BreedingRecord.findOne({ _id: id, farmId: ctx.access.farm._id });
  if (!doc) throw notFound('Record not found');
  if (doc.voided) throw conflict('A voided record is read-only', 'RECORD_VOIDED');
  if (!allowed.includes(doc.status))
    throw conflict(
      `This record is ${doc.status}; that step is not possible now.`,
      'INVALID_TRANSITION',
    );
  return doc;
}

/** The closing date must not run past the dam's next breeding. */
async function assertNoLaterBreedingWithin(doc: BreedingRecordDoc, closing: Date): Promise<void> {
  const later = await BreedingRecord.exists({
    farmId: doc.farmId,
    damId: doc.damId,
    voided: false,
    _id: { $ne: doc._id },
    breedingDate: { $gt: doc.breedingDate, $lte: closing },
  });
  if (later)
    throw conflict(
      'Another breeding of the same dam starts before this date.',
      'OVERLAPPING_BREEDING',
    );
}

async function finish(
  ctx: RecordContext,
  doc: BreedingRecordDoc,
  event: { field: string; from: unknown; to: unknown }[],
  action: string,
) {
  doc.revision += 1;
  doc.updatedBy = ctx.actor.userId as unknown as Types.ObjectId;
  doc.history.push({
    at: new Date(),
    by: ctx.actor.userId as unknown as Types.ObjectId,
    kind: 'event',
    changes: event,
  });
  await doc.save();
  await recordAudit({
    actorId: ctx.actor.userId,
    action: `breeding.${action}`,
    targetType: 'breeding',
    targetId: doc._id,
    metadata: { farmId: String(doc.farmId), damId: String(doc.damId) },
    ip: ctx.actor.ip,
  });
  return (await breedingSpec.serialize([doc], { access: ctx.access }))[0]!;
}

export async function confirmPregnancy(
  ctx: RecordContext,
  id: Types.ObjectId,
  input: { date: string; notes?: string | undefined },
): Promise<BreedingRecordDTO> {
  const doc = await loadOpen(ctx, id, ['bred']);
  const date = toDate(input.date);
  if (date < doc.breedingDate)
    throw invalid('date', 'The check cannot be before the breeding date');
  doc.status = 'pregnant';
  doc.pregnancyConfirmedOn = date;
  if (input.notes) doc.notes = [doc.notes, input.notes].filter(Boolean).join('\n');
  return finish(
    ctx,
    doc,
    [
      { field: 'status', from: 'bred', to: 'pregnant' },
      { field: 'pregnancyConfirmedOn', from: null, to: input.date },
    ],
    'pregnancy_confirmed',
  );
}

export async function failBreeding(
  ctx: RecordContext,
  id: Types.ObjectId,
  input: { date: string; reason: string },
): Promise<BreedingRecordDTO> {
  const doc = await loadOpen(ctx, id, ['bred', 'pregnant']);
  const date = toDate(input.date);
  if (date < doc.breedingDate) throw invalid('date', 'This cannot be before the breeding date');
  await assertNoLaterBreedingWithin(doc, date);
  const from = doc.status;
  doc.status = 'failed';
  doc.failedOn = date;
  doc.failureReason = input.reason;
  return finish(
    ctx,
    doc,
    [
      { field: 'status', from, to: 'failed' },
      { field: 'failedOn', from: null, to: input.date },
      { field: 'failureReason', from: null, to: input.reason },
    ],
    'failed',
  );
}

// ---------------------------------------------------------------------------
// Delivery and offspring
// ---------------------------------------------------------------------------
type OffspringEntry = RecordDeliveryInput['offspring'][number];
interface Applied {
  entry: {
    animalId?: Types.ObjectId | null;
    outcome: 'alive' | 'stillborn' | 'died_at_birth';
    sex?: 'male' | 'female' | 'unknown' | null;
    note?: string | null;
  };
  undo?: () => Promise<void>;
}

async function ensureLinkable(
  doc: BreedingRecordDoc,
  dam: AnimalDoc,
  animalId: string,
  date: Date,
  path: string,
): Promise<AnimalDoc> {
  const animal = await Animal.findOne({ _id: animalId, farmId: doc.farmId });
  if (!animal) throw invalid(`${path}.animalId`, 'Animal not found on this farm');
  if (animal.archivedAt) throw conflict('That animal is archived and read-only', 'ANIMAL_ARCHIVED');
  if (
    String(animal._id) === String(doc.damId) ||
    (doc.sireId && String(animal._id) === String(doc.sireId))
  )
    throw invalid(`${path}.animalId`, 'An animal cannot be its own parent’s offspring');
  if (String(animal.animalTypeId) !== String(dam.animalTypeId))
    throw invalid(`${path}.animalId`, 'The offspring must be the same animal type as the dam');
  if (animal.birthDate && animal.birthDate.getTime() !== date.getTime())
    throw invalid(
      `${path}.animalId`,
      `The animal’s recorded birth date (${day(animal.birthDate)}) differs from the delivery date`,
    );
  if (animal.damId && String(animal.damId) !== String(doc.damId))
    throw conflict('That animal already has a different dam recorded', 'PARENT_CONFLICT');
  if (animal.sireId && doc.sireId && String(animal.sireId) !== String(doc.sireId))
    throw conflict('That animal already has a different sire recorded', 'PARENT_CONFLICT');
  if (await isAncestor(animal._id, dam._id))
    throw invalid(`${path}.animalId`, 'That animal is an ancestor of the dam');
  // The sire becomes this animal's parent too: it must not already descend from this animal (no lineage cycles).
  if (doc.sireId && (await isAncestor(animal._id, doc.sireId)))
    throw invalid(`${path}.animalId`, 'That animal is an ancestor of the sire');
  if (
    await BreedingRecord.exists({
      farmId: doc.farmId,
      voided: false,
      _id: { $ne: doc._id },
      'delivery.offspring.animalId': animal._id,
    })
  ) {
    throw conflict(
      'That animal is already recorded as the offspring of another breeding',
      'ALREADY_OFFSPRING',
    );
  }
  return animal;
}

/**
 * Apply offspring entries. Existing animals are LINKED (parents set on the one identity), new ones are REGISTERED
 * through the normal animal service (so code uniqueness etc. apply), stillbirths are counted without an identity.
 * Everything is validated before anything is written; if a later step still fails, earlier steps are rolled back
 * (registered animals are archived — identities are never deleted).
 */
async function applyOffspring(
  ctx: RecordContext,
  doc: BreedingRecordDoc,
  dam: AnimalDoc,
  date: Date,
  entries: OffspringEntry[],
): Promise<Applied[]> {
  const seenIds = new Set<string>(doc.delivery?.offspring.map((o) => String(o.animalId)) ?? []);
  const seenCodes = new Set<string>();
  const checked: { entry: OffspringEntry; animal?: AnimalDoc }[] = [];
  for (const [i, entry] of entries.entries()) {
    const path = `offspring.${i}`;
    if ('animalId' in entry) {
      if (seenIds.has(entry.animalId))
        throw invalid(`${path}.animalId`, 'This animal is listed twice');
      seenIds.add(entry.animalId);
      checked.push({ entry, animal: await ensureLinkable(doc, dam, entry.animalId, date, path) });
    } else if ('register' in entry) {
      const code = entry.register.animalCode?.toLowerCase();
      if (code) {
        if (seenCodes.has(code))
          throw invalid(`${path}.register.animalCode`, 'This code is listed twice');
        seenCodes.add(code);
      }
      checked.push({ entry });
    } else checked.push({ entry });
  }

  const applied: Applied[] = [];
  try {
    for (const { entry, animal } of checked) {
      if ('animalId' in entry && animal) {
        const before = { damId: animal.damId, sireId: animal.sireId, birthDate: animal.birthDate };
        animal.damId = doc.damId;
        if (doc.sireId && !animal.sireId) animal.sireId = doc.sireId;
        if (!animal.birthDate) animal.birthDate = date;
        await animal.save();
        await recordAudit({
          actorId: ctx.actor.userId,
          action: 'breeding.offspring_linked',
          targetType: 'animal',
          targetId: animal._id,
          metadata: { farmId: String(doc.farmId), breedingRecordId: String(doc._id) },
          ip: ctx.actor.ip,
        });
        applied.push({
          entry: {
            animalId: animal._id,
            outcome: 'alive',
            sex: animal.sex,
            note: entry.note ?? null,
          },
          undo: async () => {
            animal.damId = before.damId ?? null;
            animal.sireId = before.sireId ?? null;
            animal.birthDate = before.birthDate ?? null;
            await animal.save();
          },
        });
      } else if ('register' in entry) {
        const created = await createAnimal(ctx.actor, ctx.access, {
          animalTypeId: String(dam.animalTypeId),
          ...(entry.register.animalCode ? { animalCode: entry.register.animalCode } : {}),
          ...(entry.register.name ? { name: entry.register.name } : {}),
          ...(entry.register.breed ? { breed: entry.register.breed } : {}),
          sex: entry.register.sex,
          birthDate: day(date)!,
          birthDateEstimated: false,
          origin: { kind: 'born_on_farm' },
          currentStatus: 'active',
          damId: String(doc.damId),
          ...(doc.sireId ? { sireId: String(doc.sireId) } : {}),
          ...(entry.register.notes ? { notes: entry.register.notes } : {}),
        });
        applied.push({
          entry: {
            animalId: created.id as unknown as Types.ObjectId,
            outcome: 'alive',
            sex: entry.register.sex,
            note: entry.note ?? null,
          },
          undo: async () => {
            const a = await Animal.findById(created.id);
            if (a) {
              a.archivedAt = new Date();
              a.archivedBy = ctx.actor.userId as unknown as Types.ObjectId;
              a.archiveReason = 'Rolled back: the delivery could not be recorded';
              await a.save();
            }
          },
        });
      } else if ('outcome' in entry) {
        applied.push({
          entry: { outcome: entry.outcome, sex: entry.sex ?? null, note: entry.note ?? null },
        });
      }
    }
  } catch (error) {
    for (const a of applied.reverse()) await a.undo?.().catch(() => undefined);
    throw error;
  }
  return applied;
}

async function damOf(doc: BreedingRecordDoc): Promise<AnimalDoc> {
  const dam = await Animal.findOne({ _id: doc.damId, farmId: doc.farmId });
  if (!dam) throw notFound('The dam no longer exists');
  return dam;
}

export async function recordDelivery(
  ctx: RecordContext,
  id: Types.ObjectId,
  input: RecordDeliveryInput,
): Promise<BreedingRecordDTO> {
  const doc = await loadOpen(ctx, id, ['bred', 'pregnant']);
  const date = toDate(input.date);
  if (date < doc.breedingDate)
    throw invalid('date', 'The delivery cannot be before the breeding date');
  if (doc.pregnancyConfirmedOn && date < doc.pregnancyConfirmedOn)
    throw invalid('date', 'The delivery cannot be before the pregnancy check');
  await assertNoLaterBreedingWithin(doc, date);
  const dam = await damOf(doc);
  const previous = doc.status;

  // Claim: only one request can move this record to "delivered"; a concurrent one gets 409 before touching any animal.
  const claimed = await BreedingRecord.findOneAndUpdate(
    { _id: doc._id, status: { $in: ['bred', 'pregnant'] }, voided: false },
    {
      $set: { status: 'delivered', delivery: { date, notes: input.notes ?? null, offspring: [] } },
    },
    { returnDocument: 'after' },
  );
  if (!claimed) throw conflict('This delivery was already recorded', 'INVALID_TRANSITION');
  try {
    const applied = await applyOffspring(ctx, claimed, dam, date, input.offspring);
    claimed.delivery = {
      date,
      notes: input.notes ?? null,
      offspring: applied.map((a) => a.entry),
    } as never;
    return await finish(
      ctx,
      claimed,
      [
        { field: 'status', from: previous, to: 'delivered' },
        { field: 'delivery.date', from: null, to: input.date },
        { field: 'delivery.offspring', from: null, to: applied.length },
      ],
      'delivered',
    );
  } catch (error) {
    await BreedingRecord.updateOne(
      { _id: doc._id },
      { $set: { status: previous, delivery: null } },
    );
    if ((error as { code?: unknown } | null)?.code === 11000)
      throw conflict(
        'An animal is already recorded as offspring of another breeding',
        'ALREADY_OFFSPRING',
      );
    throw error;
  }
}

/** Late registration / linking of further offspring on an already delivered record. */
export async function addOffspring(
  ctx: RecordContext,
  id: Types.ObjectId,
  input: { offspring: OffspringEntry[] },
): Promise<BreedingRecordDTO> {
  const doc = await loadOpen(ctx, id, ['delivered']);
  if (input.offspring.length === 0) throw invalid('offspring', 'Add at least one offspring');
  const dam = await damOf(doc);
  const date = doc.delivery!.date;
  const applied = await applyOffspring(ctx, doc, dam, date, input.offspring);
  doc.delivery!.offspring.push(...(applied.map((a) => a.entry) as never[]));
  doc.markModified('delivery');
  return finish(
    ctx,
    doc,
    [
      {
        field: 'delivery.offspring',
        from: doc.delivery!.offspring.length - applied.length,
        to: doc.delivery!.offspring.length,
      },
    ],
    'offspring_added',
  );
}

// ---------------------------------------------------------------------------
// Lineage of one animal (identity links only: no data is duplicated)
// ---------------------------------------------------------------------------
/** Ancestry is walked at most this deep (parent links are validated loop-free; this is a safety net). */
const MAX_GENERATIONS = 25;

const pedigreeAnimal = (a: AnimalDoc): PedigreeAnimal => ({
  id: String(a._id),
  animalCode: a.animalCode,
  ...(a.name ? { name: a.name } : {}),
  sex: a.sex,
  ...(a.birthDate ? { birthDate: day(a.birthDate)! } : {}),
  ...(a.breed ? { breed: a.breed } : {}),
  currentStatus: a.currentStatus,
  archived: Boolean(a.archivedAt),
});

export async function lineageFor(
  access: FarmAccess,
  animalId: Types.ObjectId,
  generations = 3,
): Promise<LineageResponse> {
  requireFarmPermission(access, 'animals.read');
  const animal = await Animal.findOne({ _id: animalId, farmId: access.farm._id });
  if (!animal) throw notFound('Animal not found');
  const lite = (a: {
    _id: Types.ObjectId;
    animalCode: string;
    name?: string | null;
  }): AnimalLite => ({
    id: String(a._id),
    animalCode: a.animalCode,
    ...(a.name ? { name: a.name } : {}),
  });
  // Ancestors, one query per generation (same farm only), cached by id.
  const known = new Map<string, AnimalDoc>([[String(animal._id), animal]]);
  let frontier: AnimalDoc[] = [animal];
  let generation = 0;
  while (frontier.length > 0 && generation < MAX_GENERATIONS) {
    const parentIds = frontier
      .flatMap((a) => [a.sireId, a.damId])
      .filter(Boolean)
      .map(String);
    const missing = [...new Set(parentIds)].filter((id) => !known.has(id));
    if (missing.length)
      for (const a of await Animal.find({ _id: { $in: missing }, farmId: animal.farmId }))
        known.set(String(a._id), a);
    const next = [...new Set(parentIds)]
      .map((id) => known.get(id))
      .filter((a): a is AnimalDoc => Boolean(a));
    if (next.length === 0) break;
    generation += 1;
    frontier = next;
  }
  const tree = (a: AnimalDoc, level: number): PedigreeNode => {
    const s = level < generations && a.sireId ? known.get(String(a.sireId)) : undefined;
    const d = level < generations && a.damId ? known.get(String(a.damId)) : undefined;
    return {
      animal: pedigreeAnimal(a),
      ...(s ? { sire: tree(s, level + 1) } : {}),
      ...(d ? { dam: tree(d, level + 1) } : {}),
    };
  };
  const sire = animal.sireId ? known.get(String(animal.sireId)) : undefined;
  const dam = animal.damId ? known.get(String(animal.damId)) : undefined;
  const parentFilter = [
    ...(animal.sireId ? [{ sireId: animal.sireId }] : []),
    ...(animal.damId ? [{ damId: animal.damId }] : []),
  ];
  const [children, siblings] = await Promise.all([
    Animal.find({
      farmId: animal.farmId,
      $or: [{ sireId: animal._id }, { damId: animal._id }],
    }).sort({ birthDate: -1, animalCode: 1 }),
    parentFilter.length
      ? Animal.find({ farmId: animal.farmId, _id: { $ne: animal._id }, $or: parentFilter }).sort({
          birthDate: 1,
          animalCode: 1,
        })
      : Promise.resolve([] as AnimalDoc[]),
  ]);
  const same = (a: Types.ObjectId | null | undefined, b: Types.ObjectId | null | undefined) =>
    Boolean(a && b && String(a) === String(b));
  return {
    animal: lite(animal),
    ...(sire ? { sire: lite(sire) } : {}),
    ...(dam ? { dam: lite(dam) } : {}),
    offspring: children.map((c) => ({
      ...lite(c),
      sex: c.sex,
      ...(c.birthDate ? { birthDate: day(c.birthDate)! } : {}),
      role: String(c.sireId) === String(animal._id) ? ('sire' as const) : ('dam' as const),
    })),
    pedigree: tree(animal, 0),
    generations,
    generation,
    siblings: siblings.map((s) => ({
      ...pedigreeAnimal(s),
      relation:
        same(s.sireId, animal.sireId) && same(s.damId, animal.damId)
          ? ('full' as const)
          : same(s.sireId, animal.sireId)
            ? ('half_sire' as const)
            : ('half_dam' as const),
    })),
  };
}
