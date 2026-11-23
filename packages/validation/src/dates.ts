/**
 * Today's calendar date in Thailand (UTC+7, no daylight saving), as YYYY-MM-DD. FARM+ is a Thai service: "not in the
 * future" must use the Thai date, or between 00:00 and 07:00 local time today's date would be refused as "the future".
 */
export const THAILAND_OFFSET_MS = 7 * 60 * 60 * 1000;
export const thaiToday = (now: number = Date.now()): string =>
  new Date(now + THAILAND_OFFSET_MS).toISOString().slice(0, 10);

/**
 * Midnight (00:00 UTC) of the Thai calendar day `now` falls on: the same shape as the date-only values the API stores
 * (`weighedOn`, `birthDate`, …), so "today" can be compared with them and day counts come out whole. Between 00:00 and
 * 07:00 in Thailand the UTC date is still yesterday; this is not.
 */
export const thaiDayStart = (now: number = Date.now()): Date =>
  new Date(`${thaiToday(now)}T00:00:00.000Z`);

/**
 * The instant a Thai calendar day (`YYYY-MM-DD`) begins (00:00 in Bangkok = 17:00 UTC the day before). For filtering
 * timestamps (`createdAt`, `at`) by Thai day: `[thaiDayBegins(from), thaiDayBegins(to + 1 day))`.
 */
export const thaiDayBegins = (day: string): Date =>
  new Date(new Date(`${day}T00:00:00.000Z`).getTime() - THAILAND_OFFSET_MS);

/** Next calendar day of a `YYYY-MM-DD` date. */
export const nextDay = (day: string): string =>
  new Date(new Date(`${day}T00:00:00.000Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

/** `yymmdd` of the Thai calendar day (order, refund and withdrawal numbers). */
export const thaiYymmdd = (now: number = Date.now()): string =>
  thaiToday(now).slice(2).replaceAll('-', '');

/**
 * Estimated birth date for an animal whose age is only known approximately ("about 2 years 3 months"): today minus the
 * given years and months (day of month clamped, e.g. 31 May − 3 months = 28/29 Feb). Callers must store it with
 * `birthDateEstimated: true` so it is never shown as an exact date. `null` when the age is not a sensible whole number.
 */
export function estimatedBirthDate(
  years: number,
  months: number,
  today: string = thaiToday(),
): string | null {
  if (!Number.isInteger(years) || !Number.isInteger(months)) return null;
  if (years < 0 || months < 0 || months > 11 || years > 60 || years + months === 0) return null;
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) - (years * 12 + months);
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(Math.min(d, lastDay))}`;
}
