import type { AnimalOriginKind, AnimalSex, AnimalStatus, FarmRole } from '@farmplus/shared-types';
import { formatAge, humanize } from '@farmplus/shared-utils';
import type { FieldErrors } from '@farmplus/validation';
import { t, type KeyOf } from '@/i18n';
import { validationText } from '@/lib/messages';
import type { StatusTone } from '@/theme';

type FarmKey = KeyOf<'farms'>;

/** Labels are resolved at call time (current language); screens call `useT('farms')` so they re-render on a switch. */
const label =
  <V extends string>(keys: Record<V, FarmKey>) =>
  (value: string): string =>
    value in keys ? t('farms', keys[value as V]) : humanize(value);

const ROLE_KEYS: Record<FarmRole, FarmKey> = {
  owner: 'role.owner',
  manager: 'role.manager',
  worker: 'role.worker',
  viewer: 'role.viewer',
};
const STATUS_KEYS: Record<AnimalStatus, FarmKey> = {
  active: 'status.active',
  for_sale: 'status.for_sale',
  sold: 'status.sold',
  deceased: 'status.deceased',
  transferred: 'status.transferred',
  lost: 'status.lost',
};
const SEX_KEYS: Record<AnimalSex, FarmKey> = {
  male: 'sex.male',
  female: 'sex.female',
  unknown: 'sex.unknown',
};
const ORIGIN_KEYS: Record<AnimalOriginKind, FarmKey> = {
  born_on_farm: 'origin.born_on_farm',
  purchased: 'origin.purchased',
  transferred_in: 'origin.transferred_in',
  gift: 'origin.gift',
  other: 'origin.other',
};

/** "Owner" / "เจ้าของฟาร์ม"; unknown values fall back to `humanize`. */
export const roleLabel = label(ROLE_KEYS);
/** Animal status ("For sale" / "ประกาศขาย"). */
export const statusLabel = label(STATUS_KEYS);
/** Animal sex ("Female" / "เพศเมีย"). */
export const sexLabel = label(SEX_KEYS);
/** Where the animal came from ("Born on farm" / "เกิดในฟาร์ม"). */
export const originLabel = label(ORIGIN_KEYS);

const AGE_UNIT_KEYS: Record<string, FarmKey> = { y: 'age.y', m: 'age.m', d: 'age.d' };

/** `formatAge` in the current language: "3 y 2 m" in English (unchanged), "3 ปี 2 เดือน" in Thai. */
export function ageText(birthDate: string | undefined, now?: Date): string | undefined {
  const age = formatAge(birthDate, now);
  return age?.replace(/(\d+) ([ymd])\b/g, (whole, n: string, unit: string) =>
    AGE_UNIT_KEYS[unit] ? t('farms', AGE_UNIT_KEYS[unit], { n }) : whole,
  );
}

/** Field errors (shared English validation messages) in the current language. */
export const localizeFieldErrors = (errors: FieldErrors): FieldErrors =>
  Object.fromEntries(Object.entries(errors).map(([k, m]) => [k, validationText(m)]));

/** Status → badge tone. `info`-like states reuse neutral/warning since the mobile palette has three status tones. */
export const ANIMAL_TONE: Record<AnimalStatus, StatusTone | 'neutral'> = {
  active: 'success',
  for_sale: 'warning',
  sold: 'neutral',
  transferred: 'neutral',
  deceased: 'error',
  lost: 'warning',
};

export const detailsOf = (error: unknown): { path: string; message: string }[] | undefined =>
  (error as { details?: { path: string; message: string }[] } | null)?.details;
