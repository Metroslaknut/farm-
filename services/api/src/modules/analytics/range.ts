import { ANALYTICS_TIMEZONE, type Granularity } from '@farmplus/shared-types';
import { HttpError } from '../../lib/errors';

/** Thailand has no daylight saving: its calendar day is always UTC+7. */
const OFFSET_MS = 7 * 3_600_000;
const DAY = 86_400_000;
export const TZ = ANALYTICS_TIMEZONE;

export interface ReportRange {
  /** First instant of the first day (inclusive) and first instant after the last day (exclusive). */
  start: Date;
  endExclusive: Date;
  /** Inclusive calendar days (Thailand), `YYYY-MM-DD`. */
  from: string;
  to: string;
  days: number;
  granularity: Granularity;
}

const dayStart = (iso: string): Date => new Date(`${iso}T00:00:00+07:00`);
export const bangkokDay = (d: Date): string =>
  new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 10);
const addDays = (iso: string, n: number): string =>
  new Date(dayStart(iso).getTime() + n * DAY + OFFSET_MS).toISOString().slice(0, 10);

const bad = (path: string, message: string) =>
  new HttpError(400, 'VALIDATION_ERROR', message, [{ path, message }]);

export const MAX_DAYS = 366;
export const MAX_DAILY_DAYS = 92;

/** Validates and normalises the requested dates. Defaults to the last 30 days ending today (Thailand time). */
export function resolveRange(
  q: { from?: string | undefined; to?: string | undefined; granularity?: Granularity | undefined },
  now = new Date(),
): ReportRange {
  const today = bangkokDay(now);
  const to = q.to ?? today;
  const from = q.from ?? addDays(to, -29);
  for (const [k, v] of [
    ['from', from],
    ['to', to],
  ] as const) {
    const t = dayStart(v).getTime();
    if (Number.isNaN(t) || bangkokDay(new Date(t)) !== v) throw bad(k, `${k} is not a real date`);
  }
  if (from > to) throw bad('from', 'The start date is after the end date');
  const days = Math.round((dayStart(to).getTime() - dayStart(from).getTime()) / DAY) + 1;
  if (days > MAX_DAYS) throw bad('from', `A report can cover at most ${MAX_DAYS} days`);
  const granularity: Granularity =
    q.granularity ?? (days <= 45 ? 'day' : days <= 200 ? 'week' : 'month');
  if (granularity === 'day' && days > MAX_DAILY_DAYS)
    throw bad(
      'granularity',
      `Daily detail is limited to ${MAX_DAILY_DAYS} days: choose weeks or months`,
    );
  return {
    start: dayStart(from),
    endExclusive: dayStart(addDays(to, 1)),
    from,
    to,
    days,
    granularity,
  };
}

export const dateFormat = (g: Granularity): string =>
  g === 'day' ? '%Y-%m-%d' : g === 'month' ? '%Y-%m' : '%G-W%V';

/** A `$group` key that buckets a date field into the report's periods (Thailand time). */
export const bucket = (field: string, g: Granularity) => ({
  $dateToString: { format: dateFormat(g), date: field, timezone: TZ },
});

function isoWeekLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of this ISO week
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week =
    1 + Math.round(((d.getTime() - jan4.getTime()) / DAY - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
export const labelOf = (iso: string, g: Granularity): string =>
  g === 'day' ? iso : g === 'month' ? iso.slice(0, 7) : isoWeekLabel(iso);

/** Every period in the range in order — including those with no data, so a series has no gaps. */
export function periods(range: ReportRange): string[] {
  const out: string[] = [];
  for (let i = 0; i < range.days; i++) {
    const label = labelOf(addDays(range.from, i), range.granularity);
    if (out[out.length - 1] !== label) out.push(label);
  }
  return out;
}

export function fillSeries(
  range: ReportRange,
  rows: { _id: string; v: number }[],
): { period: string; value: number }[] {
  const by = new Map(rows.map((r) => [r._id, r.v]));
  return periods(range).map((period) => ({ period, value: by.get(period) ?? 0 }));
}
