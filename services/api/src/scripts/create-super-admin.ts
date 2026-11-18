/**
 * Operator tool to bootstrap the first super admin (there is no API path for this on purpose).
 *   BOOTSTRAP_ADMIN_PASSWORD='…' pnpm --filter @farmplus/api admin:create -- --email admin@example.com --name "Admin"
 * The password is read from the environment (not argv) so it stays out of shell history/process lists.
 * The account must enrol TOTP MFA at first login before its admin permissions become active.
 */
import { loadApiEnv } from '@farmplus/config/server';
import { connectDb, disconnectDb } from '../db/connect';
import { hashPassword } from '../lib/password';
import { Role, User, UserRole } from '../models';
import { syncRbac } from '../rbac/seed';
import { recordAudit } from '../services/audit.service';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const env = loadApiEnv();
  const email = arg('email')?.trim().toLowerCase();
  const displayName = arg('name') ?? 'Super Admin';
  const rawPhone = arg('phone')
    ?.trim()
    .replace(/[\s()-]/g, '');
  const phone = rawPhone
    ? /^0\d{9}$/.test(rawPhone)
      ? `+66${rawPhone.slice(1)}`
      : rawPhone
    : undefined;
  const password = process.env['BOOTSTRAP_ADMIN_PASSWORD'];
  if (!email || !email.includes('@')) throw new Error('--email is required');
  if (phone && !/^\+[1-9]\d{7,14}$/.test(phone))
    throw new Error('--phone must be an E.164 number or a 10-digit Thai mobile number');
  if (!password || password.length < 12)
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD (min 12 chars) is required');

  // Bootstrap runs against the configured database; never let it implicitly drop or rebuild indexes.
  await connectDb(env.MONGODB_URI, { syncIndexes: false });
  await syncRbac();
  if (await User.exists({ $or: [{ email }, ...(phone ? [{ phone }] : [])] }))
    throw new Error('A user with this email or phone number already exists');

  const user = await User.create({
    email,
    ...(phone ? { phone } : {}),
    displayName,
    passwordHash: await hashPassword(password),
    status: 'active',
    emailVerifiedAt: new Date(),
    passwordChangedAt: new Date(),
  });
  const roles = await Role.find({ key: { $in: ['super_admin', 'buyer'] } });
  await UserRole.insertMany(
    roles.map((role) => ({ userId: user._id, roleId: role._id, grantedBy: null })),
  );
  await recordAudit({
    action: 'admin.bootstrap_super_admin',
    targetType: 'user',
    targetId: user._id,
    metadata: { email },
  });
  console.log(`Created super admin ${email} (${String(user._id)}). Enrol MFA at first login.`);
  await disconnectDb();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
