import { ApiClientError } from '@farmplus/api-client';
import { apiErrorMessage, intlLocale, validationMessage } from '@farmplus/i18n';
import { getLocale } from '../i18n/locale';
// Formatters follow the chosen language (Thai: Buddhist calendar). Built per call: cheap, and never stale after a switch.
const dateTime = () =>
  new Intl.DateTimeFormat(intlLocale(getLocale()), { dateStyle: 'medium', timeStyle: 'short' });

export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dateTime().format(date);
}

/**
 * A readable message for any thrown value. A server validation error ("Request validation failed") carries the real
 * reason in `details`, so that is what the user should see.
 */
/**
 * What to show for a failed call. English keeps the server's own (English) message. Thai translates by the error code
 * (and known validation messages), falling back to a generic Thai message: no English text reaches a Thai screen.
 */
export function errorMessage(error: unknown): string {
  const locale = getLocale();
  if (!(error instanceof Error)) return apiErrorMessage(locale, undefined);
  const details = (error as { details?: { message?: unknown }[] }).details;
  const first = Array.isArray(details)
    ? details.find((d) => typeof d?.message === 'string')
    : undefined;
  if (locale === 'en') return first ? String(first.message) : error.message;
  if (first) return validationMessage(locale, String(first.message));
  if (error instanceof ApiClientError)
    return apiErrorMessage(locale, error.status === undefined ? 'NETWORK' : error.code);
  return apiErrorMessage(locale, undefined);
}

const dateOnly = () => new Intl.DateTimeFormat(intlLocale(getLocale()), { dateStyle: 'medium' });

export function formatDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dateOnly().format(date);
}

/**
 * The value an `<input type="datetime-local">` needs for a stored instant: the user's local wall-clock time. Slicing the
 * ISO string would show UTC, and saving it back (`new Date(local)` reads local time) would move the instant by the UTC
 * offset on every edit (−7 hours in Thailand).
 */
export function toDateTimeLocal(iso: string | Date): string {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
