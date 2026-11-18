import { intlLocale, validationMessage } from '@farmplus/i18n';
import type { FieldErrors } from '@farmplus/validation';
import { getLocale, useLocale } from '../../i18n';

/**
 * Validation messages from the shared Zod schemas (and the API's `details`) are English: show them in the current
 * language. Use on messages that come straight from a schema, never on text that is already translated.
 */
export function localizeFieldErrors(errors: FieldErrors): FieldErrors {
  const locale = getLocale();
  return Object.fromEntries(
    Object.entries(errors).map(([field, message]) => [field, validationMessage(locale, message)]),
  );
}

export const localizeValidation = (message: string): string =>
  validationMessage(getLocale(), message);

/** Dates/times for the community, video and live screens in the current language (Thai: Buddhist calendar). */
export function useDateFormat() {
  const [locale] = useLocale();
  const tag = intlLocale(locale);
  const make = (options: Intl.DateTimeFormatOptions) => (iso: string | undefined | null) => {
    if (!iso) return '—';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(tag, options).format(date);
  };
  return {
    dateTime: make({ dateStyle: 'medium', timeStyle: 'short' }),
    date: make({ dateStyle: 'medium' }),
  };
}
