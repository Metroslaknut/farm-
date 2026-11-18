import { intlLocale, type Locale } from '@farmplus/i18n';
import type { MetricUnit, TableData } from '@farmplus/shared-types';
import { getLocale, t } from '../../i18n';

// Formatters per language (both use Latin digits and comma grouping; only the unit words differ).
const formatters = new Map<Locale, { number: Intl.NumberFormat; baht: Intl.NumberFormat }>();
function fmt() {
  const locale = getLocale();
  let f = formatters.get(locale);
  if (!f) {
    const tag = intlLocale(locale);
    f = {
      number: new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }),
      baht: new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    };
    formatters.set(locale, f);
  }
  return f;
}
const number = { format: (value: number) => fmt().number.format(value) };

/** Money arrives as integer satang; people read baht. */
export const formatBaht = (minor: number): string => `฿${fmt().baht.format(minor / 100)}`;

export function formatMetric(value: number | null | undefined, unit: MetricUnit): string {
  if (value === null || value === undefined) return '—';
  switch (unit) {
    case 'minor_thb':
      return formatBaht(value);
    case 'percent':
      return `${number.format(value)}%`;
    case 'kg':
      return t('layout', 'analytics.unit.kg', { value: number.format(value) });
    case 'g_per_day':
      return t('layout', 'analytics.unit.gPerDay', { value: number.format(value) });
    case 'hours':
      return t('layout', 'analytics.unit.hours', { value: number.format(value) });
    default:
      return number.format(value);
  }
}

export function formatCell(
  table: TableData,
  column: number,
  value: string | number | null,
): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number')
    return table.moneyColumns?.includes(column) ? formatBaht(value) : number.format(value);
  return value;
}

/** `grossSalesMinor` → "Gross sales minor" is never shown: labels come from the metric definitions. */
export const humanizeKey = (key: string): string =>
  key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();

/** Save text as a file in the browser (CSV exports). */
export function saveTextFile(text: string, filename: string, contentType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: contentType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
