import type { Types } from 'mongoose';
import type { FeedingRecordDTO, Page } from '@farmplus/shared-types';
import { createFeedingSchema, thaiToday, type CreateFeedingInput } from '@farmplus/validation';
import { HttpError } from '../../lib/errors';
import { Animal, FeedingRecord, type FeedingRecordDoc } from '../../models';
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
const EDITABLE = [
  'date',
  'endDate',
  'feedName',
  'category',
  'quantity',
  'frequencyPerDay',
  'timesOfDay',
  'groupLabel',
  'notes',
] as const;
const today = () => thaiToday(); // Thai date, the same "today" the validation uses

/** Feeding LOGS (what was fed) and SCHEDULES (the routine). Quantities are what people enter; nothing is recommended. */
export const feedingSpec: RecordSpec<FeedingRecordDoc, FeedingRecordDTO> = {
  kind: 'feeding',
  model: FeedingRecord,
  permissions: { read: 'records.read', write: 'records.write', correct: 'records.correct' },
  createSchema: createFeedingSchema,
  editable: EDITABLE,
  toInput(doc) {
    const input: Record<string, unknown> = {
      kind: doc.kind,
      date: day(doc.date),
      feedName: doc.feedName,
      category: doc.category,
      quantity: doc.quantity,
    };
    if (doc.animalId) input['animalId'] = String(doc.animalId);
    if (doc.groupLabel) input['groupLabel'] = doc.groupLabel;
    if (doc.endDate) input['endDate'] = day(doc.endDate);
    if (doc.frequencyPerDay) input['frequencyPerDay'] = doc.frequencyPerDay;
    if (doc.timesOfDay?.length) input['timesOfDay'] = doc.timesOfDay;
    if (doc.notes) input['notes'] = doc.notes;
    return input;
  },
  assign(doc, input: CreateFeedingInput) {
    doc.date = toDate(input.date);
    doc.endDate = input.endDate ? toDate(input.endDate) : null;
    doc.feedName = input.feedName;
    doc.category = input.category;
    doc.quantity = input.quantity;
    doc.frequencyPerDay = input.frequencyPerDay ?? null;
    doc.timesOfDay = input.timesOfDay ?? null;
    doc.groupLabel = input.groupLabel ?? null;
    doc.notes = input.notes ?? null;
  },
  async validate(ctx, input: CreateFeedingInput, existing) {
    const animalId = existing ? existing.animalId : input.animalId;
    if (!animalId) return;
    const animal = existing
      ? await Animal.findOne({ _id: animalId, farmId: ctx.access.farm._id })
      : await requireFarmAnimal(ctx.access, String(animalId));
    if (animal?.birthDate && toDate(input.date) < animal.birthDate)
      throw invalid('date', 'The animal was not born yet on this date');
  },
  async serialize(docs) {
    const [meta, animals] = await Promise.all([
      metaFor(docs),
      animalLites(
        docs[0]?.farmId as Types.ObjectId,
        docs.map((d) => d.animalId),
      ),
    ]);
    const now = today();
    return docs.map((d) => {
      const startsBy = day(d.date)!;
      const end = d.endDate ? day(d.endDate)! : undefined;
      return {
        ...meta(d),
        ...(d.animalId
          ? {
              animal: animals.get(String(d.animalId)) ?? {
                id: String(d.animalId),
                animalCode: '?',
              },
            }
          : {}),
        ...(d.groupLabel ? { groupLabel: d.groupLabel } : {}),
        kind: d.kind,
        date: startsBy,
        ...(end ? { endDate: end } : {}),
        ...(d.kind === 'schedule'
          ? { active: !d.voided && startsBy <= now && (!end || end >= now) }
          : {}),
        feedName: d.feedName,
        category: d.category,
        quantity: d.quantity,
        ...(d.frequencyPerDay ? { frequencyPerDay: d.frequencyPerDay } : {}),
        ...(d.timesOfDay?.length ? { timesOfDay: d.timesOfDay } : {}),
        ...(d.notes ? { notes: d.notes } : {}),
      };
    });
  },
};

export async function createFeeding(
  ctx: RecordContext,
  input: CreateFeedingInput,
): Promise<FeedingRecordDTO> {
  requireFarmPermission(ctx.access, 'records.write');
  assertFarmActive(ctx.access);
  await feedingSpec.validate!(ctx, input);
  const doc = new FeedingRecord({
    farmId: ctx.access.farm._id,
    kind: input.kind,
    animalId: input.animalId ?? null,
    createdBy: ctx.actor.userId,
    attachments: buildAttachments(input.attachments, ctx.actor, ctx.policy),
  });
  feedingSpec.assign(doc, input);
  await doc.save();
  await audited(ctx, 'feeding', doc, { kind: input.kind, animalId: input.animalId ?? null });
  return (await feedingSpec.serialize([doc], { access: ctx.access }))[0]!;
}

export async function listFeeding(
  access: FarmAccess,
  q: {
    page: number;
    pageSize: number;
    animalId?: string | undefined;
    kind?: 'log' | 'schedule' | undefined;
    active?: 'true' | 'false' | undefined;
    from?: string | undefined;
    to?: string | undefined;
    includeVoided: 'true' | 'false';
    sortBy: 'date' | 'createdAt';
    order: 'asc' | 'desc';
  },
): Promise<Page<FeedingRecordDTO>> {
  requireFarmPermission(access, 'records.read');
  const filter: Record<string, unknown> = {
    farmId: access.farm._id,
    ...dateRange('date', q.from, q.to),
  };
  if (q.includeVoided === 'false') filter['voided'] = false;
  if (q.animalId) filter['animalId'] = q.animalId;
  if (q.kind) filter['kind'] = q.kind;
  if (q.active) {
    const now = toDate(today());
    const running = {
      kind: 'schedule',
      voided: false,
      date: { $lte: now },
      $or: [{ endDate: null }, { endDate: { $gte: now } }],
    };
    if (q.active === 'true') Object.assign(filter, running);
    else filter['$nor'] = [running];
  }
  const sort = { [q.sortBy]: q.order === 'asc' ? 1 : -1, _id: -1 } as Record<string, 1 | -1>;
  const [rows, total] = await Promise.all([
    FeedingRecord.find(filter)
      .sort(sort)
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize),
    FeedingRecord.countDocuments(filter),
  ]);
  return {
    items: rows.length ? await feedingSpec.serialize(rows, { access }) : [],
    page: q.page,
    pageSize: q.pageSize,
    total,
  };
}
