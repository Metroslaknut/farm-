import type { Types } from 'mongoose';
import type {
  GrowthAlert,
  GrowthPoint,
  GrowthResponse,
  Page,
  WeightRecordDTO,
} from '@farmplus/shared-types';
import { createWeightSchema, type CreateWeightInput } from '@farmplus/validation';
import { HttpError, conflict, notFound } from '../../lib/errors';
import {
  Animal,
  AnimalType,
  GrowthStandard,
  WeightRecord,
  type WeightRecordDoc,
} from '../../models';
import {
  ageInDays,
  ageWindow,
  applicable,
  evaluateMeasurement,
} from '../growth-standards/evaluate';
import { toGrowthStandardDTOs } from '../growth-standards/growth-standards.service';
import { assertFarmActive, requireFarmPermission, type FarmAccess } from '../farms/farm-access';
import {
  animalLites,
  audited,
  buildAttachments,
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
const DAY_MS = 86_400_000;

export const weightSpec: RecordSpec<WeightRecordDoc, WeightRecordDTO> = {
  kind: 'weight',
  model: WeightRecord,
  permissions: { read: 'records.read', write: 'records.write', correct: 'records.correct' },
  createSchema: createWeightSchema,
  editable: ['weighedOn', 'weightKg', 'method', 'heightCm', 'lengthCm', 'bodyCondition', 'notes'],
  toInput(doc) {
    return {
      animalId: String(doc.animalId),
      weighedOn: day(doc.weighedOn),
      weightKg: doc.weightKg,
      method: doc.method,
      ...(doc.heightCm != null ? { heightCm: doc.heightCm } : {}),
      ...(doc.lengthCm != null ? { lengthCm: doc.lengthCm } : {}),
      ...(doc.bodyCondition ? { bodyCondition: doc.bodyCondition } : {}),
      ...(doc.notes ? { notes: doc.notes } : {}),
    };
  },
  assign(doc, input: CreateWeightInput) {
    doc.weighedOn = toDate(input.weighedOn);
    doc.weightKg = input.weightKg;
    doc.method = input.method;
    doc.heightCm = input.heightCm ?? null;
    doc.lengthCm = input.lengthCm ?? null;
    doc.bodyCondition = input.bodyCondition ?? null;
    doc.notes = input.notes ?? null;
  },
  async validate(ctx, input: CreateWeightInput, existing) {
    const animal = existing
      ? await Animal.findOne({ _id: existing.animalId, farmId: ctx.access.farm._id })
      : await requireFarmAnimal(ctx.access, input.animalId);
    if (!animal) throw notFound('Animal not found');
    const date = toDate(input.weighedOn);
    if (animal.birthDate && date < animal.birthDate)
      throw invalid('weighedOn', 'The animal was not born yet on this date');
    // Species-specific plausibility — only where an administrator configured it.
    const type = await AnimalType.findById(animal.animalTypeId).select('name maxWeightKg');
    if (type?.maxWeightKg && input.weightKg > type.maxWeightKg) {
      throw invalid(
        'weightKg',
        `Above the maximum configured for ${type.name} (${type.maxWeightKg} kg). Check the value.`,
      );
    }
    const duplicate = await WeightRecord.exists({
      farmId: ctx.access.farm._id,
      animalId: animal._id,
      weighedOn: date,
      weightKg: input.weightKg,
      voided: false,
      ...(existing ? { _id: { $ne: existing._id } } : {}),
    });
    if (duplicate)
      throw conflict(
        'This animal already has the same weight recorded for that day',
        'DUPLICATE_RECORD',
      );
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
      weighedOn: day(d.weighedOn)!,
      weightKg: d.weightKg,
      method: d.method,
      ...(d.heightCm != null ? { heightCm: d.heightCm } : {}),
      ...(d.lengthCm != null ? { lengthCm: d.lengthCm } : {}),
      ...(d.bodyCondition ? { bodyCondition: d.bodyCondition } : {}),
      ...(d.notes ? { notes: d.notes } : {}),
    }));
  },
};

export async function createWeight(
  ctx: RecordContext,
  input: CreateWeightInput,
): Promise<WeightRecordDTO> {
  requireFarmPermission(ctx.access, 'records.write');
  assertFarmActive(ctx.access);
  await weightSpec.validate!(ctx, input);
  const doc = new WeightRecord({
    farmId: ctx.access.farm._id,
    animalId: input.animalId,
    createdBy: ctx.actor.userId,
    attachments: buildAttachments(input.attachments, ctx.actor, ctx.policy),
  });
  weightSpec.assign(doc, input);
  await doc.save();
  await audited(ctx, 'weight', doc, { animalId: input.animalId, weightKg: input.weightKg });
  return (await weightSpec.serialize([doc], { access: ctx.access }))[0]!;
}

export async function listWeights(
  access: FarmAccess,
  q: {
    page: number;
    pageSize: number;
    animalId?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    includeVoided: 'true' | 'false';
    sortBy: 'weighedOn' | 'weightKg' | 'createdAt';
    order: 'asc' | 'desc';
  },
): Promise<Page<WeightRecordDTO>> {
  requireFarmPermission(access, 'records.read');
  const filter: Record<string, unknown> = {
    farmId: access.farm._id,
    ...dateRange('weighedOn', q.from, q.to),
  };
  if (q.includeVoided === 'false') filter['voided'] = false;
  if (q.animalId) filter['animalId'] = q.animalId;
  const sort = { [q.sortBy]: q.order === 'asc' ? 1 : -1, _id: -1 } as Record<string, 1 | -1>;
  const [rows, total] = await Promise.all([
    WeightRecord.find(filter)
      .sort(sort)
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize),
    WeightRecord.countDocuments(filter),
  ]);
  return {
    items: rows.length ? await weightSpec.serialize(rows, { access }) : [],
    page: q.page,
    pageSize: q.pageSize,
    total,
  };
}

const round = (value: number, digits: number): number =>
  Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * Growth over time for one animal: the live (non-voided) measurements in date order, with plain arithmetic between
 * neighbours (days, kg difference, kg per day), each compared with the admin-configured criterion for the animal's
 * age (see growth-standards/evaluate.ts). Without a birth date or a criterion nothing is judged.
 */
export async function growthFor(
  access: FarmAccess,
  animalId: Types.ObjectId,
): Promise<GrowthResponse> {
  requireFarmPermission(access, 'records.read');
  const animal = await Animal.findOne({ _id: animalId, farmId: access.farm._id });
  if (!animal) throw notFound('Animal not found');
  const [type, rows, standards] = await Promise.all([
    AnimalType.findById(animal.animalTypeId).select('maxWeightKg'),
    WeightRecord.find({ farmId: access.farm._id, animalId, voided: false }).sort({
      weighedOn: 1,
      createdAt: 1,
    }),
    GrowthStandard.find({ animalTypeId: animal.animalTypeId, active: true }),
  ]);

  const points: GrowthPoint[] = rows.map((row, i) => {
    const prev = rows[i - 1];
    const { ageDays, evaluation } = evaluateMeasurement(standards, animal, {
      date: row.weighedOn,
      weightKg: row.weightKg,
      heightCm: row.heightCm,
      lengthCm: row.lengthCm,
    });
    const point: GrowthPoint = {
      id: String(row._id),
      date: day(row.weighedOn)!,
      weightKg: row.weightKg,
      ...(row.heightCm != null ? { heightCm: row.heightCm } : {}),
      ...(row.lengthCm != null ? { lengthCm: row.lengthCm } : {}),
      ...(row.bodyCondition ? { bodyCondition: row.bodyCondition } : {}),
      ...(ageDays !== undefined ? { ageDays } : {}),
      evaluation,
    };
    if (prev) {
      const days = Math.round((row.weighedOn.getTime() - prev.weighedOn.getTime()) / DAY_MS);
      point.daysSincePrevious = days;
      point.changeKg = round(row.weightKg - prev.weightKg, 2);
      if (days > 0) point.gainKgPerDay = round((row.weightKg - prev.weightKg) / days, 3);
    }
    return point;
  });
  const first = rows[0];
  const last = rows[rows.length - 1];
  const spanDays =
    first && last ? Math.round((last.weighedOn.getTime() - first.weighedOn.getTime()) / DAY_MS) : 0;
  const latest = points[points.length - 1];
  const alerts: GrowthAlert[] = latest
    ? Object.entries(latest.evaluation.metrics)
        .filter(([, m]) => m.status !== 'within')
        .map(([name, m]) => ({
          code: m.status === 'below' ? 'LATEST_BELOW_STANDARD' : 'LATEST_ABOVE_STANDARD',
          metric: name as GrowthAlert['metric'],
          date: latest.date,
          value: m.value,
          ...(m.min !== undefined ? { min: m.min } : {}),
          ...(m.max !== undefined ? { max: m.max } : {}),
          ageEstimated: latest.evaluation.ageEstimated,
        }))
    : [];
  const now = new Date();
  const todayAge = ageInDays(animal, now);
  const breeding = ageWindow(standards, animal, 'breeding_age', now);
  const sale = ageWindow(standards, animal, 'sale_age', now);
  return {
    animal: {
      id: String(animal._id),
      animalCode: animal.animalCode,
      ...(animal.name ? { name: animal.name } : {}),
    },
    age: {
      ...(animal.birthDate ? { birthDate: day(animal.birthDate)! } : {}),
      estimated: Boolean(animal.birthDateEstimated),
      ...(todayAge !== undefined ? { days: todayAge } : {}),
    },
    points,
    summary: {
      count: rows.length,
      ...(first && last
        ? {
            firstDate: day(first.weighedOn)!,
            latestDate: day(last.weighedOn)!,
            firstKg: first.weightKg,
            latestKg: last.weightKg,
            ...(rows.length > 1 ? { totalChangeKg: round(last.weightKg - first.weightKg, 2) } : {}),
            ...(spanDays > 0
              ? { averageGainKgPerDay: round((last.weightKg - first.weightKg) / spanDays, 3) }
              : {}),
          }
        : {}),
    },
    maxWeightKg: type?.maxWeightKg ?? null,
    standards: await toGrowthStandardDTOs(applicable(standards, animal, 'weight_for_age')),
    windows: { ...(breeding ? { breeding } : {}), ...(sale ? { sale } : {}) },
    alerts,
  };
}
