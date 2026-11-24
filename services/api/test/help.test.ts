import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HelpFeedback } from '../src/models';
import { startHarness, type TestHarness } from './helpers';

/** `POST /api/v1/help/feedback`: public, anonymous counters for the help centre. */
let h: TestHarness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.stop();
});

const vote = (body: object) => request(h.app).post('/api/v1/help/feedback').send(body);

describe('help feedback', () => {
  it('counts anonymous votes per article and language, without signing in', async () => {
    expect((await vote({ slug: 'sign-in', locale: 'th', helpful: true })).status).toBe(204);
    expect((await vote({ slug: 'sign-in', locale: 'th', helpful: true })).status).toBe(204);
    expect((await vote({ slug: 'sign-in', locale: 'th', helpful: false })).status).toBe(204);
    expect((await vote({ slug: 'sign-in', locale: 'en', helpful: false })).status).toBe(204);
    const th = await HelpFeedback.findOne({ slug: 'sign-in', locale: 'th' }).lean();
    const en = await HelpFeedback.findOne({ slug: 'sign-in', locale: 'en' }).lean();
    expect([th?.helpful, th?.notHelpful]).toEqual([2, 1]);
    expect([en?.helpful, en?.notHelpful]).toEqual([0, 1]);
    // Nothing about the voter is stored.
    expect(Object.keys(th!).sort()).toEqual(
      ['__v', '_id', 'createdAt', 'helpful', 'locale', 'notHelpful', 'slug', 'updatedAt'].sort(),
    );
  });

  it('refuses anything that is not a plain slug / locale / yes-no', async () => {
    for (const body of [
      { slug: '../admin', locale: 'th', helpful: true },
      { slug: 'Sign In', locale: 'th', helpful: true },
      { slug: 'sign-in', locale: 'fr', helpful: true },
      { slug: 'sign-in', locale: 'th', helpful: 'yes' },
      { slug: 'sign-in', locale: 'th', helpful: true, comment: 'free text is not stored' },
      { slug: { $gt: '' }, locale: 'th', helpful: true },
    ]) {
      const res = await vote(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await HelpFeedback.countDocuments({ slug: { $ne: 'sign-in' } })).toBe(0);
  });
});
