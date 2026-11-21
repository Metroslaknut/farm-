import { expect, test } from '@playwright/test';
import { authed, closeDb, grantRoles, newSession, register, signIn } from '../helpers';

test.afterAll(closeDb);

const api = () => process.env['E2E_API']!;

/** A farm owner (farm_owner role) with one farm, created through the API like the other specs. */
async function ownerWithFarm(
  request: Parameters<typeof register>[0],
  name: string,
  farmName: string,
) {
  const user = await register(request, name);
  await grantRoles(user.id, ['farm_owner']);
  const res = await request.post(`${api()}/api/v1/farms`, {
    ...authed(user),
    data: { name: farmName },
  });
  expect(res.status(), await res.text()).toBe(201);
  return { user, farmId: (await res.json()).farm.id as string };
}

test('the owner invites a manager; the manager accepts, sees the farm as managed; revoking closes access', async ({
  page,
  browser,
  request,
}) => {
  const { user: owner, farmId } = await ownerWithFarm(request, 'Owner Anan', 'E2E Rooster Farm');
  // The manager owns a farm of their own too: one account, both relations.
  const { user: manager } = await ownerWithFarm(request, 'Manager Manee', 'E2E Manee Farm');

  // --- Owner: Manage farm → Farm staff → invite by e-mail --------------------------------------
  await signIn(page, owner, `/farms/${farmId}`);
  const menu = page.getByRole('navigation', { name: 'My farm menu' });
  await menu.getByRole('button', { name: 'Manage farm', exact: true }).click();
  await menu.getByRole('link', { name: 'Farm staff' }).click();
  await expect(page).toHaveURL(new RegExp(`/farms/${farmId}/staff$`));
  await page.getByLabel(/Their e-mail/).fill(manager.email);
  await page.getByLabel('Role', { exact: true }).first().selectOption('manager');
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(/Invitation sent/)).toBeVisible();
  const invitations = page.getByRole('table', { name: 'Invitations and join requests' });
  await expect(invitations.getByText('Pending').locator('visible=true').first()).toBeVisible();

  // Pending: no access yet.
  expect((await request.get(`${api()}/api/v1/farms/${farmId}`, authed(manager))).status()).toBe(
    404,
  );

  // --- Manager: My invitations → Accept → lands on the farm ------------------------------------
  const m = await newSession(browser);
  await signIn(m.page, manager, '/farms/invitations');
  await expect(m.page.getByRole('heading', { name: 'My invitations' })).toBeVisible();
  await expect(m.page.getByText(/Invited as Manager/)).toBeVisible();
  await m.page.getByRole('button', { name: 'Accept' }).click();
  await expect(m.page).toHaveURL(new RegExp(`/farms/${farmId}$`));

  // My farms keeps "own" and "help run" apart.
  await m.page.goto('/farms/list');
  await expect(
    m.page
      .getByRole('region', { name: 'Farms I own' })
      .getByRole('link', { name: 'E2E Manee Farm' }),
  ).toBeVisible();
  await expect(
    m.page
      .getByRole('region', { name: 'Farms I help run' })
      .getByRole('link', { name: 'E2E Rooster Farm' }),
  ).toBeVisible();
  // A manager does not manage staff.
  await m.page.goto(`/farms/${farmId}/staff`);
  await expect(m.page.getByRole('table', { name: 'Farm staff' })).toBeVisible();
  await expect(m.page.getByRole('button', { name: 'Send invitation' })).toHaveCount(0);

  // --- Owner revokes; the manager's API calls to that farm fail at once -------------------------
  await page.reload();
  const staff = page.getByRole('table', { name: 'Farm staff' });
  await expect(staff.getByText('Manager Manee').locator('visible=true').first()).toBeVisible();
  await page.getByRole('button', { name: 'Revoke access' }).locator('visible=true').first().click();
  const revoked = page.waitForResponse(
    (r) => r.request().method() === 'DELETE' && r.url().includes(`/farms/${farmId}/members/`),
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke access' }).click();
  expect((await revoked).status()).toBe(204);
  for (const path of [`/farms/${farmId}`, `/farms/${farmId}/animals`, `/farms/${farmId}/breeding`])
    expect((await request.get(`${api()}/api/v1${path}`, authed(manager))).status(), path).toBe(404);
  await m.context.close();
});

test('chicken breeding: parents’ breeds and the suggested breed show at once; hatching registers F1 chicks', async ({
  page,
  request,
}) => {
  const { user: owner, farmId } = await ownerWithFarm(request, 'Breeder Boon', 'E2E Cock Farm');
  const types = await (await request.get(`${api()}/api/v1/animal-types`, authed(owner))).json();
  const chicken = types.animalTypes.find((t: { key: string }) => t.key === 'chicken');
  expect(chicken.breedGroups).toHaveLength(5);
  const bird = async (code: string, name: string, sex: string, breed: string) => {
    const res = await request.post(`${api()}/api/v1/farms/${farmId}/animals`, {
      ...authed(owner),
      data: {
        animalCode: code,
        name,
        animalTypeId: chicken.id,
        sex,
        breed,
        rearingType: 'fighting_cock',
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    return (await res.json()).animal.id as string;
  };
  await bird('COCK-1', 'Chao Saifa', 'male', 'pama_ma_lo');
  await bird('HEN-1', 'Mae Thongdee', 'female', 'lueang_hang_khao');

  await signIn(page, owner, `/farms/${farmId}/breeding/new`);
  await page.getByLabel(/^Dam/).selectOption({ label: 'HEN-1 — Mae Thongdee · Lueang Hang Khao' });
  await page
    .getByLabel(/Sire on this farm/)
    .selectOption({ label: 'COCK-1 — Chao Saifa · Burmese Ma Lo' });
  const preview = page.getByRole('status').filter({ hasText: 'Suggested offspring breed' });
  await expect(preview.getByText('Burmese + Thai')).toBeVisible();
  await expect(preview.getByText(/Burmese Ma Lo/)).toBeVisible();
  await page.getByLabel('Eggs laid').fill('8');
  await page.getByRole('button', { name: 'Save breeding record' }).click();
  await expect(page).toHaveURL(new RegExp(`/farms/${farmId}/breeding/[a-f0-9]{24}$`));
  await expect(page.getByText(/BR-\d{5}/).first()).toBeVisible();
  const recordId = page.url().split('/').pop()!;

  // Hatching: three chicks at once, breed pre-filled from the parents.
  await page.getByLabel('How many').fill('3');
  await page.getByRole('button', { name: 'Add several' }).click();
  const hatched = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith(`/breeding/${recordId}/delivery`),
  );
  await page.getByRole('button', { name: 'Record hatching' }).click();
  expect((await hatched).status()).toBe(201);

  const record = await (
    await request.get(`${api()}/api/v1/farms/${farmId}/breeding/${recordId}`, authed(owner))
  ).json();
  const chicks = record.record.delivery.offspring.map(
    (o: { animal: { id: string } }) => o.animal.id,
  );
  expect(chicks).toHaveLength(3);
  await page.goto(`/farms/${farmId}/animals/${chicks[0]}/lineage`);
  await expect(page.getByText('F1').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /COCK-1/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /HEN-1/ })).toBeVisible();
  await expect(page.getByText(/Burmese \+ Thai/).first()).toBeVisible();
});

test('the new farm pages fit phone and tablet widths (no sideways page scroll)', async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const { user: owner, farmId } = await ownerWithFarm(request, 'Responsive Ratana', 'E2E Fit Farm');
  const types = await (await request.get(`${api()}/api/v1/animal-types`, authed(owner))).json();
  const chicken = types.animalTypes.find((t: { key: string }) => t.key === 'chicken');
  const add = async (data: object) => {
    const res = await request.post(`${api()}/api/v1/farms/${farmId}/animals`, {
      ...authed(owner),
      data: { animalTypeId: chicken.id, rearingType: 'fighting_cock', ...data },
    });
    expect(res.status(), await res.text()).toBe(201);
    return (await res.json()).animal.id as string;
  };
  const sire = await add({ sex: 'male', breed: 'pama_ma_lo', name: 'Fit Cock' });
  const dam = await add({ sex: 'female', breed: 'lueang_hang_khao', name: 'Fit Hen' });
  const chick = await add({
    sex: 'unknown',
    breed: 'cross_burmese_thai',
    sireId: sire,
    damId: dam,
  });
  const invite = await request.post(`${api()}/api/v1/farms/${farmId}/invitations`, {
    ...authed(owner),
    data: { email: (await register(request, 'Someone Invited')).email, role: 'worker' },
  });
  expect(invite.status()).toBe(201);

  const pages: [string, RegExp | string][] = [
    [`/farms/${farmId}/staff`, 'Farm staff'],
    ['/farms/invitations', 'My invitations'],
    ['/farms/list', 'My farms'],
    [`/farms/${farmId}/animals/new`, 'Register animal'],
    [`/farms/${farmId}/breeding/new`, /breeding record/i],
    [`/farms/${farmId}/animals/${chick}/lineage`, /Pedigree/],
  ];
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 820, height: 1180 },
  ]) {
    const s = await newSession(browser);
    await s.page.setViewportSize(viewport);
    await signIn(s.page, owner);
    for (const [path, heading] of pages) {
      await s.page.goto(path);
      await expect(
        s.page.getByRole('heading', { level: 1, name: heading }),
        `${path} @${viewport.width}`,
      ).toBeVisible();
      // The app keeps a realtime connection open, so "network idle" never comes: wait for the loading texts to go.
      await expect(s.page.getByText(/^Loading/)).toHaveCount(0);
      // Optional evidence for a person to look at (E2E_SHOTS=<folder>).
      if (process.env['E2E_SHOTS'])
        await s.page.screenshot({
          path: `${process.env['E2E_SHOTS']}/${viewport.width}-${path.split('/').filter(Boolean).slice(-1)[0]}.png`,
          fullPage: true,
        });
      const overflow = await s.page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(
        overflow,
        `${path} overflows by ${overflow}px at ${viewport.width}px`,
      ).toBeLessThanOrEqual(1);
    }
    await s.context.close();
  }
});
