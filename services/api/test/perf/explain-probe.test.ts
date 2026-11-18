/* eslint-disable @typescript-eslint/no-explicit-any -- explain() output is inspected loosely in this probe */
/**
 * Query-plan probe (runs only with PERF_PROBE=1):
 *
 *   cd services/api && PERF_PROBE=1 PERF_OUT=/tmp/explain.json npx vitest run test/perf/explain-probe.test.ts
 *
 * Builds the declared indexes (connectDb → syncIndexes), inserts raw documents at volume and runs
 * explain('executionStats') on the exact filter/sort/collation shapes the list services use, to show whether the
 * sort comes from an index or from a blocking in-memory SORT stage, and how many keys/documents are examined.
 */
import { writeFileSync } from 'node:fs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { describe, it } from 'vitest';
import { connectDb, disconnectDb } from '../../src/db/connect';
import {
  Animal,
  BreedingRecord,
  FeedingRecord,
  HealthRecord,
  Listing,
  Message,
  Order,
  WeightRecord,
} from '../../src/models';

const N = Number(process.env.PERF_EXPLAIN_DOCS ?? 5000);
const ANIMAL_COLLATION = { locale: 'en', strength: 2, numericOrdering: true };

/** "LIMIT > SORT > FETCH > IXSCAN {farmId_1_createdAt_-1}" */
function planShape(stage: any): string {
  const parts: string[] = [];
  for (let s = stage; s; s = s.inputStage ?? s.inputStages?.[0]) {
    parts.push(s.stage === 'IXSCAN' ? `IXSCAN {${s.indexName}}` : s.stage);
  }
  return parts.join(' > ');
}

function summarize(name: string, explained: any) {
  // find() explain has queryPlanner/executionStats at the top; aggregate() nests them under stages[0].$cursor.
  const root = explained.queryPlanner ? explained : explained.stages?.[0]?.$cursor;
  const winning = root.queryPlanner.winningPlan.queryPlan ?? root.queryPlanner.winningPlan;
  const exec = root.executionStats;
  const shape = planShape(winning);
  return {
    query: name,
    plan: shape,
    inMemorySort: /\bSORT\b/.test(shape),
    collScan: /COLLSCAN/.test(shape),
    nReturned: exec.nReturned,
    totalKeysExamined: exec.totalKeysExamined,
    totalDocsExamined: exec.totalDocsExamined,
    executionTimeMillis: exec.executionTimeMillis,
  };
}

describe.runIf(process.env.PERF_PROBE === '1')('query plan probe', () => {
  it('explains the hot list queries', { timeout: 1_800_000 }, async () => {
    const mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 180_000 } });
    await connectDb(mongo.getUri('farmplus_explain'));
    const farmId = new Types.ObjectId();
    const otherFarm = new Types.ObjectId();
    const typeId = new Types.ObjectId();
    const t = (i: number) => new Date(Date.UTC(2025, 0, 1) + i * 3_600_000);
    const raw = (
      m: { collection: { insertMany: (d: object[]) => Promise<unknown> } },
      docs: object[],
    ) => m.collection.insertMany(docs);

    const animals = Array.from({ length: N * 2 }, (_, i) => ({
      _id: new Types.ObjectId(),
      farmId: i % 2 ? farmId : otherFarm,
      animalCode: `A-${i}`,
      name: `Animal ${i}`,
      animalTypeId: typeId,
      sex: i % 3 ? 'female' : 'male',
      currentStatus: 'active',
      archivedAt: i % 10 === 0 ? t(i) : null,
      createdAt: t(i),
    }));
    await raw(Animal, animals);
    const animalIds = animals.filter((a) => a.farmId === farmId).map((a) => a._id);
    const rec = (i: number, dateField: string) => ({
      farmId: i % 2 ? farmId : otherFarm,
      animalId: animalIds[i % animalIds.length],
      voided: i % 50 === 0,
      [dateField]: t(i),
      createdAt: t(i),
    });
    await raw(
      HealthRecord,
      Array.from({ length: N * 2 }, (_, i) => ({ ...rec(i, 'recordedOn'), type: 'checkup' })),
    );
    await raw(
      WeightRecord,
      Array.from({ length: N * 2 }, (_, i) => ({ ...rec(i, 'weighedOn'), weightKg: 300 })),
    );
    await raw(
      FeedingRecord,
      Array.from({ length: N * 2 }, (_, i) => ({ ...rec(i, 'date'), kind: 'ration' })),
    );
    await raw(
      BreedingRecord,
      Array.from({ length: N * 2 }, (_, i) => ({
        ...rec(i, 'breedingDate'),
        damId: animalIds[i % animalIds.length],
      })),
    );
    await raw(
      Order,
      Array.from({ length: N }, (_, i) => ({
        orderNo: `O-${i}`,
        farmId: i % 2 ? farmId : otherFarm,
        buyerId: new Types.ObjectId(),
        status: ['PENDING_PAYMENT', 'PAID', 'COMPLETED'][i % 3],
        createdAt: t(i),
      })),
    );
    await raw(
      Listing,
      Array.from({ length: N }, (_, i) => ({
        farmId: i % 2 ? farmId : otherFarm,
        animalId: new Types.ObjectId(), // one open listing per animal (unique partial index)
        status: ['ACTIVE', 'SOLD', 'DRAFT'][i % 3],
        createdAt: t(i),
      })),
    );
    const conversations = Array.from({ length: 40 }, () => new Types.ObjectId());
    await raw(
      Message,
      Array.from({ length: N * 4 }, (_, i) => ({
        conversationId: conversations[i % conversations.length],
        seq: i,
        side: i % 2 ? 'buyer' : 'seller',
        senderId: new Types.ObjectId(),
        readAt: i % 100 === 0 ? null : t(i),
        createdAt: t(i),
      })),
    );

    const page = { limit: 20 };
    const rows = [
      summarize(
        'animals default: {farmId, archivedAt:null} sort {createdAt:-1,_id:1} collation',
        await Animal.find({ farmId, archivedAt: null })
          .collation(ANIMAL_COLLATION)
          .sort({ createdAt: -1, _id: 1 })
          .limit(page.limit)
          .explain('executionStats'),
      ),
      summarize(
        'animals by code: {farmId, archivedAt:null} sort {animalCode:1,_id:1} collation',
        await Animal.find({ farmId, archivedAt: null })
          .collation(ANIMAL_COLLATION)
          .sort({ animalCode: 1, _id: 1 })
          .limit(page.limit)
          .explain('executionStats'),
      ),
      summarize(
        'health default: {farmId, voided:false} sort {recordedOn:-1,_id:-1}',
        await HealthRecord.find({ farmId, voided: false })
          .sort({ recordedOn: -1, _id: -1 })
          .limit(page.limit)
          .explain('executionStats'),
      ),
      summarize(
        'weights default: {farmId, voided:false} sort {weighedOn:-1,_id:-1}',
        await WeightRecord.find({ farmId, voided: false })
          .sort({ weighedOn: -1, _id: -1 })
          .limit(page.limit)
          .explain('executionStats'),
      ),
      summarize(
        'feeding default: {farmId, voided:false} sort {date:-1,_id:-1}',
        await FeedingRecord.find({ farmId, voided: false })
          .sort({ date: -1, _id: -1 })
          .limit(page.limit)
          .explain('executionStats'),
      ),
      summarize(
        'breeding default: {farmId, voided:false} sort {breedingDate:-1,_id:-1}',
        await BreedingRecord.find({ farmId, voided: false })
          .sort({ breedingDate: -1, _id: -1 })
          .limit(page.limit)
          .explain('executionStats'),
      ),
      summarize(
        'seller orders, no status: {farmId} sort {createdAt:-1,_id:-1}',
        await Order.find({ $and: [{ farmId }] })
          .sort({ createdAt: -1, _id: -1 })
          .limit(page.limit + 1)
          .explain('executionStats'),
      ),
      summarize(
        'farm listings, no status: {farmId} sort {createdAt:-1,_id:-1}',
        await Listing.find({ farmId })
          .sort({ createdAt: -1, _id: -1 })
          .limit(page.limit)
          .explain('executionStats'),
      ),
      summarize(
        'chat unread badges: aggregate {conversationId $in 20, readAt:null}',
        await Message.aggregate([
          { $match: { conversationId: { $in: conversations.slice(0, 20) }, readAt: null } },
          { $group: { _id: { c: '$conversationId', side: '$side' }, n: { $sum: 1 } } },
        ]).explain('executionStats'),
      ),
    ];
    for (const r of rows)
      console.log(
        `${r.query}\n    ${r.plan}\n    returned ${r.nReturned}  keys ${r.totalKeysExamined}  docs ${r.totalDocsExamined}  ${r.executionTimeMillis} ms${r.inMemorySort ? '  [in-memory SORT]' : ''}`,
      );
    if (process.env.PERF_OUT)
      writeFileSync(
        process.env.PERF_OUT,
        `${JSON.stringify({ when: new Date().toISOString(), docs: N, rows }, null, 2)}\n`,
      );
    await disconnectDb();
    await mongo.stop();
  });
});
