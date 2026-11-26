import type { Types } from 'mongoose';
import type { HistoryEvent, HistoryEventType, Page } from '@farmplus/shared-types';
import { humanize } from '@farmplus/shared-utils';
import { thaiToday } from '@farmplus/validation';
import { notFound } from '../../lib/errors';
import {
  Animal,
  AuditLog,
  BreedingRecord,
  FarmExpense,
  FeedingRecord,
  HealthRecord,
  WeightRecord,
} from '../../models';
import { requireFarmPermission, type FarmAccess } from '../farms/farm-access';
import { animalLites, day, resolveActors, toDate } from './record-core';

const PER_SOURCE_CAP = 1000;

const AUDIT_TITLES: Record<string, string> = {
  'animal.created': 'Registered',
  'animal.updated': 'Details updated',
  'animal.archived': 'Archived',
  'animal.restored': 'Restored',
  'animal.media_added': 'File attached',
  'animal.media_removed': 'File removed',
  'breeding.offspring_linked': 'Linked as offspring of a breeding record',
  'breeding.offspring_unlinked': 'Offspring link removed (breeding record voided)',
};

interface Q {
  page: number;
  pageSize: number;
  types?: HistoryEventType[] | undefined;
  from?: string | undefined;
  to?: string | undefined;
  includeVoided: 'true' | 'false';
}

/**
 * The complete history of one animal in one timeline: profile changes (from the audit trail), breeding (as dam, sire
 * or offspring), health, feeding, weights and — only for people allowed to see money — expenses.
 * Nothing is hidden: corrected and voided records stay visible (voided ones are flagged).
 */
export async function animalHistory(
  access: FarmAccess,
  animalId: Types.ObjectId,
  q: Q,
): Promise<Page<HistoryEvent>> {
  requireFarmPermission(access, 'records.read');
  const animal = await Animal.findOne({ _id: animalId, farmId: access.farm._id });
  if (!animal) throw notFound('Animal not found');
  const farmId = access.farm._id;
  const want = (t: HistoryEventType) => !q.types || q.types.includes(t);
  const liveOnly = q.includeVoided === 'false' ? { voided: false } : {};
  const events: (HistoryEvent & { sort: string })[] = [];
  const actorIds: (Types.ObjectId | string | null | undefined)[] = [];
  const pending: {
    event: HistoryEvent & { sort: string };
    actor: Types.ObjectId | string | null | undefined;
  }[] = [];
  const push = (
    event: HistoryEvent,
    sortKey: string,
    actor: Types.ObjectId | string | null | undefined,
  ) => {
    actorIds.push(actor);
    pending.push({ event: { ...event, sort: sortKey }, actor });
  };

  const range = (field: string) =>
    q.from || q.to
      ? {
          [field]: {
            ...(q.from ? { $gte: toDate(q.from) } : {}),
            ...(q.to ? { $lte: toDate(q.to) } : {}),
          },
        }
      : {};
  if (want('animal')) {
    const rows = await AuditLog.find({
      targetType: 'animal',
      targetId: String(animalId),
      action: { $in: Object.keys(AUDIT_TITLES) },
    })
      .sort({ createdAt: -1 })
      .limit(PER_SOURCE_CAP);
    for (const r of rows) {
      const fields = Array.isArray(r.metadata?.['fields'])
        ? (r.metadata!['fields'] as string[]).join(', ')
        : undefined;
      push(
        {
          key: `animal:${r._id}`,
          type: 'animal',
          date: r.createdAt.toISOString(),
          title: AUDIT_TITLES[r.action]!,
          ...(fields ? { summary: `Changed: ${fields}` } : {}),
          detail: {
            kind: 'audit',
            action: r.action,
            ...(Array.isArray(r.metadata?.['fields'])
              ? { fields: r.metadata!['fields'] as string[] }
              : {}),
          },
        },
        r.createdAt.toISOString(),
        r.actorId,
      );
    }
  }

  // Breeding is its own permission: a member without breeding.read sees the rest of the timeline only.
  if (want('breeding') && access.permissions.has('breeding.read')) {
    const rows = await BreedingRecord.find({
      farmId,
      ...liveOnly,
      $or: [{ damId: animalId }, { sireId: animalId }, { 'delivery.offspring.animalId': animalId }],
    }).limit(PER_SOURCE_CAP);
    const lites = await animalLites(
      farmId,
      rows.flatMap((r) => [r.damId, r.sireId]),
    );
    const code = (id: Types.ObjectId | null | undefined) =>
      id ? (lites.get(String(id))?.animalCode ?? '?') : undefined;
    for (const r of rows) {
      const isDam = String(r.damId) === String(animalId);
      const isSire = r.sireId && String(r.sireId) === String(animalId);
      const base = {
        type: 'breeding' as const,
        recordId: String(r._id),
        ...(r.voided ? { voided: true } : {}),
      };
      if (isDam || isSire) {
        const partner = isDam
          ? r.sireId
            ? `sire ${code(r.sireId)}`
            : r.sireExternal?.name
              ? `sire ${r.sireExternal.name}`
              : 'sire not recorded'
          : `dam ${code(r.damId)}`;
        push(
          {
            ...base,
            key: `breeding:${r._id}`,
            date: day(r.breedingDate)!,
            title: `Breeding (${humanize(r.method)})`,
            summary: `${partner} · ${humanize(r.status)}`,
            detail: {
              kind: 'breeding',
              method: r.method,
              status: r.status,
              partner: isDam
                ? {
                    role: 'sire',
                    ...(r.sireId
                      ? { code: code(r.sireId) }
                      : r.sireExternal?.name
                        ? { name: r.sireExternal.name }
                        : {}),
                  }
                : { role: 'dam', ...(r.damId ? { code: code(r.damId) } : {}) },
            },
            role: isDam ? 'dam' : 'sire',
          },
          `${day(r.breedingDate)}T00:00:00.000Z`,
          r.createdBy,
        );
        if (isDam && r.delivery)
          push(
            {
              ...base,
              key: `breeding:${r._id}:delivery`,
              date: day(r.delivery.date)!,
              title: `Delivery (${r.delivery.offspring.length} recorded)`,
              detail: { kind: 'delivery', offspring: r.delivery.offspring.length },
              role: 'dam',
            },
            `${day(r.delivery.date)}T00:00:00.000Z`,
            r.createdBy,
          );
        if (isDam && r.failedOn)
          push(
            {
              ...base,
              key: `breeding:${r._id}:failed`,
              date: day(r.failedOn)!,
              title: 'Breeding did not result in a birth',
              ...(r.failureReason ? { summary: r.failureReason } : {}),
              detail: {
                kind: 'breedingFailed',
                ...(r.failureReason ? { reason: r.failureReason } : {}),
              },
              role: 'dam',
            },
            `${day(r.failedOn)}T00:00:00.000Z`,
            r.createdBy,
          );
      }
      if (
        r.delivery?.offspring.some((o) => o.animalId && String(o.animalId) === String(animalId))
      ) {
        push(
          {
            ...base,
            key: `breeding:${r._id}:birth`,
            date: day(r.delivery.date)!,
            title: 'Born',
            summary: `dam ${code(r.damId)}${r.sireId ? ` · sire ${code(r.sireId)}` : ''}`,
            detail: {
              kind: 'born',
              ...(r.damId ? { damCode: code(r.damId) } : {}),
              ...(r.sireId ? { sireCode: code(r.sireId) } : {}),
            },
            role: 'offspring',
          },
          `${day(r.delivery.date)}T00:00:00.000Z`,
          r.createdBy,
        );
      }
    }
  }

  if (want('health')) {
    for (const r of await HealthRecord.find({
      farmId,
      animalId,
      ...liveOnly,
      ...range('recordedOn'),
    }).limit(PER_SOURCE_CAP)) {
      const bits = [
        r.condition && `${r.condition} (stated by ${r.conditionStatedBy})`,
        r.medication?.name && `medication: ${r.medication.name}`,
        r.vaccine?.name && `vaccine: ${r.vaccine.name}`,
      ].filter(Boolean);
      push(
        {
          key: `health:${r._id}`,
          type: 'health',
          date: day(r.recordedOn)!,
          title: `${humanize(r.type)}: ${r.title}`,
          ...(bits.length ? { summary: bits.join(' · ') } : {}),
          detail: {
            kind: 'health',
            healthType: r.type,
            title: r.title,
            ...(r.condition ? { condition: r.condition } : {}),
            ...(r.condition && r.conditionStatedBy ? { statedBy: r.conditionStatedBy } : {}),
            ...(r.medication?.name ? { medication: r.medication.name } : {}),
            ...(r.vaccine?.name ? { vaccine: r.vaccine.name } : {}),
          },
          recordId: String(r._id),
          ...(r.voided ? { voided: true } : {}),
        },
        `${day(r.recordedOn)}T00:00:00.000Z`,
        r.createdBy,
      );
    }
  }
  if (want('feeding')) {
    for (const r of await FeedingRecord.find({
      farmId,
      animalId,
      ...liveOnly,
      ...range('date'),
    }).limit(PER_SOURCE_CAP)) {
      push(
        {
          key: `feeding:${r._id}`,
          type: 'feeding',
          date: day(r.date)!,
          title: `${r.kind === 'schedule' ? 'Feeding schedule' : 'Fed'}: ${r.feedName}`,
          summary: `${r.quantity.amount} ${r.quantity.unit}`,
          detail: {
            kind: 'feeding',
            schedule: r.kind === 'schedule',
            feedName: r.feedName,
            amount: r.quantity.amount,
            unit: r.quantity.unit,
          },
          recordId: String(r._id),
          ...(r.voided ? { voided: true } : {}),
        },
        `${day(r.date)}T00:00:00.000Z`,
        r.createdBy,
      );
    }
  }
  if (want('weight')) {
    for (const r of await WeightRecord.find({
      farmId,
      animalId,
      ...liveOnly,
      ...range('weighedOn'),
    }).limit(PER_SOURCE_CAP)) {
      push(
        {
          key: `weight:${r._id}`,
          type: 'weight',
          date: day(r.weighedOn)!,
          title: `Weighed ${r.weightKg} kg`,
          summary: humanize(r.method),
          detail: { kind: 'weight', weightKg: r.weightKg, method: r.method },
          recordId: String(r._id),
          ...(r.voided ? { voided: true } : {}),
        },
        `${day(r.weighedOn)}T00:00:00.000Z`,
        r.createdBy,
      );
    }
  }
  if (want('expense') && access.permissions.has('expenses.read')) {
    for (const r of await FarmExpense.find({
      farmId,
      animalId,
      ...liveOnly,
      ...range('expenseDate'),
    }).limit(PER_SOURCE_CAP)) {
      push(
        {
          key: `expense:${r._id}`,
          type: 'expense',
          date: day(r.expenseDate)!,
          title: `${humanize(r.category)}: ${r.description}`,
          summary: `${(r.amountMinor / 100).toFixed(2)} THB`,
          detail: {
            kind: 'expense',
            category: r.category,
            description: r.description,
            amountMinor: r.amountMinor,
          },
          recordId: String(r._id),
          ...(r.voided ? { voided: true } : {}),
        },
        `${day(r.expenseDate)}T00:00:00.000Z`,
        r.createdBy,
      );
    }
  }

  const actors = await resolveActors(actorIds);
  for (const { event, actor } of pending) {
    const by = actor ? actors.get(String(actor)) : undefined;
    // Audit events carry full timestamps, and one breeding record carries several dated events (breeding, delivery,
    // failure, birth); both are filtered per event by the same date window as the records.
    // Audit timestamps count on the Thai calendar day they happened (UTC would put 00:00–07:00 on the day before).
    const eventDay =
      event.type === 'animal' ? thaiToday(Date.parse(event.date)) : event.date.slice(0, 10);
    if (
      (event.type === 'animal' || event.type === 'breeding') &&
      ((q.from && eventDay < q.from) || (q.to && eventDay > q.to))
    )
      continue;
    events.push(by ? { ...event, by } : event);
  }
  events.sort((a, b) => (a.sort === b.sort ? (a.key < b.key ? 1 : -1) : a.sort < b.sort ? 1 : -1));
  const total = events.length;
  const items = events
    .slice((q.page - 1) * q.pageSize, q.page * q.pageSize)
    .map(({ sort: _sort, ...rest }) => rest);
  return { items, page: q.page, pageSize: q.pageSize, total };
}
