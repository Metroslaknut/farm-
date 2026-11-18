import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  daysAgo,
  mkAnimal,
  setupFarm,
  startHarness,
  type FarmSetup,
  type Session,
  type TestHarness,
} from '../helpers';

/**
 * Regression tests for defects found in the full-system audit (records, lineage, AI assessments).
 * Each test reproduces the reported behaviour first; the fix makes it pass.
 */
let h: TestHarness;
let f: FarmSetup;
beforeAll(async () => {
  h = await startHarness();
  f = await setupFarm(h.app);
});
afterAll(async () => {
  await h.stop();
});

const call = (m: 'get' | 'post' | 'patch', s: Session, path: string, body?: object) => {
  const r = request(h.app)[m](`/api/v1/farms/${f.farmId}${path}`).set(s.auth);
  return m === 'get' ? r : r.send(body ?? {});
};

describe('AUDIT-R1: assessment cost data follows expenses.read', () => {
  it('workers and viewers never receive recorded costs or net-over-cost figures from an assessment the owner ran', async () => {
    const a = await mkAnimal(h.app, f.owner, f.farmId, {
      animalTypeId: f.buffalo,
      sex: 'female',
      birthDate: '2024-01-01',
    });
    expect(
      (
        await call('post', f.owner, '/expenses', {
          animalId: a.id,
          category: 'feed',
          expenseDate: daysAgo(3),
          amount: 1500,
          description: 'Feed',
        })
      ).status,
    ).toBe(201);
    const created = await call('post', f.owner, `/animals/${a.id}/assessments`, {
      includeAiExplanation: false,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.assessment.costSummary).not.toBeNull(); // the owner may see it
    const id = created.body.assessment.id;
    for (const who of [f.viewer, f.worker]) {
      const res = await call('get', who, `/assessments/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.assessment.costSummary).toBeNull();
      for (const p of res.body.assessment.expectedProceeds)
        expect(p.netOverRecordedCostMinor).toBeNull();
      expect(JSON.stringify(res.body)).not.toContain('150000');
    }
    // the manager (expenses.read) still sees it
    expect(
      (await call('get', f.manager, `/assessments/${id}`)).body.assessment.costSummary,
    ).not.toBeNull();
  });
});

const animal = (over: Record<string, unknown> = {}) =>
  mkAnimal(h.app, f.owner, f.farmId, { animalTypeId: f.buffalo, sex: 'female', ...over });

describe('AUDIT-R2: lineage cannot become a cycle through offspring linking', () => {
  it('refuses to link the sire’s own ancestor as an offspring of that sire', async () => {
    const g = await animal({ sex: 'male' }); // grandfather, no birth date
    const s = await animal({ sex: 'male', sireId: g.id }); // son of G
    const d = await animal({ sex: 'female' });
    const bred = await call('post', f.owner, '/breeding', {
      damId: d.id,
      sireId: s.id,
      breedingDate: daysAgo(300),
      method: 'natural',
    });
    expect(bred.status, JSON.stringify(bred.body)).toBe(201);
    const res = await call('post', f.owner, `/breeding/${bred.body.record.id}/delivery`, {
      date: daysAgo(10),
      offspring: [{ animalId: g.id }],
    });
    expect(res.status).toBe(400); // G would become S's son while S is G's son
    const lineage = await call('get', f.owner, `/animals/${g.id}`);
    expect(lineage.body.animal.sire ?? lineage.body.animal.sireId ?? null).toBeNull();
  });
});

describe('AUDIT-R3: a birth date cannot be moved after the animal’s own records or offspring', () => {
  it('refuses a birth date later than an existing weighing, and later than a child’s birth', async () => {
    const a = await animal({ birthDate: daysAgo(400) });
    expect(
      (
        await call('post', f.owner, '/weights', {
          animalId: a.id,
          weighedOn: daysAgo(300),
          weightKg: 30,
        })
      ).status,
    ).toBe(201);
    const moved = await call('patch', f.owner, `/animals/${a.id}`, { birthDate: daysAgo(200) });
    expect(moved.status).toBe(400);
    expect(moved.body.error.details[0].path).toBe('birthDate');
    expect(
      (await call('patch', f.owner, `/animals/${a.id}`, { birthDate: daysAgo(350) })).status,
    ).toBe(200); // still before the weighing: fine

    const mother = await animal({ birthDate: daysAgo(1500) });
    await animal({ damId: mother.id, birthDate: daysAgo(100) });
    expect(
      (await call('patch', f.owner, `/animals/${mother.id}`, { birthDate: daysAgo(50) })).status,
    ).toBe(400);
  });
});

describe('AUDIT-R4: breeding corrections keep the dates in order', () => {
  it('cannot move the breeding date after the pregnancy check or the failure date', async () => {
    const d = await animal({ birthDate: daysAgo(1500) });
    const bred = await call('post', f.owner, '/breeding', {
      damId: d.id,
      breedingDate: daysAgo(60),
      method: 'natural',
    });
    const id = bred.body.record.id;
    expect(
      (await call('post', f.owner, `/breeding/${id}/pregnancy`, { date: daysAgo(40) })).status,
    ).toBe(200);
    const bad = await call('post', f.owner, `/breeding/${id}/corrections`, {
      reason: 'typo fix',
      changes: { breedingDate: daysAgo(30) },
    });
    expect(bad.status).toBe(400);
    const d2 = await animal({ birthDate: daysAgo(1500) });
    const b2 = (
      await call('post', f.owner, '/breeding', {
        damId: d2.id,
        breedingDate: daysAgo(60),
        method: 'natural',
      })
    ).body.record.id;
    expect(
      (
        await call('post', f.owner, `/breeding/${b2}/failure`, {
          date: daysAgo(40),
          reason: 'returned to heat',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('post', f.owner, `/breeding/${b2}/corrections`, {
          reason: 'typo fix',
          changes: { breedingDate: daysAgo(30) },
        })
      ).status,
    ).toBe(400);
  });
});

describe('AUDIT-R5: "not in the future" uses the Thai calendar date (UTC+7), not UTC', () => {
  it('accepts today’s Thai date between 00:00 and 07:00 Bangkok time, and still refuses tomorrow', async () => {
    const { createWeightSchema, createAnimalSchema } = await import('@farmplus/validation');
    const { vi } = await import('vitest');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-13T23:30:00Z')); // 06:30 on 14 Oct in Bangkok
      const w = { animalId: 'a'.repeat(24), weightKg: 300, weighedOn: '2026-10-14' };
      expect(createWeightSchema.safeParse(w).success).toBe(true);
      expect(createWeightSchema.safeParse({ ...w, weighedOn: '2026-10-15' }).success).toBe(false);
      expect(
        createAnimalSchema.safeParse({
          animalCode: 'X-1',
          animalTypeId: 'a'.repeat(24),
          sex: 'male',
          birthDate: '2026-10-14',
        }).success,
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AUDIT-R6: archived farms are read-only for AI assessments too', () => {
  it('refuses to run an assessment on an archived farm', async () => {
    const other = await setupFarm(h.app);
    const a = await mkAnimal(h.app, other.owner, other.farmId, {
      animalTypeId: other.buffalo,
      sex: 'female',
    });
    expect(
      (
        await request(h.app)
          .post(`/api/v1/farms/${other.farmId}/archive`)
          .set(other.owner.auth)
          .send({})
      ).status,
    ).toBe(200);
    const res = await request(h.app)
      .post(`/api/v1/farms/${other.farmId}/animals/${a.id}/assessments`)
      .set(other.owner.auth)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FARM_ARCHIVED');
  });
});

describe('AUDIT-R7: records of an archived animal are read-only (as documented)', () => {
  it('refuses corrections, attachments and voids on an archived animal’s records', async () => {
    const a = await animal({ birthDate: daysAgo(400) });
    const w = (
      await call('post', f.owner, '/weights', {
        animalId: a.id,
        weighedOn: daysAgo(10),
        weightKg: 300,
      })
    ).body.record;
    expect(
      (await call('post', f.owner, `/animals/${a.id}/archive`, { reason: 'sold' })).status,
    ).toBe(200);
    for (const [path, body] of [
      [`/weights/${w.id}/corrections`, { reason: 'typo fix', changes: { weightKg: 310 } }],
      [`/weights/${w.id}/attachments`, { kind: 'photo', url: 'https://files.example.test/w.jpg' }],
      [`/weights/${w.id}/void`, { reason: 'mistake made' }],
    ] as const) {
      const res = await call('post', f.owner, path, body);
      expect(res.status, path).toBe(409);
      expect(res.body.error.code, path).toBe('ANIMAL_ARCHIVED');
    }
  });
});

describe('AUDIT-R8: the animal history date filter applies to breeding events', () => {
  it('omits breeding events outside from/to', async () => {
    const d = await animal({ birthDate: daysAgo(1500) });
    await call('post', f.owner, '/breeding', {
      damId: d.id,
      breedingDate: daysAgo(200),
      method: 'natural',
    });
    const res = await call(
      'get',
      f.owner,
      `/animals/${d.id}/history?from=${daysAgo(30)}&types=breeding`,
    );
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    const all = await call('get', f.owner, `/animals/${d.id}/history?types=breeding`);
    expect(all.body.items.length).toBeGreaterThan(0);
  });
});
