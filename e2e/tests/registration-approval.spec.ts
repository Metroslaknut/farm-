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

test('a farm owner applies to sell through the seller page, a reviewer approves, and the owner can then list an animal', async ({
  page,
  request,
}) => {
  const owner = await register(request, 'Would-be Seller');
  await grantRoles(owner.id, ['farm_owner']);
  const farm = await request.post(`${api()}/api/v1/farms`, {
    ...authed(owner),
    data: { name: 'Seller Application Farm' },
  });
  expect(farm.status(), await farm.text()).toBe(201);
  const farmId = (await farm.json()).farm.id as string;
  const types = await (await request.get(`${api()}/api/v1/animal-types`, authed(owner))).json();
  const buffalo =
    types.animalTypes.find((t: { key: string }) => t.key === 'buffalo') ?? types.animalTypes[0];
  const animalCode = `SELL-${Date.now().toString(36)}`;
  const animal = await request.post(`${api()}/api/v1/farms/${farmId}/animals`, {
    ...authed(owner),
    data: { animalCode, animalTypeId: buffalo.id, sex: 'female' },
  });
  expect(animal.status(), await animal.text()).toBe(201);
  const animalId = (await animal.json()).animal.id as string;

  // Not a seller yet: the listing form says so up front and points to the application page.
  await signIn(page, owner, `/farms/${farmId}/listings/new`);
  await expect(page.getByText(/Only approved sellers can list animals/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save as draft' })).toBeDisabled();
  await page.getByRole('link', { name: 'Apply to become a seller' }).click();
  await expect(page).toHaveURL(/\/farms\/seller$/);

  // Apply (seller + identity, which seller approval requires) through the UI.
  const sellerForm = page.getByRole('form', { name: 'Seller application form' });
  await sellerForm.getByLabel(/Shop or business name/).fill('Seller Application Shop');
  await sellerForm.getByRole('button', { name: 'Send seller application' }).click();
  await expect(page.getByText(/Seller application sent/)).toBeVisible();
  await expect(page.getByText('Pending', { exact: true }).first()).toBeVisible();
  const identityForm = page.getByRole('form', { name: 'Identity verification form' });
  await identityForm.getByLabel(/Details to help verify your identity/).fill('Synthetic e2e');
  await identityForm.getByRole('button', { name: 'Send identity details' }).click();
  await expect(page.getByText('Identity details sent.')).toBeVisible();

  // A reviewer (MFA-verified session through the API) approves identity, then the seller application.
  const reviewer = await register(request, 'Seller Reviewer');
  await grantRoles(reviewer.id, ['registration_admin']);
  const setup = await request.post(`${api()}/api/v1/auth/mfa/setup`, authed(reviewer));
  const secret = (await setup.json()).secret as string;
  expect(
    (
      await request.post(`${api()}/api/v1/auth/mfa/enable`, {
        ...authed(reviewer),
        data: { code: totpAt(secret, currentStep()) },
      })
    ).status(),
  ).toBe(200);
  const login = await request.post(`${api()}/api/v1/auth/login`, {
    data: { identifier: reviewer.email, password: PASSWORD },
  });
  const verified = await request.post(`${api()}/api/v1/auth/mfa/verify`, {
    data: { mfaToken: (await login.json()).mfaToken, code: totpAt(secret, currentStep() + 1) },
  });
  expect(verified.status(), await verified.text()).toBe(200);
  const reviewerAuth = {
    headers: { authorization: `Bearer ${(await verified.json()).tokens.accessToken}` },
  };
  const db = mongoose.connection.db!;
  for (const type of ['identity', 'seller']) {
    const row = await db
      .collection('registrations')
      .findOne({ userId: new mongoose.Types.ObjectId(owner.id), type, status: 'PENDING' });
    expect(row, `${type} registration`).toBeTruthy();
    const approved = await request.post(
      `${api()}/api/v1/admin/registrations/${String(row!._id)}/approve`,
      { ...reviewerAuth, data: { reason: 'Synthetic e2e approval' } },
    );
    expect(approved.status(), await approved.text()).toBe(200);
  }

  // The applicant sees the approval and can now save a listing.
  await page.reload();
  await expect(page.getByText(/You are an approved seller/)).toBeVisible();
  await page.goto(`/farms/${farmId}/listings/new`);
  await expect(page.getByText(/Only approved sellers can list animals/)).toHaveCount(0);
  await page.getByLabel('Choose from your animals').selectOption(animalId);
  await page.getByLabel('Title').fill('Approved seller buffalo');
  await page.getByLabel('Asking price (฿)').fill('50000');
  await page.getByRole('button', { name: 'Save as draft' }).click();
  await expect(page).toHaveURL(new RegExp(`/farms/${farmId}/listings/[a-f0-9]{24}$`));
  expect(
    await db
      .collection('listings')
      .findOne({ farmId: new mongoose.Types.ObjectId(farmId), title: 'Approved seller buffalo' }),
  ).toBeTruthy();
});
