import type { AnimalStatus, FarmRole } from '@farmplus/shared-types';
import {
  formatDate as fmtDate,
  formatDateTime as fmtDateTime,
  validationMessage,
} from '@farmplus/i18n';
import { formatAge, formatBaht, humanize } from '@farmplus/shared-utils';
import type { FieldErrors } from '@farmplus/validation';
import type { Tone } from '../../components/ui';
import { getLocale, useLocale, useT, type Translate } from '../../i18n';
import farms from '../../i18n/messages/farms';

/** Translator of the "farms" area, and the keys it accepts (record configs store keys, resolved at render time). */
export type FarmsT = Translate<'farms'>;
export type FarmsKey = Parameters<FarmsT>[0];
export const useFarmsT = (): FarmsT => useT('farms');

export const STATUS_TONE: Record<AnimalStatus, Tone> = {
  active: 'success',
  for_sale: 'info',
  sold: 'neutral',
  transferred: 'neutral',
  deceased: 'danger',
  lost: 'warning',
};

/** Enum groups with translated labels in the catalog (`enum.<group>.<value>`). */
export type EnumGroup =
  | 'role'
  | 'status'
  | 'sex'
  | 'sexRaw'
  | 'origin'
  | 'mediaKind'
  | 'mediaKindRaw'
  | 'healthType'
  | 'healthSeverity'
  | 'healthOutcome'
  | 'statedBy'
  | 'statedByRaw'
  | 'prescribedBy'
  | 'weighMethod'
  | 'feedCategory'
  | 'unit'
  | 'expenseCategory'
  | 'breedingMethod'
  | 'breedingStatus'
  | 'offspringOutcome'
  | 'historyType'
  | 'relatedKind';

const has = (key: string): key is FarmsKey => key in farms.en;

/** Label of an API enum value in the current language; unknown values fall back to a readable form, never a raw code. */
export function enumLabel(t: FarmsT, group: EnumGroup, value: string): string {
  const key = `enum.${group}.${value}`;
  return has(key) ? t(key) : humanize(value);
}

export const roleLabel = (t: FarmsT, role: FarmRole) => enumLabel(t, 'role', role);

/** An admin-managed animal type's name in the current language (Thai name when the admin gave one). */
export const typeName = (type: { name: string; nameTh?: string }, locale: string): string =>
  (locale === 'th' && type.nameTh) || type.name;

/** An animal's breed in the current language; `undefined` when it has none. */
export const breedLabel = (
  a: { breed?: string; breedName?: string; breedNameTh?: string },
  locale: string,
): string | undefined =>
  (locale === 'th' && a.breedNameTh) || a.breedName || (a.breed ? humanize(a.breed) : undefined);

/** "3 y 2 m" / "3 ปี 2 เดือน": the shared age, worded in the current language. */
export function ageLabel(t: FarmsT, birthDate: string | undefined): string | undefined {
  const age = formatAge(birthDate);
  if (!age) return undefined;
  const n = (unit: string) => age.match(new RegExp(`(\\d+) ${unit}`))?.[1];
  const [y, m, d] = [n('y'), n('m'), n('d')];
  if (d !== undefined) return t('age.d', { d });
  if (y !== undefined && m !== undefined) return t('age.ym', { y, m });
  if (y !== undefined) return t('age.y', { y });
  return t('age.m', { m: m ?? '0' });
}

/** An age given in days (as computed by the API) worded like `ageLabel`: days under a month, else years/months. */
export function ageDaysLabel(t: FarmsT, days: number | undefined): string | undefined {
  if (days === undefined) return undefined;
  if (days < 31) return t('age.d', { d: days });
  const months = Math.floor(days / 30.4375);
  const [y, m] = [Math.floor(months / 12), months % 12];
  if (y === 0) return t('age.m', { m });
  return m === 0 ? t('age.y', { y }) : t('age.ym', { y, m });
}

/** Record amounts are baht with up to 2 decimals (the API keeps satang): "฿150.00", like the rest of the app. */
export const bahtLabel = (baht: number): string => formatBaht(Math.round(baht * 100));

/** Dates in the current language (Thai: Buddhist calendar). A dash when missing or invalid. */
export function useFarmFormat() {
  const [locale] = useLocale();
  return {
    locale,
    date: (value: string | undefined | null) =>
      (value && fmtDate(value, locale, { dateStyle: 'medium' })) || '—',
    dateTime: (value: string | undefined | null) => (value && fmtDateTime(value, locale)) || '—',
  };
}

/** Field errors from the shared (English) validation messages, in the current language. */
export function localizeErrors(errors: FieldErrors): FieldErrors {
  const locale = getLocale();
  return Object.fromEntries(
    Object.entries(errors).map(([k, v]) => [k, v ? validationMessage(locale, v) : v]),
  );
}
