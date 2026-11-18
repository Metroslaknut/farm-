import { Fragment, createElement, type ReactNode } from 'react';
import type { Translate } from '../../../i18n';

/** Helpers shared by the sign-in, registration, verification and social sign-in pages (texts: the `auth` catalog). */

type T = Translate<'auth'>;

/**
 * Thai phone input → E.164 (what the API stores and expects). Accepts local numbers (0812345678, 081-234-5678),
 * 66… and +66…, and any other +country number. Returns null when it cannot be a phone number.
 */
export function normalizeThaiPhone(input: string): string | null {
  const compact = input.trim().replace(/[\s\-().]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;
  if (/^0\d{8,9}$/.test(compact)) return `+66${compact.slice(1)}`;
  if (/^66\d{8,9}$/.test(compact)) return `+${compact}`;
  return null;
}

/** `?error=` codes from the social sign-in return URL → their message, or undefined for an unknown code. */
export function oauthErrorMessage(code: string, t: T): string | undefined {
  switch (code) {
    case 'cancelled':
      return t('oauth.error.cancelled');
    case 'provider_error':
      return t('oauth.error.provider_error');
    case 'account_exists':
      return t('oauth.error.account_exists');
    case 'account_suspended':
      return t('oauth.error.account_suspended');
    case 'account_deactivated':
      return t('oauth.error.account_deactivated');
    default:
      return undefined;
  }
}

/** API error codes → message keys. */
const CODE_KEYS: Record<string, Parameters<T>[0]> = {
  INVALID_TICKET: 'error.signInExpired',
  INVALID_VERIFICATION: 'error.invalidVerification',
  ACCOUNT_SUSPENDED: 'oauth.error.account_suspended',
  ACCOUNT_DEACTIVATED: 'oauth.error.account_deactivated',
  ACCOUNT_NOT_VERIFIED: 'error.notVerified',
  INVALID_CREDENTIALS: 'error.invalidCredentials',
  RATE_LIMITED: 'error.rateLimited',
};

export function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

export function errorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

/** A message in the current language for any error thrown by the API client. */
export function authError(error: unknown, t: T): string {
  const code = errorCode(error);
  const key = code ? CODE_KEYS[code] : undefined;
  if (key) return t(key);
  const status = errorStatus(error);
  if (status === undefined) return t('error.network');
  if (status === 429) return t('error.rateLimited');
  if (status === 400) return t('error.badRequest');
  return t('error.generic');
}

/**
 * A translated sentence with one element in it (e.g. a bold address): `template` holds `{name}` where `node` goes.
 * Word order differs between Thai and English, so the element is placed by the translation, not by the code.
 */
export function withElement(template: string, name: string, node: ReactNode): ReactNode {
  const [before, ...rest] = template.split(`{${name}}`);
  if (rest.length === 0) return template;
  return createElement(Fragment, null, before, node, rest.join(`{${name}}`));
}
