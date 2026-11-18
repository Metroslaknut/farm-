import { expect, test } from '@playwright/test';
import mongoose from 'mongoose';
import { PASSWORD, uniqueEmail } from '../helpers';
import { languageState } from '../language';

// These journeys run in Thai, the site's default language (the rest of the suite runs in English).
test.use({ storageState: languageState('th') });

let db: mongoose.Connection;
test.beforeAll(async () => {
  db = await mongoose.createConnection(process.env['E2E_MONGODB_URI']!).asPromise();
});
test.afterAll(async () => {
  await db?.close();
});

test('a visitor registers with an email in the browser and lands signed in on "My farms"', async ({
  page,
}) => {
  const email = uniqueEmail('register');
  await page.goto('/');
  await page.getByRole('link', { name: 'สมัครสมาชิก' }).click();
  await expect(page).toHaveURL(/\/farms\/register$/);
  await expect(page.getByRole('heading', { name: 'สมัครสมาชิก', level: 1 })).toBeVisible();

  await page.getByLabel('ชื่อที่แสดง').fill('ผู้สมัคร ทดสอบ');
  await page.getByRole('textbox', { name: /^อีเมล/ }).fill(email);
  await page.getByLabel(/^รหัสผ่าน/).fill(PASSWORD);
  await page.getByLabel('ยืนยันรหัสผ่าน').fill(PASSWORD);
  await page.getByRole('button', { name: 'สมัครสมาชิก', exact: true }).click();

  // Development API: no verification step, the new account is signed in at once.
  await expect(page).toHaveURL(/\/farms\/?$/);
  await expect(page.getByRole('heading', { name: 'ฟาร์มของฉัน' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'บัญชีของฉัน' })).toContainText('ผู้สมัคร ทดสอบ');

  const user = await db.collection('users').findOne({ email });
  expect(user).not.toBeNull();
  expect(user!['displayName']).toBe('ผู้สมัคร ทดสอบ');
  expect(user!['status']).toBe('active');
  expect(user!['passwordHash']).not.toContain(PASSWORD);
});

test('"ดำเนินการต่อด้วย Google" goes through the (mock) provider and comes back signed in', async ({
  page,
}) => {
  await page.goto('/farms/sign-in');
  const google = page.getByRole('button', { name: 'ดำเนินการต่อด้วย Google' });
  await expect(google).toBeVisible();
  await expect(page.getByRole('button', { name: 'ดำเนินการต่อด้วย Facebook' })).toBeVisible();
  await google.click();

  // API start → mock provider → API callback → /farms/oauth-callback?ticket=… → exchange → /farms
  await expect(page).toHaveURL(/\/farms\/?$/);
  await expect(page.getByRole('heading', { name: 'ฟาร์มของฉัน' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'บัญชีของฉัน' })).toContainText('Dev google user');
  expect(page.url()).not.toContain('ticket=');

  const user = await db.collection('users').findOne({ email: 'dev-google@example.test' });
  expect(user).not.toBeNull();
  const identity = await db
    .collection('oauth_identities')
    .findOne({ provider: 'google', userId: user!['_id'] });
  expect(identity).not.toBeNull();
});
