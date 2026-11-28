import { expect, test, type Page } from '@playwright/test';
import mongoose from 'mongoose';
import { languageState } from '../language';
import { authed, closeDb, grantRoles, register, signIn } from '../helpers';

/** The FARM+ assistant on /help (docs/architecture/assistant.md): search mode for guests, mocked AI for members. */
test.afterAll(closeDb);

async function db() {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env['E2E_MONGODB_URI']!);
  return mongoose.connection.db!;
}
const setAssistant = async (value: boolean) =>
  (await db())
    .collection('settings')
    .updateOne(
      { key: 'assistant.enabled' },
      { $set: { key: 'assistant.enabled', value } },
      { upsert: true },
    );

const noSidewaysScroll = async (page: Page) => {
  const w = await page.evaluate(() => ({
    vw: innerWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(w.page, JSON.stringify(w)).toBeLessThanOrEqual(w.vw);
};

test('a guest asks in Thai on a phone and gets the matching article (no AI)', async ({
  browser,
}) => {
  await setAssistant(true);
  const ctx = await browser.newContext({
    storageState: languageState('th'),
    viewport: { width: 375, height: 800 },
  });
  const page = await ctx.newPage();
  await page.goto('/help');
  const panel = page.getByRole('region', { name: 'ถามผู้ช่วย FARM+' });
  await panel.getByLabel(/คำถามเรื่องการใช้งาน/).fill('เพิ่มไก่ยังไง');
  await panel.getByRole('button', { name: 'ถาม' }).click();
  const result = panel.getByTestId('assistant-result');
  await expect(result).toContainText('เข้าสู่ระบบเพื่อรับคำตอบจากผู้ช่วย AI');
  await expect(result.getByRole('link').first()).toHaveAttribute('href', '/help/add-animal');
  await noSidewaysScroll(page);
  await result.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/help\/add-animal$/);
  await ctx.close();
});

test('a signed-in member gets a (mocked) AI answer with its source and a checked page link', async ({
  page,
  request,
}) => {
  await setAssistant(true);
  const user = await register(request, 'Assistant Asker');
  await signIn(page, user, '/help');
  const panel = page.getByRole('region', { name: 'Ask the FARM+ assistant' });
  await panel.getByLabel(/Your question/).fill('how do I add an animal');
  await panel.getByRole('button', { name: 'Ask' }).click();
  const result = panel.getByTestId('assistant-result');
  await expect(result).toContainText('[Test answer]');
  await expect(result).toContainText('comes from AI and may not be fully correct');
  await expect(result.getByRole('link', { name: 'Help centre' })).toHaveAttribute('href', '/help');
  await expect(result.getByRole('link').first()).toHaveAttribute('href', /\/help\/[a-z-]+$/);

  // Switched off by the platform: the same question gets articles only.
  await setAssistant(false);
  await panel.getByRole('button', { name: 'Ask' }).click();
  await expect(result).toContainText('AI answers are not switched on yet');
  await expect(result).not.toContainText('[Test answer]');
});

test('the farm dashboard suggests the first animal; "remind me in 7 days" keeps it away after a reload', async ({
  page,
  request,
}) => {
  const owner = await register(request, 'Tip Owner');
  await grantRoles(owner.id, ['farm_owner']);
  const farm = await request.post(`${process.env['E2E_API']}/api/v1/farms`, {
    ...authed(owner),
    data: { name: 'Tip Farm' },
  });
  expect(farm.status(), await farm.text()).toBe(201);
  const farmId = (await farm.json()).farm.id as string;
  await signIn(page, owner, `/farms/${farmId}`);
  const tips = page.getByTestId('assistant-tips');
  await expect(tips).toContainText('Add your first animal');
  await expect(tips.getByRole('link', { name: 'Add an animal' })).toHaveAttribute(
    'href',
    `/farms/${farmId}/animals/new`,
  );
  await tips.getByRole('button', { name: 'Remind me in 7 days' }).click();
  await expect(page.getByTestId('assistant-tips')).toHaveCount(0);
  const asked = page.waitForResponse((r) => r.url().includes('/api/v1/assistant/suggestions'));
  await page.reload();
  expect((await asked).status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('assistant-tips')).toHaveCount(0);
});

test('assistant action: "บันทึกน้ำหนัก A-00001 2 โล 3 ขีด วันนี้" → 2.3 kg shown → the form opens filled in → saved by the person', async ({
  page,
  request,
}) => {
  const db_ = await db();
  await db_
    .collection('settings')
    .updateOne(
      { key: 'assistant.actionsEnabled' },
      { $set: { key: 'assistant.actionsEnabled', value: true } },
      { upsert: true },
    );
  const owner = await register(request, 'Action Owner');
  await grantRoles(owner.id, ['farm_owner']);
  const API = process.env['E2E_API'];
  const farm = await request.post(`${API}/api/v1/farms`, {
    ...authed(owner),
    data: { name: 'Action Farm' },
  });
  const farmId = (await farm.json()).farm.id as string;
  const types = await (await request.get(`${API}/api/v1/animal-types`, authed(owner))).json();
  const animal = await request.post(`${API}/api/v1/farms/${farmId}/animals`, {
    ...authed(owner),
    data: {
      animalCode: 'A-00001',
      animalTypeId: types.animalTypes[0].id,
      sex: 'female',
      name: 'Bua',
    },
  });
  expect(animal.status(), await animal.text()).toBe(201);

  await signIn(page, owner, '/help');
  const box = page.getByRole('region', { name: 'Ask the assistant to do it' });
  await box.getByLabel(/What do you want to do/).fill('บันทึกน้ำหนัก A-00001 2 โล 3 ขีด วันนี้');
  await box.getByRole('button', { name: 'Do it' }).click();
  const result = box.getByTestId('assistant-act-result');
  await expect(result).toContainText('Animal: A-00001 — Bua');
  await expect(result).toContainText('Weight: 2.3 kg');
  await result.getByRole('button', { name: 'Open the filled-in form' }).click();

  await expect(page).toHaveURL(new RegExp(`/farms/${farmId}/weights/new$`));
  await expect(page.getByLabel(/^Weight \(kg\)/)).toHaveValue('2.3');
  await expect(page.getByLabel(/^Animal/)).toHaveValue((await animal.json()).animal.id);
  // Nothing was saved by the assistant: the person saves.
  const before = await db_.collection('weight_records').countDocuments({ weightKg: 2.3 });
  await page.getByRole('button', { name: 'Save weight' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^2\.3 kg on / })).toBeVisible();
  expect(await db_.collection('weight_records').countDocuments({ weightKg: 2.3 })).toBe(before + 1);
  await page.goto(`/farms/${farmId}/weights`);
  await expect(page.getByRole('table').getByText('2.3')).toBeVisible();
});
