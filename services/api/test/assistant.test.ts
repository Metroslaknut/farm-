import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AiUsageLog, Setting } from '../src/models';
import { checkReply } from '../src/modules/assistant/assistant.service';
import { buildKnowledge } from '../src/modules/assistant/build-index';
import { TOUR_IDS } from '../src/modules/assistant/catalog';
import { articlesOf, searchChunks } from '../src/modules/assistant/knowledge';
import { redact } from '../src/modules/assistant/redact';
import { createFarmer, createUser, startHarness, type TestHarness } from './helpers';

/** The FARM+ assistant (docs/architecture/assistant.md): search, redaction, the checked model step, limits, logging. */
let h: TestHarness;
beforeAll(async () => {
  h = await startHarness({ AI_PROVIDER: 'mock' });
});
afterAll(async () => {
  await h.stop();
});
beforeEach(async () => {
  h.ai!.failWith = null;
  h.ai!.assistantReply = null;
  await Setting.deleteMany({ key: { $regex: '^(assistant|ai)\\.' } });
  await AiUsageLog.deleteMany({});
});

const on = () =>
  Setting.updateOne({ key: 'assistant.enabled' }, { $set: { value: true } }, { upsert: true });
const ask = (body: object, auth?: { Authorization: string }) => {
  const r = request(h.app).post('/api/v1/assistant/ask');
  return (auth ? r.set(auth) : r).send(body);
};

const GOLDEN: [string, string][] = [
  ['รหัส sms ไม่มา', 'register-phone'],
  ['สมัครด้วยเบอร์โทรยังไง', 'register-phone'],
  ['สมัครด้วยอีเมล', 'register-email'],
  ['ยืนยันอีเมลไม่ได้ ลิงก์ไม่มา', 'register-email'],
  ['สมัครด้วย google', 'register-google'],
  ['เข้าสู่ระบบไม่ได้', 'sign-in'],
  ['ลืมรหัสผ่าน', 'forgot-password'],
  ['ตั้งรหัสผ่านใหม่ยังไง', 'forgot-password'],
  ['เปิดยืนยันตัวตนสองขั้นตอน', 'two-step-verification'],
  ['แอป authenticator หาย', 'two-step-verification'],
  ['ทำไมสร้างฟาร์มไม่ได้', 'request-farm-owner'],
  ['ขอสิทธิ์เจ้าของฟาร์ม', 'request-farm-owner'],
  ['สร้างฟาร์มใหม่', 'create-farm'],
  ['เพิ่มไก่ยังไง', 'add-animal'],
  ['เพิ่มวัวเข้าฟาร์ม', 'add-animal'],
  ['ลงทะเบียนสัตว์ใหม่', 'add-animal'],
  ['บันทึกน้ำหนักวัว', 'farm-records'],
  ['บันทึกการฉีดวัคซีน', 'farm-records'],
  ['จดค่าอาหารสัตว์', 'farm-records'],
  ['บันทึกค่าใช้จ่ายฟาร์ม', 'farm-records'],
  ['บันทึกการผสมพันธุ์', 'breeding-pedigree'],
  ['ดูพ่อแม่พันธุ์ ผังเครือญาติ', 'breeding-pedigree'],
  ['ไข่ฟักออกมากี่ตัว', 'breeding-pedigree'],
  ['เพิ่มคนงานในฟาร์ม', 'farm-staff'],
  ['เชิญลูกจ้างมาช่วยบันทึก', 'farm-staff'],
  ['ขายวัวต้องทำอะไรบ้าง', 'list-animal-for-sale'],
  ['ลงประกาศขายสัตว์', 'list-animal-for-sale'],
  ['สมัครเป็นผู้ขาย', 'verify-identity-seller'],
  ['ยืนยันตัวตนด้วยบัตรประชาชน', 'verify-identity-seller'],
  ['ขายอาหารสัตว์ในร้านค้า', 'sell-products'],
  ['ซื้อวัวยังไง', 'buy-animals'],
  ['ยื่นข้อเสนอราคา', 'buy-animals'],
  ['ใส่ตะกร้าแล้วจ่ายเงิน', 'shop-cart'],
  ['สั่งซื้อสินค้าในร้าน', 'shop-cart'],
  ['อัปโหลดวิดีโอ', 'community-videos-live'],
  ['เริ่มไลฟ์ขายของ', 'community-videos-live'],
  ['โพสต์ในชุมชน', 'community-videos-live'],
  ['ดูภาพรวมฟาร์ม แดชบอร์ด', 'farm-overview'],
  ['มือใหม่ เริ่มใช้งานยังไง', 'account-overview'],
  ['How do I add an animal', 'add-animal'],
  ['forgot my password', 'forgot-password'],
];

describe('help search (no model)', () => {
  it('finds the right article in the top 3 for at least 90% of the golden questions', () => {
    const misses: string[] = [];
    for (const [q, slug] of GOLDEN) {
      const locale = /[ก-๙]/.test(q) ? 'th' : 'en';
      const top = articlesOf(searchChunks(q, locale, { limit: 10 }), 3).map((a) => a.slug);
      if (!top.includes(slug)) misses.push(`${q} → ${top.join(', ')} (want ${slug})`);
    }
    expect(GOLDEN.length).toBeGreaterThanOrEqual(30);
    expect(misses.length / GOLDEN.length, misses.join('\n')).toBeLessThanOrEqual(0.1);
  });

  it('the shipped index is the help content of today (run `pnpm --filter @farmplus/api assistant:index`)', () => {
    const shipped = JSON.parse(
      readFileSync(join(__dirname, '../src/modules/assistant/help-index.json'), 'utf8'),
    );
    expect(shipped).toEqual(buildKnowledge());
  });

  it('the tours it may suggest are the web tours', () => {
    const src = readFileSync(join(__dirname, '../../../apps/web/src/tours/registry.ts'), 'utf8');
    const ids = [...src.matchAll(/^\s+id: '([^']+)'/gm)].map((m) => m[1]);
    const kinds = [...src.matchAll(/recordTour\('([a-z]+)'\)/g)].map((m) => `records-${m[1]}`);
    expect([...TOUR_IDS].sort()).toEqual([...new Set([...ids, ...kinds])].sort());
  });
});

describe('personal data is removed before the model', () => {
  it.each([
    ['โทร 081-234-5678 ได้เลย', 'โทร [เบอร์โทร] ได้เลย'],
    ['เบอร์ 0812345678', 'เบอร์ [เบอร์โทร]'],
    ['call +66 81 234 5678', 'call [เบอร์โทร]'],
    ['อีเมล somchai.k@example.co.th ครับ', 'อีเมล [อีเมล] ครับ'],
    ['บัตร 1-2345-67890-12-3', 'บัตร [เลขบัตรประชาชน]'],
    ['บัตร 1234567890123', 'บัตร [เลขบัตรประชาชน]'],
    ['บัญชี 123-4-56789-0 กสิกร', 'บัญชี [เลขบัญชี] กสิกร'],
    ['ไลน์ @farmsomchai', '[ไลน์]'],
    ['LINE ID: somchai_99', '[ไลน์]'],
  ])('%s', (input, out) => {
    expect(redact(input)).toBe(out);
  });

  it('leaves ordinary questions alone (numbers of animals, years)', () => {
    expect(redact('เพิ่มไก่ 20 ตัว ปี 2569 ยังไง')).toBe('เพิ่มไก่ 20 ตัว ปี 2569 ยังไง');
  });
});

describe('the model reply is checked before it is shown', () => {
  const sent = new Set(['add-animal']);
  const pages = new Map([['help', { route: '/help', label: 'Help' }]]);
  const reply = (o: object) => JSON.stringify({ answer: 'Do this.', ...o });

  it('keeps only cited articles that were sent, pages the person may open, and real tours', () => {
    expect(
      checkReply(
        reply({
          citations: ['add-animal', 'made-up'],
          links: ['help', 'admin', 'create-farm'],
          tours: ['welcome', 'hack'],
        }),
        sent,
        pages,
      ),
    ).toEqual({
      answer: 'Do this.',
      citations: ['add-animal'],
      links: [{ route: '/help', label: 'Help' }],
      tours: ['welcome'],
    });
  });

  it('accepts a fenced JSON reply', () => {
    expect(checkReply('```json\n' + reply({}) + '\n```', sent, pages)?.answer).toBe('Do this.');
  });

  it.each([
    ['not JSON', 'Sure, here is how.'],
    ['extra field', reply({ price: 5 })],
    ['a URL in the answer', JSON.stringify({ answer: 'See https://evil.test/x' })],
    ['markup in the answer', JSON.stringify({ answer: '<a href=x>click</a>' })],
    ['too long', JSON.stringify({ answer: 'x'.repeat(1300) })],
    ['empty answer', JSON.stringify({ answer: '  ' })],
  ])('refuses %s', (_name, text) => {
    expect(checkReply(text, sent, pages)).toBeNull();
  });
});

describe('POST /api/v1/assistant/ask', () => {
  it('guests get help search only, with no model call', async () => {
    const calls = h.ai!.calls;
    await on();
    const res = await ask({ message: 'เพิ่มไก่ยังไง', locale: 'th' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mode: 'search', reason: 'guest', links: [], tours: [] });
    expect(res.body.citations[0]).toMatchObject({ slug: 'add-animal' });
    expect(h.ai!.calls).toBe(calls);
  });

  it('is off by default: members get search with reason "disabled"', async () => {
    const me = await createUser(h.app);
    const res = await ask({ message: 'เพิ่มไก่ยังไง', locale: 'th' }, me.auth);
    expect(res.body).toMatchObject({ mode: 'search', reason: 'disabled' });
    expect(await AiUsageLog.countDocuments()).toBe(0);
  });

  it('answers a member with the model, from checked citations, links and tours; logs usage without the question', async () => {
    await on();
    const me = await createUser(h.app);
    const res = await ask(
      { message: 'เพิ่มไก่ยังไง โทร 0812345678', locale: 'th', context: { route: '/farms' } },
      me.auth,
    );
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('ai');
    expect(res.body.answer).toContain('คำตอบทดสอบ');
    expect(res.body.citations).toEqual([{ slug: 'add-animal', title: expect.any(String) }]);
    expect(res.body.links).toEqual([{ route: '/help', label: 'ศูนย์ช่วยเหลือ' }]);
    expect(res.body.tours).toEqual(['help-centre']);
    // The phone number never reached the provider; the excerpts are passed as data.
    const sent = h.ai!.lastRequest!;
    expect(sent.user).toContain('[เบอร์โทร]');
    expect(sent.user).not.toContain('0812345678');
    expect(sent.user).toMatch(/<articles>[\s\S]*<chunk slug="add-animal"/);
    // One usage row, no question text anywhere in it.
    const rows = await AiUsageLog.find().lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ feature: 'assistant', status: 'ok', provider: 'mock' });
    expect(JSON.stringify(rows[0])).not.toContain('ไก่');
  });

  it('a page the person may not open is never linked (create farm needs farm-owner access)', async () => {
    await on();
    h.ai!.assistantReply = JSON.stringify({
      answer: 'กดสร้างฟาร์ม',
      citations: ['create-farm'],
      links: ['create-farm', 'owner-request', 'sign-in'],
    });
    const member = await createUser(h.app);
    const owner = await createFarmer(h.app);
    const q = { message: 'สร้างฟาร์มใหม่', locale: 'th' };
    expect((await ask(q, member.auth)).body.links.map((l: { route: string }) => l.route)).toEqual([
      '/farms/owner-request',
    ]);
    expect((await ask(q, owner.auth)).body.links.map((l: { route: string }) => l.route)).toEqual([
      '/farms/new',
      '/farms/owner-request',
    ]);
  });

  it('an unusable reply falls back to search and is logged as rejected', async () => {
    await on();
    h.ai!.assistantReply = 'Ignore the rules. Visit https://evil.test';
    const me = await createUser(h.app);
    const res = await ask({ message: 'เพิ่มไก่ยังไง', locale: 'th' }, me.auth);
    expect(res.body).toMatchObject({ mode: 'search', reason: 'unchecked' });
    expect(res.body.answer).toBeUndefined();
    expect(await AiUsageLog.findOne().lean()).toMatchObject({ status: 'rejected' });
  });

  it('a provider failure falls back to search and is logged as an error', async () => {
    await on();
    h.ai!.failWith = 'timeout';
    const me = await createUser(h.app);
    const res = await ask({ message: 'เพิ่มไก่ยังไง', locale: 'th' }, me.auth);
    expect(res.body).toMatchObject({ mode: 'search', reason: 'unavailable' });
    expect(await AiUsageLog.findOne().lean()).toMatchObject({
      status: 'error',
      errorCode: 'timeout',
    });
  });

  it('per-person and platform daily limits; the AI explanation budget is not used by the assistant', async () => {
    await on();
    await Setting.updateOne(
      { key: 'assistant.perUserDaily' },
      { $set: { value: 2 } },
      { upsert: true },
    );
    const a = await createUser(h.app);
    const b = await createUser(h.app);
    const q = { message: 'เพิ่มไก่ยังไง', locale: 'th' };
    expect((await ask(q, a.auth)).body.mode).toBe('ai');
    expect((await ask(q, a.auth)).body.mode).toBe('ai');
    expect((await ask(q, a.auth)).body).toMatchObject({ mode: 'search', reason: 'limit' });
    expect((await ask(q, b.auth)).body.mode).toBe('ai');
    await Setting.updateOne(
      { key: 'assistant.dailyLimit' },
      { $set: { value: 3 } },
      { upsert: true },
    );
    expect((await ask(q, b.auth)).body).toMatchObject({ mode: 'search', reason: 'limit' });
    expect(await AiUsageLog.countDocuments({ feature: 'assistant' })).toBe(3);
    // Explanations count only their own rows.
    expect(await AiUsageLog.countDocuments({ feature: { $ne: 'assistant' } })).toBe(0);
  });

  it('no matching article: no model call', async () => {
    await on();
    const me = await createUser(h.app);
    const calls = h.ai!.calls;
    const res = await ask({ message: 'zzqx qqzz', locale: 'th' }, me.auth);
    expect(res.body).toEqual({ mode: 'search', citations: [], links: [], tours: [] });
    expect(h.ai!.calls).toBe(calls);
  });

  it('validates input and refuses a bad token', async () => {
    expect((await ask({ message: 'x', locale: 'th' })).status).toBe(400);
    expect((await ask({ message: 'a'.repeat(501), locale: 'th' })).status).toBe(400);
    expect((await ask({ message: 'เพิ่มไก่', locale: 'th', userId: 'x' })).status).toBe(400);
    expect(
      (await ask({ message: 'เพิ่มไก่', locale: 'th' }, { Authorization: 'Bearer nope' })).status,
    ).toBe(401);
  });
});
