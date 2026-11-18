/**
 * CSV for spreadsheets. Two safety rules: quoting per RFC 4180, and CSV/formula-injection defence — a text cell that begins with
 * `= + - @` (or a tab / carriage return) would be executed as a formula by Excel/Sheets, so it is prefixed with an apostrophe.
 * A UTF-8 byte-order mark is added so Thai text opens correctly in Excel.
 */
const BOM = String.fromCharCode(0xfeff);
const CRLF = String.fromCharCode(13, 10);
const DANGEROUS = /^[=+\-@\t\r]/;

export function cell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (typeof value === 'number') text = Number.isFinite(value) ? String(value) : '';
  else {
    text = String(value);
    // Numbers are never treated as text; strings that merely LOOK dangerous are neutralised.
    if (DANGEROUS.test(text)) text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(
  columns: string[],
  rows: (string | number | boolean | null | undefined)[][],
): string {
  const lines = [columns.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))];
  return BOM + lines.join(CRLF) + CRLF;
}

/** Satang → baht as a NUMBER (so spreadsheets treat it as one and negative values are not mistaken for text). */
export const baht = (minor: number | null | undefined): number | null =>
  minor === null || minor === undefined ? null : Math.round(minor) / 100;

export const safeFilename = (name: string): string =>
  name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
