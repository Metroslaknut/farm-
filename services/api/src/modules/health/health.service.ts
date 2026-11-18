/* eslint-disable @typescript-eslint/no-explicit-any -- generic record engine: shape is driven by the per-kind config/schema */
import type { Types } from 'mongoose';
import type { HealthRecordDTO, Page } from '@farmplus/shared-types';
import { createHealthSchema, type CreateHealthInput } from '@farmplus/validation';
import { HttpError } from '../../lib/errors';
import { Animal, HealthRecord, type HealthRecordDoc } from '../../models';
import { assertFarmActive, requireFarmPermission, type FarmAccess } from '../farms/farm-access';
import {
  animalLites,
  audited,
  buildAttachments,
  compactObject,
  dateRange,
  day,
  metaFor,
  requireFarmAnimal,
  toDate,
  type RecordContext,
  type RecordSpec,
} from '../records/record-core';

const invalid = (path: string, message: string) =>
  new HttpError(400, 'VALIDATION_ERROR', 'Request validation failed', [{ path, message }]);
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const EDITABLE = [
  'type',
  'recordedOn',
  'title',
  'symptoms',
  'condition',
  'conditionStatedBy',
  'severity',
  'medication',
  'prescribedBy',
  'veterinarian',
  'withdrawalEndsOn',
  'vaccine',
  'nextDueOn',
  'relatedRecordId',
  'outcome',
  'notes',
] as const;
const DATES = ['recordedOn', 'withdrawalEndsOn', 'nextDueOn'] as const;

/**
 * Health records are a LOG of what people observed and did. FARM+ never infers a condition, never suggests a
 * treatment, medication or dosage, and never calculates withdrawal periods: every medical statement is stored
 * together with who made it (`conditionStatedBy`, `prescribedBy`).
 */
export const healthSpec: RecordSpec<HealthRecordDoc, HealthRecordDTO> = {
  kind: 'health',
  model: HealthRecord,
  permissions: { read: 'records.read', write: 'records.write', correct: 'records.correct' },
  createSchema: createHealthSchema,
  editable: EDITABLE,
  toInput(doc) {
    const input: Record<string, unknown> = { animalId: String(doc.animalId) };
    for (const key of EDITABLE) {
      const raw = doc[key as keyof HealthRecordDoc] as unknown;
      if (raw === null || raw === undefined) continue;
      if ((DATES as readonly string[]).includes(key)) input[key] = day(raw as Date);
      else if (key === 'relatedRecordId') input[key] = String(raw);
      else if (key === 'medication' || key === 'vaccine' || key === 'veterinarian')
        input[key] = compactObject(raw as Record<string, unknown>);
      else input[key] = raw;
    }
    return input;
  },
  assign(doc, input: CreateHealthInput) {
    for (const key of EDITABLE) {
      const value = (input as Record<string, unknown>)[key];
      if ((DATES as readonly string[]).includes(key))
        (doc as any)[key] = value ? toDate(value as string) : null;
      else (doc as any)[key] = value === undefined ? null : value;
    }
  },
  async validate(ctx, input: CreateHealthInput, existing) {
    const animal = existing
      ? await Animal.findOne({ _id: existing.animalId, farmId: ctx.access.farm._id })
      : await requireFarmAnimal(ctx.access, input.animalId);
    if (animal?.birthDate && toDate(input.recordedOn) < animal.birthDate) {
      throw invalid('recordedOn', 'The record cannot be dated before the animal was born');
    }
    if (input.relatedRecordId) {
      const related = await HealthRecord.findOne({
        _id: input.relatedRecordId,
        farmId: ctx.access.farm._id,
        animalId: animal?._id,
      });
      if (!related || (existing && String(related._id) === String(existing._id))) {
        throw invalid('relatedRecordId', 'Related record not found for this animal');
      }
      if (related.voided) throw invalid('relatedRecordId', 'The related record has been voided');
    }
  },
  async serialize(docs) {
    const [meta, animals] = await Promise.all([
      metaFor(docs),
      animalLites(
        docs[0]?.farmId as Types.ObjectId,
        docs.map((d) => d.animalId),
      ),
    ]);
    return docs.map((d) => ({
      ...meta(d),
      animal: animals.get(String(d.animalId)) ?? { id: String(d.animalId), animalCode: '?' },
      type: d.type,
      recordedOn: day(d.recordedOn)!,
      title: d.title,
      ...(d.symptoms ? { symptoms: d.symptoms } : {}),
      ...(d.condition ? { condition: d.condition } : {}),
      ...(d.conditionStatedBy ? { conditionStatedBy: d.conditionStatedBy } : {}),
      ...(d.severity ? { severity: d.severity } : {}),
      ...(compactObject(d.medication as never)
        ? { medication: compactObject(d.medication as never) as never }
        : {}),
      ...(d.prescribedBy ? { prescribedBy: d.prescribedBy } : {}),
      ...(compactObject(d.veterinarian as never)
        ? { veterinarian: compactObject(d.veterinarian as never) as never }
        : {}),
      ...(d.withdrawalEndsOn ? { withdrawalEndsOn: day(d.withdrawalEndsOn)! } : {}),
      ...(compactObject(d.vaccine as never)
        ? { vaccine: compactObject(d.vaccine as never) as never }
        : {}),
      ...(d.nextDueOn ? { nextDueOn: day(d.nextDueOn)! } : {}),
      ...(d.relatedRecordId ? { relatedRecordId: String(d.relatedRecordId) } : {}),
      ...(d.outcome ? { outcome: d.outcome } : {}),
      ...(d.notes ? { notes: d.notes } : {}),
    }));
  },
};

export async function createHealth(
  ctx: RecordContext,
  input: CreateHealthInput,
): Promise<HealthRecordDTO> {
  requireFarmPermission(ctx.access, healthSpec.permissions.write);
  assertFarmActive(ctx.access);
  await healthSpec.validate!(ctx, input);
  const doc = new HealthRecord({
    farmId: ctx.access.farm._id,
    animalId: input.animalId,
    createdBy: ctx.actor.userId,
    attachments: buildAttachments(input.attachments, ctx.actor, ctx.policy),
  });
  healthSpec.assign(doc, input);
  await doc.save();
  await audited(ctx, 'health', doc, { animalId: input.animalId, type: input.type });
  return (await healthSpec.serialize([doc], { access: ctx.access }))[0]!;
}

export async function listHealth(
  access: FarmAccess,
  q: {
    page: number;
    pageSize: number;
    q?: string | undefined;
    animalId?: string | undefined;
    type?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    includeVoided: 'true' | 'false';
    sortBy: 'recordedOn' | 'createdAt';
    order: 'asc' | 'desc';
  },
): Promise<Page<HealthRecordDTO>> {
  requireFarmPermission(access, 'records.read');
  const filter: Record<string, unknown> = {
    farmId: access.farm._id,
    ...dateRange('recordedOn', q.from, q.to),
  };
  if (q.includeVoided === 'false') filter['voided'] = false;
  if (q.animalId) filter['animalId'] = q.animalId;
  if (q.type) filter['type'] = q.type;
  if (q.q) {
    const rx = { $regex: escapeRegex(q.q), $options: 'i' };
    filter['$or'] = [
      { title: rx },
      { condition: rx },
      { 'medication.name': rx },
      { 'vaccine.name': rx },
    ];
  }
  const sort = { [q.sortBy]: q.order === 'asc' ? 1 : -1, _id: -1 } as Record<string, 1 | -1>;
  const [rows, total] = await Promise.all([
    HealthRecord.find(filter)
      .sort(sort)
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize),
    HealthRecord.countDocuments(filter),
  ]);
  return {
    items: rows.length ? await healthSpec.serialize(rows, { access }) : [],
    page: q.page,
    pageSize: q.pageSize,
    total,
  };
}
