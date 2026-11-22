/** Remove trailing slashes so base URLs can be joined with a leading-slash path. */
export function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

/** Exhaustiveness helper for switch statements over unions. */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

/** `for_sale` → `For sale`. */
export function humanize(value: string): string {
  const text = value.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Compact age from a YYYY-MM-DD birth date: "3 y 2 m", "5 m", "12 d". Undefined for missing/invalid/future dates. */
export function formatAge(
  birthDate: string | undefined,
  now: Date = new Date(),
): string | undefined {
  if (!birthDate) return undefined;
  const born = new Date(`${birthDate}T00:00:00Z`);
  // Count on the Thai calendar (UTC+7, as birth dates are entered): between 00:00 and 07:00 in Thailand the UTC date
  // is still yesterday, which would make an animal born today "in the future".
  now = new Date(now.getTime() + 7 * 3_600_000);
  if (Number.isNaN(born.getTime()) || born > now) return undefined;
  let months =
    (now.getUTCFullYear() - born.getUTCFullYear()) * 12 + (now.getUTCMonth() - born.getUTCMonth());
  if (now.getUTCDate() < born.getUTCDate()) months -= 1;
  if (months < 1)
    return `${Math.max(0, Math.floor((now.getTime() - born.getTime()) / 86_400_000))} d`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return years > 0 ? (rest > 0 ? `${years} y ${rest} m` : `${years} y`) : `${rest} m`;
}

export * from './video';
export * from './commission';
export * from './products';
export * from './breeding';

/** Satang → "฿50,000.00". Money is always integer satang; this only formats. */
export function formatBaht(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const baht = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}฿${baht}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * "50,000", "50000.5", "50 000.25" → integer satang, or `undefined` when the text is not a valid amount
 * (more than 2 decimals, letters, empty). Parsing is done on the digits: no floating-point arithmetic.
 */
export function parseBahtToMinor(text: string): number | undefined {
  const t = text.trim().replace(/[,\s]/g, '');
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return undefined;
  const minor = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  return Number.isSafeInteger(minor) && minor > 0 ? minor : undefined;
}
