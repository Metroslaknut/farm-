import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import mongoose from 'mongoose';
import { currentStep, totpAt } from '../../services/api/src/lib/totp';

/**
 * Takes every picture the help articles reference (`img:<id>` in apps/web/src/help/content), for the project's
 * language and width. Each article is one scene: it walks the real page and shoots the screen at each step, with the
 * thing to press outlined and numbered (an overlay injected only while shooting — the app has no such styles).
 * All data is made up: "[ตัวอย่าง] …" names, @example.com addresses, 0800000000.
 */
const ROOT = join(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'apps/web/public/help/img');
const API = () => process.env['E2E_API']!;
const LOG = () => process.env['E2E_NOTIFY_LOG']!;
const PASSWORD = 'example-password-1234';
const EXAMPLE_PHONE = '0800000000';

type Locale = 'th' | 'en';
interface Ctx {
  page: Page;
  request: APIRequestContext;
  locale: Locale;
  width: number;
  /** The text for this language. */
  L: (th: string, en: string) => string;
  /** `whole`: the full page (a drawing taller than a phone screen), not just the visible screen. */
  shot: (slug: string, id: string, target?: Locator, whole?: boolean) => Promise<void>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Database (the throw-away in-memory one global-setup started) and the console "mailbox"
// ---------------------------------------------------------------------------------------------------------------------
async function db() {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env['E2E_MONGODB_URI']!);
  return mongoose.connection.db!;
}
test.afterAll(async () => {
  if (mongoose.connection.readyState === 1) await mongoose.disconnect();
});

/** Removes an example account so a scene can register it again (the pictures always show the same example data). */
async function forget(filter: { email?: string; phone?: string }) {
  const d = await db();
  const users = await d.collection('users').find(filter).toArray();
  for (const u of users) {
    for (const c of [
      'user_roles',
      'sessions',
      'refresh_tokens',
      'verification_tokens',
      'registrations',
    ])
      await d.collection(c).deleteMany({ userId: u._id });
    await d.collection('users').deleteOne({ _id: u._id });
  }
}

/** The latest link token / code the console notifier "sent" to `to` for `template`. */
async function secretFor(to: string, template: string): Promise<string> {
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    if (existsSync(LOG())) {
      const lines = readFileSync(LOG(), 'utf8').trim().split('\n').reverse();
      const hit = lines.find((l) => l.includes(`→ ${to} (${template}):`));
      if (hit) return hit.split(': ').pop()!.trim();
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no ${template} message for ${to}`);
}

/** A verified example account (registered through the API, e-mail verified with the token from the console). */
async function verifiedUser(request: APIRequestContext, email: string, displayName: string) {
  await forget({ email });
  const reg = await request.post(`${API()}/api/v1/auth/register`, {
    data: { email, password: PASSWORD, displayName },
  });
  expect(reg.status(), await reg.text()).toBe(201);
  const token = await secretFor(email, 'verify_email');
  const ok = await request.post(`${API()}/api/v1/auth/verify/email`, { data: { token } });
  expect(ok.status(), await ok.text()).toBeLessThan(300);
  return { email, id: (await reg.json()).user.id as string };
}

async function signIn(page: Page, email: string, L: Ctx['L']) {
  await page.goto('/farms/sign-in');
  await page.getByLabel(labelled(L('อีเมลหรือเบอร์โทรศัพท์', 'Email or phone'))).fill(email);
  await page.getByLabel(labelled(L('รหัสผ่าน', 'Password'))).fill(PASSWORD);
  await page.getByRole('button', { name: L('เข้าสู่ระบบ', 'Sign in'), exact: true }).click();
  await expect(page).not.toHaveURL(/sign-in/);
}

// ---------------------------------------------------------------------------------------------------------------------
// Shooting: outline + number, viewport screenshot, WebP encoded by the browser itself (no image library)
// ---------------------------------------------------------------------------------------------------------------------
async function outline(page: Page, target: Locator, n: string) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error(`nothing to outline for step ${n}`);
  await page.evaluate(
    ({ box, n }) => {
      const pad = 6;
      const ring = document.createElement('div');
      ring.id = '__help_outline';
      Object.assign(ring.style, {
        position: 'fixed',
        left: `${box.x - pad}px`,
        top: `${box.y - pad}px`,
        width: `${box.width + pad * 2}px`,
        height: `${box.height + pad * 2}px`,
        border: '4px solid #e8590c',
        borderRadius: '10px',
        boxShadow: '0 0 0 3px #ffffff, 0 0 0 9999px rgba(0,0,0,0.18)',
        zIndex: '2147483646',
        pointerEvents: 'none',
      });
      const badge = document.createElement('div');
      badge.textContent = n;
      Object.assign(badge.style, {
        position: 'absolute',
        left: '-18px',
        top: '-18px',
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        background: '#e8590c',
        color: '#ffffff',
        font: '700 18px/32px system-ui, sans-serif',
        textAlign: 'center',
        border: '2px solid #ffffff',
      });
      ring.appendChild(badge);
      document.body.appendChild(ring);
    },
    { box, n },
  );
}

async function toWebp(page: Page, png: Buffer): Promise<Buffer> {
  const encoder = await page.context().newPage();
  try {
    const dataUrl = await encoder.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      return canvas.toDataURL('image/webp', 0.8);
    }, png.toString('base64'));
    if (!dataUrl.startsWith('data:image/webp')) throw new Error('this browser cannot encode WebP');
    return Buffer.from(dataUrl.split(',')[1]!, 'base64');
  } finally {
    await encoder.close();
  }
}

function makeShot(page: Page, locale: Locale, width: number): Ctx['shot'] {
  return async (slug, id, target, whole = false) => {
    await page.waitForLoadState('networkidle');
    if (target) await outline(page, target, id);
    // The caret and animations would make pictures differ from run to run.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const png = await page.screenshot({ animations: 'disabled', caret: 'hide', fullPage: whole });
    await page.evaluate(() => document.getElementById('__help_outline')?.remove());
    const file = join(OUT, slug, `${id}-${locale}-${width}.webp`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, await toWebp(page, png));
  };
}

/** The header link to registration: "Register" on a desktop; on a phone, the person icon (it opens sign-in). */
const registerEntry = (c: Ctx) =>
  c.width < 768
    ? c.page.locator('a.site-action[href="/farms/sign-in"]')
    : c.page.locator('a.site-register');

const signInEntry = (c: Ctx) => c.page.locator('a.site-action[href="/farms/sign-in"]');

async function openRegister(c: Ctx) {
  await c.page.goto('/farms/register');
  await expect(
    c.page.getByRole('heading', { level: 1, name: c.L('สมัครสมาชิก', 'Register') }),
  ).toBeVisible();
}
/** A form field by its label; labels of required fields end in " *". */
const labelled = (text: string) =>
  new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\*)?$`);
const field = (c: Ctx, th: string, en: string) => c.page.getByLabel(labelled(c.L(th, en)));
const button = (c: Ctx, th: string, en: string) =>
  c.page.getByRole('button', { name: c.L(th, en), exact: true });

/** Signs in through the API too: the farm data behind a scene is made with the account's own token. */
async function tokenFor(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post(`${API()}/api/v1/auth/login`, {
    data: { identifier: email, password: PASSWORD },
  });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).tokens.accessToken as string;
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** Gives an example account roles directly, as an admin decision would (farm_owner, seller). */
async function grant(userId: string, keys: string[]) {
  const d = await db();
  for (const key of keys) {
    const role = await d.collection('roles').findOne({ key });
    await d
      .collection('user_roles')
      .updateOne(
        { userId: new mongoose.Types.ObjectId(userId), roleId: role!._id },
        { $setOnInsert: { createdAt: new Date() } },
        { upsert: true },
      );
  }
}

/** Listings need a moderator's review (the default) or go live at once (for the buyer scene's example listing). */
async function requireListingReview(on: boolean) {
  await (
    await db()
  )
    .collection('settings')
    .updateOne(
      { key: 'marketplace.requireReview' },
      { $set: { key: 'marketplace.requireReview', value: on } },
      { upsert: true },
    );
}

/** An example farm owner with a farm (and, with `animals`, registered animals), signed in on the page. */
async function ownerWithFarm(
  c: Ctx,
  tag: string,
  opts: { roles?: string[]; animals?: number; signIn?: boolean } = {},
) {
  const email = `${tag}.${c.locale}${c.width}@example.com`;
  const user = await verifiedUser(c.request, email, c.L('[ตัวอย่าง] สมชาย', '[Example] Somchai'));
  await grant(user.id, opts.roles ?? ['farm_owner']);
  const token = await tokenFor(c.request, email);
  const types = await (
    await c.request.get(`${API()}/api/v1/animal-types`, { headers: bearer(token) })
  ).json();
  const type =
    types.animalTypes.find((t: { key: string }) => t.key === 'goat') ?? types.animalTypes[0];
  const farm = await c.request.post(`${API()}/api/v1/farms`, {
    headers: bearer(token),
    data: { name: c.L('[ตัวอย่าง] ฟาร์มสุขใจ', '[Example] Sukjai Farm'), animalTypeIds: [type.id] },
  });
  expect(farm.status(), await farm.text()).toBe(201);
  const farmId = (await farm.json()).farm.id as string;
  const animals: string[] = [];
  for (let i = 0; i < (opts.animals ?? 0); i++) {
    const a = await c.request.post(`${API()}/api/v1/farms/${farmId}/animals`, {
      headers: bearer(token),
      data: { animalCode: `G-00${i + 1}`, animalTypeId: type.id, sex: i % 2 ? 'male' : 'female' },
    });
    expect(a.status(), await a.text()).toBe(201);
    animals.push((await a.json()).animal.id as string);
  }
  if (opts.signIn !== false) await signIn(c.page, email, c.L);
  return { email, token, farmId, animals, userId: user.id };
}

const tour = (c: Ctx, anchor: string) =>
  c.page.locator(`[data-tour="${anchor}"]`).locator('visible=true').first();

// ---------------------------------------------------------------------------------------------------------------------
// Scenes, one per article (ids = the img:<id> of each step)
// ---------------------------------------------------------------------------------------------------------------------
const SCENES: Record<string, (c: Ctx) => Promise<void>> = {
  async 'account-overview'(c) {
    // A drawn diagram, not a screen: rendered inside the app page so it uses the app's fonts and colours.
    await c.page.goto('/');
    const box = (text: string, tone = 'var(--ds-surface)') =>
      `<div style="padding:12px 14px;border:2px solid var(--ds-primary);border-radius:12px;background:${tone};font-weight:600;text-align:center">${text}</div>`;
    const arrow = '<div style="text-align:center;font-size:22px;color:var(--ds-primary)">↓</div>';
    const narrow = c.width < 600;
    const path = (title: string, steps: string[]) =>
      `<div style="display:grid;gap:0;align-content:start"><div style="font-weight:700;text-align:center;margin-bottom:8px;color:var(--ds-primary)">${title}</div>${steps.map((x) => box(x, 'var(--ds-surface-2)')).join(arrow)}</div>`;
    const html = `
      <div class="ds-root" style="display:block;min-height:100vh;background:var(--ds-surface)">
      <div id="diagram" style="width:100%;max-width:${narrow ? 360 : 900}px;box-sizing:border-box;margin:0 auto;padding:24px 16px;font:16px/1.4 var(--ds-font-sans);color:var(--ds-text)">
        <h1 style="margin:0 0 16px;font-size:22px;text-align:center">${c.L('เส้นทางผู้ใช้ใหม่ FARM+', 'Your path as a new FARM+ user')}</h1>
        <div style="max-width:420px;margin:0 auto">
          ${box(c.L('1 สมัครสมาชิก', '1 Register'))}${arrow}
          ${box(c.L('2 ยืนยันบัญชี (อีเมล / SMS)', '2 Verify your account (email / SMS)'))}${arrow}
          ${box(c.L('3 เข้าสู่ระบบ', '3 Sign in'))}${arrow}
          <p style="text-align:center;margin:4px 0 12px;font-weight:600">${c.L('แล้วเลือกเส้นทางที่ต้องการ', 'Then choose your path')}</p>
        </div>
        <div style="display:grid;grid-template-columns:${narrow ? '1fr' : 'repeat(3, 1fr)'};gap:${narrow ? '20px' : '16px'}">
          ${path(c.L('เลี้ยงสัตว์', 'Raise animals'), [c.L('ขอสิทธิ์เจ้าของฟาร์ม', 'Request farm-owner access'), c.L('สร้างฟาร์ม', 'Create a farm'), c.L('เพิ่มสัตว์', 'Add animals')])}
          ${path(c.L('ขาย', 'Sell'), [c.L('ยืนยันตัวตน + สมัครผู้ขาย', 'Verify identity + become a seller'), c.L('ลงประกาศขาย', 'List for sale')])}
          ${path(c.L('ซื้อ', 'Buy'), [c.L('ซื้อสินค้าได้ทันที', 'Buy right away')])}
        </div>
      </div>
      </div>`;
    await c.page.evaluate((h) => {
      document.body.innerHTML = h;
    }, html);
    await c.shot('account-overview', '1', undefined, true);
  },

  async 'register-email'(c) {
    const email = 'somchai@example.com';
    await forget({ email });
    await c.page.goto('/');
    await c.shot('register-email', '1', registerEntry(c));
    await openRegister(c);
    await c.shot('register-email', '2', c.page.locator('fieldset.auth-switch'));
    await field(c, 'ชื่อที่แสดง', 'Display name').fill(
      c.L('[ตัวอย่าง] สมชาย', '[Example] Somchai'),
    );
    // ("Email" is also the name of the method tab: take the text box.)
    await c.page.getByRole('textbox', { name: c.L('อีเมล', 'Email'), exact: true }).fill(email);
    await field(c, 'รหัสผ่าน', 'Password').fill(PASSWORD);
    await field(c, 'ยืนยันรหัสผ่าน', 'Confirm password').fill(PASSWORD);
    await c.shot('register-email', '3', c.page.locator('section.auth-card form'));
    const submit = button(c, 'สมัครสมาชิก', 'Register');
    await c.shot('register-email', '4', submit);
    await submit.click();
    const check = c.page.getByRole('heading', {
      name: c.L('ตรวจสอบอีเมลของคุณ', 'Check your email'),
    });
    await expect(check).toBeVisible();
    await c.shot('register-email', '5', c.page.locator('section.auth-card'));
    await c.page.goto(`/farms/verify-email?token=${await secretFor(email, 'verify_email')}`);
    const signIn = c.page
      .getByRole('link', { name: c.L('เข้าสู่ระบบ', 'Sign in'), exact: true })
      .last();
    await expect(
      c.page.getByRole('heading', {
        name: c.L('ยืนยันอีเมลเรียบร้อยแล้ว', 'Your email is verified'),
      }),
    ).toBeVisible();
    await c.shot('register-email', '6', signIn);
  },

  async 'register-phone'(c) {
    await forget({ phone: '+66800000000' });
    await c.page.goto('/');
    await c.shot('register-phone', '1', registerEntry(c));
    await openRegister(c);
    // The method radios are visually hidden behind their styled labels: press the label, as people do.
    await c.page
      .locator('fieldset.auth-switch label', { hasText: c.L('เบอร์โทรศัพท์', 'Phone number') })
      .click();
    await c.shot('register-phone', '2', c.page.locator('fieldset.auth-switch'));
    await field(c, 'ชื่อที่แสดง', 'Display name').fill(
      c.L('[ตัวอย่าง] สมชาย', '[Example] Somchai'),
    );
    const phone = field(c, 'เบอร์โทรศัพท์มือถือ', 'Mobile number');
    await phone.fill(EXAMPLE_PHONE);
    await c.shot('register-phone', '3', phone);
    await field(c, 'รหัสผ่าน', 'Password').fill(PASSWORD);
    const confirm = field(c, 'ยืนยันรหัสผ่าน', 'Confirm password');
    await confirm.fill(PASSWORD);
    await c.shot('register-phone', '4', confirm);
    const submit = button(c, 'สมัครสมาชิก', 'Register');
    await c.shot('register-phone', '5', submit);
    await submit.click();
    const code = field(c, 'รหัสยืนยัน 6 หลัก', '6-digit verification code');
    await code.fill(await secretFor('+66800000000', 'verify_phone'));
    await c.shot('register-phone', '6', code);
    await c.shot('register-phone', '7', button(c, 'ยืนยันและเข้าสู่ระบบ', 'Verify and sign in'));
  },

  async 'register-google'(c) {
    await c.page.goto('/');
    await c.shot('register-google', '1', registerEntry(c));
    await openRegister(c);
    const google = c.page.getByRole('button', {
      name: c.L('ดำเนินการต่อด้วย Google', 'Continue with Google'),
    });
    await c.shot('register-google', '2', google);
    // The local mock provider stands in for Google (a made-up "Dev google user" account).
    await google.click();
    await expect(c.page).toHaveURL(/\/farms(\/|$)/, { timeout: 30_000 });
    await c.shot('register-google', '4');
    await c.page.context().clearCookies();
    await c.page.evaluate(() => sessionStorage.clear());
  },

  async 'sign-in'(c) {
    const email = `mfa.${c.locale}${c.width}@example.com`;
    const user = await verifiedUser(c.request, email, c.L('[ตัวอย่าง] สมชาย', '[Example] Somchai'));
    // Turn on two-step verification for this example account (through the API, as the user).
    const login = await (
      await c.request.post(`${API()}/api/v1/auth/login`, {
        data: { identifier: email, password: PASSWORD },
      })
    ).json();
    const auth = { headers: { authorization: `Bearer ${login.tokens.accessToken}` } };
    const setup = await (await c.request.post(`${API()}/api/v1/auth/mfa/setup`, auth)).json();
    await c.request.post(`${API()}/api/v1/auth/mfa/enable`, {
      ...auth,
      data: { code: totpAt(setup.secret, currentStep()) },
    });
    void user;

    await c.page.goto('/');
    await c.shot('sign-in', '1', signInEntry(c));
    await c.page.goto('/farms/sign-in');
    const id = field(c, 'อีเมลหรือเบอร์โทรศัพท์', 'Email or phone');
    await id.fill('somchai@example.com');
    await c.shot('sign-in', '2', id);
    const pw = field(c, 'รหัสผ่าน', 'Password');
    await pw.fill(PASSWORD);
    await c.shot('sign-in', '3', pw);
    const submit = button(c, 'เข้าสู่ระบบ', 'Sign in');
    await c.shot('sign-in', '4', submit);
    await id.fill(email); // the account that has two-step verification on
    await submit.click();
    const code = field(c, 'รหัสจากแอปยืนยันตัวตนหรือรหัสกู้คืน', 'Authenticator or recovery code');
    await code.fill('123456');
    await c.shot('sign-in', '5', code);
    await c.shot('sign-in', '6', button(c, 'ยืนยัน', 'Verify'));
  },

  async 'forgot-password'(c) {
    const email = `reset.${c.locale}${c.width}@example.com`;
    await verifiedUser(c.request, email, c.L('[ตัวอย่าง] สมหญิง', '[Example] Somying'));
    await c.page.goto('/farms/sign-in');
    await c.shot(
      'forgot-password',
      '1',
      c.page.getByRole('link', { name: c.L('ลืมรหัสผ่าน?', 'Forgot your password?') }),
    );
    await c.page.goto('/farms/forgot-password');
    const id = field(c, 'อีเมลหรือเบอร์โทรศัพท์', 'Email or phone');
    await id.fill('somying@example.com');
    await c.shot('forgot-password', '2', id);
    const send = button(c, 'ส่งลิงก์ตั้งรหัสผ่านใหม่', 'Send a reset link');
    await c.shot('forgot-password', '3', send);
    await id.fill(email);
    await send.click();
    const sent = c.page.getByText(
      c.L(
        'ถ้ามีบัญชีนี้ เราได้ส่งลิงก์ตั้งรหัสผ่านใหม่ให้แล้ว',
        'If this account exists, we have sent it a reset link',
      ),
    );
    await expect(sent).toBeVisible();
    await c.shot('forgot-password', '4', sent);
    await c.page.goto(`/farms/reset-password?token=${await secretFor(email, 'password_reset')}`);
    const pw = field(c, 'รหัสผ่านใหม่', 'New password');
    await pw.fill('new-example-password-1');
    await c.shot('forgot-password', '5', pw);
    const confirm = field(c, 'ยืนยันรหัสผ่านใหม่', 'Confirm new password');
    await confirm.fill('new-example-password-1');
    await c.shot('forgot-password', '6', confirm);
    const save = button(c, 'บันทึกรหัสผ่านใหม่', 'Save the new password');
    await c.shot('forgot-password', '7', save);
    await save.click();
    await expect(
      c.page.getByRole('heading', {
        name: c.L('ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว', 'Your new password is saved'),
      }),
    ).toBeVisible();
    await c.shot(
      'forgot-password',
      '8',
      c.page.getByRole('link', { name: c.L('เข้าสู่ระบบ', 'Sign in'), exact: true }).last(),
    );
  },

  async 'two-step-verification'(c) {
    const email = `security.${c.locale}${c.width}@example.com`;
    await verifiedUser(c.request, email, c.L('[ตัวอย่าง] สมชาย', '[Example] Somchai'));
    await signIn(c.page, email, c.L);
    await c.page.goto('/admin/account/security');
    const title = c.page.getByRole('heading', {
      level: 1,
      name: c.L('ความปลอดภัยของบัญชี', 'Account security'),
    });
    await c.shot('two-step-verification', '2', title);
    const start = button(c, 'เริ่มตั้งค่า', 'Start setup');
    await c.shot('two-step-verification', '3', start);
    await start.click();
    const qr = c.page.getByRole('img', {
      name: c.L(
        'สแกนคิวอาร์โค้ดนี้ด้วยแอปยืนยันตัวตน',
        'Scan this QR code with your authenticator app',
      ),
    });
    await expect(qr).toBeVisible();
    await c.shot('two-step-verification', '4', qr);
    const secretLine = c.page.locator('code').first();
    await c.shot('two-step-verification', '5', secretLine);
    const secret = (await secretLine.textContent())!.trim();
    const code = field(c, 'รหัส 6 หลัก', '6-digit code');
    await code.fill(totpAt(secret, currentStep()));
    await c.shot('two-step-verification', '6', code);
    const enable = button(c, 'เปิดใช้ MFA', 'Enable MFA');
    await c.shot('two-step-verification', '7', enable);
    await enable.click();
    const codes = c.page.getByLabel(c.L('รหัสกู้คืน', 'Recovery codes'));
    await expect(codes).toBeVisible();
    await c.shot('two-step-verification', '8', codes);
  },

  async 'verify-identity-seller'(c) {
    const email = `seller.${c.locale}${c.width}@example.com`;
    await verifiedUser(c.request, email, c.L('[ตัวอย่าง] สมชาย', '[Example] Somchai'));
    await signIn(c.page, email, c.L);
    await c.page.goto('/');
    const menu = c.page.locator('button.site-profile-menu__trigger');
    await c.shot('verify-identity-seller', '1', menu);
    await menu.click();
    await c.shot(
      'verify-identity-seller',
      '2',
      c.page.getByRole('menuitem', { name: c.L('สมัครเป็นผู้ขาย', 'Become a seller') }),
    );
    await c.page.goto('/farms/seller');
    const identity = c.page.getByRole('form', {
      name: c.L('แบบฟอร์มยืนยันตัวตน', 'Identity verification form'),
    });
    const details = identity.getByLabel(
      c.L(
        'ข้อมูลเพิ่มเติมเพื่อยืนยันตัวตน (ไม่บังคับ)',
        'Details to help verify your identity (optional)',
      ),
    );
    await details.fill(
      c.L('ชื่อตามบัตรประชาชน: [ตัวอย่าง] สมชาย ใจดี', 'Name on ID card: [Example] Somchai Jaidee'),
    );
    await c.shot('verify-identity-seller', '3', details);
    await identity.getByRole('button', { name: c.L('เพิ่มเอกสาร', 'Add a document') }).click();
    await identity
      .getByLabel(c.L('ประเภทเอกสาร 1', 'Document 1 type'))
      .fill(c.L('สำเนาบัตรประชาชน', 'ID card copy'));
    await identity
      .getByLabel(c.L('ลิงก์เอกสาร 1 (https)', 'Document 1 link (https)'))
      .fill('https://files.example.com/id-card.pdf');
    await c.shot('verify-identity-seller', '4', identity.locator('.ds-grid').first());
    const sendIdentity = identity.getByRole('button', {
      name: c.L('ส่งข้อมูลยืนยันตัวตน', 'Send identity details'),
    });
    await c.shot('verify-identity-seller', '5', sendIdentity);
    const seller = c.page.getByRole('form', {
      name: c.L('แบบฟอร์มสมัครเป็นผู้ขาย', 'Seller application form'),
    });
    const shop = seller.getByLabel(
      c.L('ชื่อร้านหรือกิจการ (ไม่บังคับ)', 'Shop or business name (optional)'),
    );
    await shop.fill(c.L('[ตัวอย่าง] ฟาร์มสุขใจ', '[Example] Sukjai Farm'));
    await c.shot('verify-identity-seller', '6', shop);
    await seller
      .getByLabel(
        c.L(
          'ข้อมูลเพิ่มเติมถึงผู้ดูแล (ไม่บังคับ)',
          'Anything the reviewers should know (optional)',
        ),
      )
      .fill(c.L('ขายไก่พื้นเมืองและไข่ไก่', 'Native chickens and eggs'));
    await c.shot(
      'verify-identity-seller',
      '7',
      seller.getByRole('button', { name: c.L('เพิ่มเอกสาร', 'Add a document') }),
    );
    const send = seller.getByRole('button', {
      name: c.L('ส่งใบสมัครผู้ขาย', 'Send seller application'),
    });
    await c.shot('verify-identity-seller', '8', send);
    await send.click();
    const badge = c.page.getByText(c.L('รอดำเนินการ', 'Pending'), { exact: true }).first();
    await expect(badge).toBeVisible();
    await c.shot('verify-identity-seller', '9', badge.locator('..'));
  },

  async 'request-farm-owner'(c) {
    const email = `owner.${c.locale}${c.width}@example.com`;
    const user = await verifiedUser(c.request, email, c.L('[ตัวอย่าง] สมชาย', '[Example] Somchai'));
    await signIn(c.page, email, c.L);
    await c.page.goto('/farms/list');
    const link = c.page
      .getByRole('link', { name: c.L('ขอสิทธิ์เจ้าของฟาร์ม', 'Request farm-owner access') })
      .first();
    await expect(link).toBeVisible();
    await c.shot(
      'request-farm-owner',
      '1',
      link.locator('xpath=ancestor::*[contains(@class,"ds-card")][1]'),
    );
    await c.shot('request-farm-owner', '2', link);
    await link.click();
    const form = c.page.getByRole('form', {
      name: c.L('แบบฟอร์มขอสิทธิ์เจ้าของฟาร์ม', 'Farm-owner request form'),
    });
    const name = form.getByLabel(
      c.L('ชื่อฟาร์มหรือกิจการ (ไม่บังคับ)', 'Farm or business name (optional)'),
    );
    await name.fill(c.L('[ตัวอย่าง] ฟาร์มสุขใจ', '[Example] Sukjai Farm'));
    await c.shot('request-farm-owner', '3', name);
    const note = form.getByLabel(
      c.L('ข้อมูลเพิ่มเติมถึงผู้ดูแล (ไม่บังคับ)', 'Anything the reviewers should know (optional)'),
    );
    await note.fill(c.L('เลี้ยงไก่พื้นเมืองประมาณ 200 ตัว', 'About 200 native chickens'));
    await c.shot('request-farm-owner', '4', note);
    await form.getByRole('button', { name: c.L('เพิ่มเอกสาร', 'Add a document') }).click();
    await form
      .getByLabel(c.L('ประเภทเอกสาร 1', 'Document 1 type'))
      .fill(c.L('ทะเบียนฟาร์ม', 'Farm registration'));
    await form
      .getByLabel(c.L('ลิงก์เอกสาร 1 (https)', 'Document 1 link (https)'))
      .fill('https://files.example.com/farm.pdf');
    await c.shot('request-farm-owner', '5', form.locator('.ds-grid').first());
    const send = form.getByRole('button', { name: c.L('ส่งคำขอ', 'Send request') });
    await c.shot('request-farm-owner', '6', send);
    await send.click();
    const badge = c.page.getByText(c.L('รอดำเนินการ', 'Pending'), { exact: true }).first();
    await expect(badge).toBeVisible();
    await c.shot('request-farm-owner', '7', badge.locator('..'));
    // A reviewer approves (as the admin decision does: request APPROVED + the farm_owner role).
    const d = await db();
    const uid = new mongoose.Types.ObjectId(user.id);
    await d
      .collection('registrations')
      .updateMany({ userId: uid, type: 'farm_owner' }, { $set: { status: 'APPROVED' } });
    const role = await d.collection('roles').findOne({ key: 'farm_owner' });
    await d
      .collection('user_roles')
      .updateOne(
        { userId: uid, roleId: role!._id },
        { $setOnInsert: { createdAt: new Date() } },
        { upsert: true },
      );
    await c.page.reload();
    const create = c.page.getByRole('link', { name: c.L('สร้างฟาร์ม', 'Create a farm') });
    await c.shot('request-farm-owner', '8', create);
    await create.click();
    await expect(
      c.page.getByRole('heading', { name: c.L('ตั้งค่าฟาร์มของคุณ', 'Set up your farm') }),
    ).toBeVisible();
    await c.shot('request-farm-owner', '9', c.page.getByRole('heading', { level: 1 }));
  },
  async 'create-farm'(c) {
    const email = `farm.${c.locale}${c.width}@example.com`;
    const user = await verifiedUser(c.request, email, c.L('[ตัวอย่าง] สมชาย', '[Example] Somchai'));
    await grant(user.id, ['farm_owner']);
    await signIn(c.page, email, c.L);
    await expect(c.page).toHaveURL(/\/farms\/new/);
    await c.shot('create-farm', '1', c.page.getByRole('heading', { level: 1 }));
    const name = tour(c, 'farm-name');
    await name.fill(c.L('[ตัวอย่าง] ฟาร์มสุขใจ', '[Example] Sukjai Farm'));
    await c.shot('create-farm', '2', name);
    const types = tour(c, 'farm-animal-types');
    await types.getByRole('checkbox').first().check();
    await c.shot('create-farm', '3', types);
    const next = tour(c, 'farm-setup-submit');
    await c.shot('create-farm', '4', next);
    await next.click();
    const location = tour(c, 'farm-location');
    await expect(location).toBeVisible();
    const pick = async (th: string, en: string) => {
      const select = location.getByLabel(labelled(c.L(th, en)));
      await expect(select.locator('option').nth(1)).toBeAttached();
      await select.selectOption({ index: 1 });
    };
    await pick('จังหวัด', 'Province');
    await pick('อำเภอ/เขต', 'District');
    await pick('ตำบล/แขวง', 'Sub-district');
    await c.shot('create-farm', '5', location);
    const map = tour(c, 'farm-map-pin');
    await map.click();
    await c.shot('create-farm', '6', map);
    await next.click();
    const contact = tour(c, 'farm-contact');
    await expect(contact).toBeVisible();
    await contact.getByLabel(labelled(c.L('เบอร์โทรศัพท์', 'Phone'))).fill(EXAMPLE_PHONE);
    await c.shot('create-farm', '7', contact);
    await next.click();
    await expect(tour(c, 'farm-home-title')).toBeVisible();
    await c.shot('create-farm', '8', tour(c, 'farm-home-title'));
  },

  async 'add-animal'(c) {
    const { farmId } = await ownerWithFarm(c, 'animal', { animals: 2 });
    await c.page.goto(`/farms/${farmId}/animals`);
    const register = c.page.getByRole('link', { name: c.L('ขึ้นทะเบียนสัตว์', 'Register animal') });
    await c.shot('add-animal', '1', register);
    await register.click();
    const code = tour(c, 'animal-code');
    await c.shot('add-animal', '2', code);
    const type = tour(c, 'animal-type');
    await type.selectOption({ index: 1 });
    const breed = tour(c, 'animal-breed');
    if ((await breed.locator('option').count()) > 1) await breed.selectOption({ index: 1 });
    await c.shot('add-animal', '3', type);
    await tour(c, 'animal-sex').selectOption({ index: 1 });
    await tour(c, 'animal-first-weight').fill('32.5');
    await c.shot('add-animal', '4', tour(c, 'animal-sex'));
    await tour(c, 'animal-birth-date').fill('2026-03-01');
    await c.shot('add-animal', '5', tour(c, 'animal-birth'));
    await c.shot('add-animal', '6', tour(c, 'animal-parents'));
    const save = tour(c, 'animal-save');
    await c.shot('add-animal', '7', save);
    await save.click();
    await expect(tour(c, 'animal-info')).toBeVisible();
    await c.shot('add-animal', '8', tour(c, 'animal-actions'));
  },

  async 'farm-records'(c) {
    const { farmId, token, animals } = await ownerWithFarm(c, 'records', { animals: 1 });
    const w = await c.request.post(`${API()}/api/v1/farms/${farmId}/weights`, {
      headers: bearer(token),
      data: { animalId: animals[0], weighedOn: '2026-11-01', weightKg: 31.5 },
    });
    expect(w.status(), await w.text()).toBe(201);
    await c.page.goto(`/farms/${farmId}/weights`);
    await expect(tour(c, 'records-filters')).toBeVisible();
    await c.shot('farm-records', '1', c.page.getByRole('heading', { level: 1 }));
    const add = tour(c, 'records-add');
    await c.shot('farm-records', '2', add);
    await add.click();
    const form = c.page
      .locator('form')
      .filter({ has: c.page.getByLabel(labelled(c.L('น้ำหนัก (กก.)', 'Weight (kg)'))) });
    await form.getByLabel(labelled(c.L('สัตว์', 'Animal'))).selectOption({ index: 1 });
    await form.getByLabel(labelled(c.L('วันที่', 'Date'))).fill('2026-11-20');
    await form.getByLabel(labelled(c.L('น้ำหนัก (กก.)', 'Weight (kg)'))).fill('34');
    // The whole form is taller than a phone screen: outline the weight, the field this example fills in.
    await c.shot(
      'farm-records',
      '3',
      form.getByLabel(labelled(c.L('น้ำหนัก (กก.)', 'Weight (kg)'))),
    );
    await form.getByRole('button', { name: c.L('บันทึก', 'Save weight'), exact: true }).click();
    const voidButton = tour(c, 'record-void');
    await expect(voidButton).toBeVisible();
    await c.shot('farm-records', '5', voidButton.locator('..'));
    await c.page.goto(`/farms/${farmId}/weights`);
    await c.shot('farm-records', '4', tour(c, 'records-filters'));
    await c.shot(
      'farm-records',
      '6',
      tour(c, 'records-show-voided').locator('xpath=ancestor::label[1]'),
    );
  },

  async 'list-animal-for-sale'(c) {
    await requireListingReview(true);
    const { farmId } = await ownerWithFarm(c, 'listing', {
      roles: ['farm_owner', 'seller'],
      animals: 1,
    });
    await c.page.goto('/market/sell');
    const open = tour(c, 'market-sell-farm');
    await c.shot('list-animal-for-sale', '1', open);
    await open.click();
    await expect(c.page).toHaveURL(new RegExp(`/farms/${farmId}/listings$`));
    const create = c.page.getByRole('link', { name: c.L('ลงประกาศใหม่', 'New listing') });
    await c.shot('list-animal-for-sale', '2', create);
    await create.click();
    const animal = tour(c, 'listing-animal');
    await animal
      .getByLabel(labelled(c.L('เลือกจากสัตว์ของคุณ', 'Choose from your animals')))
      .selectOption({ index: 1 });
    await c.shot('list-animal-for-sale', '3', animal);
    const title = c.page.getByLabel(labelled(c.L('หัวข้อ', 'Title')));
    if ((await title.inputValue()) === '')
      await title.fill(c.L('[ตัวอย่าง] แพะพันธุ์ดี', '[Example] Healthy goat'));
    const price = tour(c, 'listing-price');
    await price.getByLabel(labelled(c.L('ราคาตั้งขาย (฿)', 'Asking price (฿)'))).fill('4500');
    await price
      .getByLabel(
        labelled(
          c.L(
            'ราคาต่ำสุดที่คุณยอมรับได้ (฿, ไม่เปิดเผย)',
            'Lowest offer you would consider (฿, private)',
          ),
        ),
      )
      .fill('4000');
    await c.shot('list-animal-for-sale', '4', price);
    const photos = tour(c, 'listing-photos');
    const link = photos.getByLabel(labelled(c.L('ลิงก์รูปที่ 1 (https)', 'Photo 1 link (https)')));
    if (!(await link.count()))
      await photos.getByRole('button', { name: c.L('เพิ่มรูป', 'Add photo') }).click();
    await link.fill('https://files.example.com/goat.jpg');
    const save = tour(c, 'listing-save');
    await c.shot('list-animal-for-sale', '5', photos);
    await save.click();
    const submit = c.page.getByRole('button', { name: c.L('ส่งตรวจสอบ', 'Submit for review') });
    await expect(submit).toBeVisible();
    await c.shot('list-animal-for-sale', '6', submit);
  },

  async 'buy-animals'(c) {
    // An example seller's live listing (review switched off just for it).
    await requireListingReview(false);
    const seller = await ownerWithFarm(c, 'seller-b', {
      roles: ['farm_owner', 'seller'],
      animals: 1,
      signIn: false,
    });
    const listing = await c.request.post(`${API()}/api/v1/farms/${seller.farmId}/listings`, {
      headers: bearer(seller.token),
      data: {
        animalId: seller.animals[0],
        title: c.L('[ตัวอย่าง] แพะพันธุ์ดี', '[Example] Healthy goat'),
        askingPriceMinor: 450_000,
        negotiable: true,
        photos: [{ url: 'https://files.example.com/goat.jpg' }],
        deliveryOptions: ['pickup'],
      },
    });
    expect(listing.status(), await listing.text()).toBe(201);
    const listingId = (await listing.json()).listing.id as string;
    const submitted = await c.request.post(
      `${API()}/api/v1/farms/${seller.farmId}/listings/${listingId}/submit`,
      { headers: bearer(seller.token) },
    );
    expect(submitted.status(), await submitted.text()).toBe(200);
    await requireListingReview(true);
    // The buyer: a plain member.
    const email = `buyer.${c.locale}${c.width}@example.com`;
    await verifiedUser(c.request, email, c.L('[ตัวอย่าง] สมหญิง', '[Example] Somying'));
    await signIn(c.page, email, c.L);
    await c.page.goto('/market');
    await c.shot('buy-animals', '1', tour(c, 'market-search'));
    await c.page.goto(`/market/listing/${listingId}`);
    await expect(tour(c, 'listing-summary')).toBeVisible();
    await c.shot('buy-animals', '2', tour(c, 'listing-favorite'));
    const offer = tour(c, 'listing-make-offer');
    await offer.getByLabel(labelled(c.L('ราคาที่คุณเสนอ (฿)', 'Your offer (฿)'))).fill('4200');
    await c.shot('buy-animals', '3', offer);
    await offer.getByRole('button', { name: c.L('ส่งข้อเสนอ', 'Send offer') }).click();
    // Sending the offer opens the negotiation: the offer on the table, waiting for the seller.
    await expect(c.page).toHaveURL(/\/market\/offers\/[a-f0-9]{24}/);
    await c.shot('buy-animals', '4', c.page.getByRole('heading', { level: 2 }).first());
  },
};

for (const [slug, scene] of Object.entries(SCENES))
  test(slug, async ({ page, request }, info) => {
    const { locale, width } = info.project.metadata as { locale: Locale; width: number };
    const L = (th: string, en: string) => (locale === 'th' ? th : en);
    await scene({ page, request, locale, width, L, shot: makeShot(page, locale, width) });
  });
