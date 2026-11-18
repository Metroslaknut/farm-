import { expect, test } from '@playwright/test';
import { languageState } from '../language';
import mongoose from 'mongoose';
import { currentStep, totpAt } from '../../services/api/src/lib/totp';
import { authed, closeDb, grantRoles, PASSWORD, register, signIn } from '../helpers';

test.afterAll(closeDb);

const api = () => process.env['E2E_API']!;

test('reviewer approves a farm-owner registration in the admin UI and the applicant can create a persisted farm', async ({
  browser,
  page,
  request,
}) => {
  const applicant = await register(request, 'Approved Farm Owner');
  const submitted = await request.post(`${api()}/api/v1/registrations`, {
    ...authed(applicant),
    data: {
      type: 'farm_owner',
      businessName: 'Browser Approval Ranch',
      note: 'Synthetic e2e application',
    },
  });
  expect(submitted.status(), await submitted.text()).toBe(201);
  const registrationId = (await submitted.json()).registration.id as string;

  const admin = await register(request, 'Registration Reviewer');
  await grantRoles(admin.id, ['registration_admin']);
  const setup = await request.post(`${api()}/api/v1/auth/mfa/setup`, authed(admin));
  expect(setup.status(), await setup.text()).toBe(200);
  const secret = (await setup.json()).secret as string;
  const enabled = await request.post(`${api()}/api/v1/auth/mfa/enable`, {
    ...authed(admin),
    data: { code: totpAt(secret, currentStep()) },
  });
  expect(enabled.status(), await enabled.text()).toBe(200);

  await page.goto('/admin/registrations');
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.getByLabel('Email or phone').fill(admin.email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByLabel('Authenticator code or recovery code')).toBeVisible();
  await page
    .getByLabel('Authenticator code or recovery code')
    // The setup/enable step consumed the current TOTP; login requires a fresh, later step.
    .fill(totpAt(secret, currentStep() + 1));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/admin\/registrations/);
  await page.getByRole('link', { name: 'Approved Farm Owner' }).click();
  await expect(page.getByRole('heading', { name: /Approved Farm Owner/ })).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason (recorded in the audit log)').fill('Synthetic e2e approval');
  const approvalResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/api/v1/admin/registrations/${registrationId}/approve`),
  );
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
  const decision = await approvalResponse;
  expect(decision.status(), await decision.text()).toBe(200);
  await expect(page.getByText('approved', { exact: true })).toBeVisible();

  const db = mongoose.connection.db!;
  const persistedRegistration = await db
    .collection('registrations')
    .findOne({ _id: new mongoose.Types.ObjectId(registrationId) });
  expect(persistedRegistration?.status).toBe('APPROVED');
  expect(persistedRegistration?.decision?.reason).toBe('Synthetic e2e approval');
  const role = await db.collection('roles').findOne({ key: 'farm_owner' });
  expect(role).toBeTruthy();
  expect(
    await db.collection('user_roles').findOne({
      userId: new mongoose.Types.ObjectId(applicant.id),
      roleId: role!._id,
    }),
  ).toBeTruthy();

  const applicantSide = await browser.newPage({ storageState: languageState('en') });
  await signIn(applicantSide, applicant, '/farms');
  // Approved farm owner without a farm → forced into the farm setup.
  await expect(applicantSide.getByRole('heading', { name: 'Set up your farm' })).toBeVisible();
  await applicantSide.getByLabel('Farm name').fill('Approval Persisted Farm');
  await applicantSide.getByRole('button', { name: 'Next' }).click();
  await applicantSide.getByRole('button', { name: 'Next' }).click();
  await applicantSide.getByRole('button', { name: 'Save and start' }).click();
  await expect(applicantSide.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
  await expect(
    applicantSide.getByRole('combobox', { name: 'Farm', exact: true }).locator('option:checked'),
  ).toHaveText('Approval Persisted Farm');
  const createdFarm = await db.collection('farms').findOne({ name: 'Approval Persisted Farm' });
  expect(String(createdFarm?.createdBy)).toBe(applicant.id);
  await applicantSide.context().close();
});
