import { expect, test, type Page } from '@playwright/test';
import mongoose from 'mongoose';
import { languageState } from '../language';
import { closeDb, register, signIn } from '../helpers';

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
