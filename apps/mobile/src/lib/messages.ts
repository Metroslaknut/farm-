import { apiErrorMessage, validationMessage } from '@farmplus/i18n';
import { getLocale } from '@/i18n/locale';

/**
 * An error whose message was written by the app for the user, already in the current language (see `t()`), so it is
 * shown as is in both languages. API errors and unexpected exceptions are translated by `errorText` instead.
 */
export class AppError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AppError';
  }
}

/** Errors whose `message` is already user-facing and localised. */
const USER_FACING = new Set(['AppError', 'FlowError']);

/**
 * What to show for a failed call (mirrors the web's `errorMessage`). English keeps the server's own (English) message;
 * a validation error ("Request validation failed") carries the real reason in `details`, so that is shown. Thai
 * translates by the error code (and known validation messages), falling back to a generic Thai message: no English
 * server text reaches a Thai screen.
 */
export function errorText(error: unknown): string {
  const locale = getLocale();
  if (!(error instanceof Error))
    return locale === 'en' ? 'Something went wrong' : apiErrorMessage(locale, undefined);
  if (USER_FACING.has(error.name)) return error.message;
  const details = (error as { details?: { message?: unknown }[] }).details;
  const first = Array.isArray(details)
    ? details.find((d) => typeof d?.message === 'string')
    : undefined;
  if (locale === 'en') return first ? String(first.message) : error.message;
  if (first) return validationMessage(locale, String(first.message));
  const api = error as { name?: string; status?: number; code?: string };
  if (api.name === 'ApiClientError')
    return apiErrorMessage(locale, api.status === undefined ? 'NETWORK' : api.code);
  return apiErrorMessage(locale, undefined);
}

/** A client-side validation message from the shared (English) schemas, in the current language. */
export function validationText(english: string): string {
  return validationMessage(getLocale(), english);
}
