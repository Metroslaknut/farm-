import type { RegisterInput } from '@farmplus/validation';
import { t } from '@/i18n';
import { parseIdentifier, type Identifier } from '@/lib/phone';

/**
 * Registration as a small state machine, kept out of the screen so it can be unit-tested:
 *   form → (register, then sign in) → done | mfa | verify_phone (OTP step) | verify_email (check your inbox)
 *   verify_phone → (confirm code, then sign in with the password still in memory) → done | mfa
 */
export type RegisterStep =
  | { step: 'done' }
  | { step: 'mfa_required' }
  | { step: 'verify_phone'; phone: string }
  | { step: 'verify_email'; email: string };

export interface RegisterDeps {
  register(input: RegisterInput): Promise<unknown>;
  signIn(identifier: string, password: string): Promise<'authenticated' | 'mfa_required'>;
}

export interface VerifyDeps {
  verifyPhone(phone: string, code: string): Promise<void>;
  signIn(identifier: string, password: string): Promise<'authenticated' | 'mfa_required'>;
}

const codeOf = (e: unknown) => (e as { code?: string } | null)?.code;
const statusOf = (e: unknown) => (e as { status?: number } | null)?.status;

/** A user-facing error with the original attached; screens show `message`. */
export class FlowError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'FlowError';
  }
}

export function identifierError(input: string): string | undefined {
  if (!input.trim()) return undefined;
  return parseIdentifier(input)
    ? undefined
    : input.includes('@')
      ? t('auth', 'flow.invalidEmail')
      : t('auth', 'flow.invalidPhone');
}

function friendly(e: unknown): Error {
  if (codeOf(e) === 'ACCOUNT_EXISTS' || statusOf(e) === 409)
    return new FlowError(t('auth', 'flow.accountExists'), e);
  const err = e as { name?: string; status?: number; message?: string } | null;
  if (err?.name === 'ApiClientError' && err.status === undefined)
    return new FlowError(t('auth', 'flow.offline'), e);
  return e instanceof Error ? e : new FlowError(t('auth', 'flow.generic'), e);
}

export async function registerAccount(
  form: { displayName: string; identifier: string; password: string },
  deps: RegisterDeps,
): Promise<RegisterStep> {
  const id: Identifier | null = parseIdentifier(form.identifier);
  if (!id)
    throw new FlowError(identifierError(form.identifier) ?? t('auth', 'flow.identifierRequired'));
  try {
    await deps.register({
      displayName: form.displayName.trim(),
      password: form.password,
      ...(id.kind === 'email' ? { email: id.value } : { phone: id.value }),
    });
  } catch (e) {
    throw friendly(e);
  }
  try {
    return (await deps.signIn(id.value, form.password)) === 'mfa_required'
      ? { step: 'mfa_required' }
      : { step: 'done' };
  } catch (e) {
    // Production requires the email/phone to be verified before the first sign-in.
    if (codeOf(e) === 'ACCOUNT_NOT_VERIFIED')
      return id.kind === 'phone'
        ? { step: 'verify_phone', phone: id.value }
        : { step: 'verify_email', email: id.value };
    throw friendly(e);
  }
}

export async function verifyPhoneAndSignIn(
  input: { phone: string; code: string; password: string },
  deps: VerifyDeps,
): Promise<'done' | 'mfa_required'> {
  const code = input.code.trim();
  if (!/^\d{6}$/.test(code)) throw new FlowError(t('auth', 'flow.codeFormat'));
  try {
    await deps.verifyPhone(input.phone, code);
  } catch (e) {
    if (codeOf(e) === 'INVALID_VERIFICATION' || statusOf(e) === 400)
      throw new FlowError(t('auth', 'flow.codeWrong'), e);
    throw friendly(e);
  }
  try {
    return (await deps.signIn(input.phone, input.password)) === 'mfa_required'
      ? 'mfa_required'
      : 'done';
  } catch (e) {
    throw friendly(e);
  }
}
