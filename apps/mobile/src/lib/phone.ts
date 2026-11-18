/**
 * Phone numbers are sent to the API in E.164 (+66812345678). People type Thai local numbers (081-234-5678,
 * 02 123 4567) or the international form with spaces/dashes; this turns any of those into E.164, or null.
 */
export function normalizePhone(input: string): string | null {
  const raw = input.trim();
  if (!raw || /[^\d\s+().-]/.test(raw)) return null;
  const digits = raw.replace(/[\s().-]/g, '');
  let e164: string;
  if (digits.startsWith('+')) e164 = digits;
  else if (digits.startsWith('00')) e164 = `+${digits.slice(2)}`;
  else if (/^0\d{8,9}$/.test(digits))
    e164 = `+66${digits.slice(1)}`; // Thai local: 0 + 8 (landline) or 9 (mobile) digits
  else if (/^66\d{8,9}$/.test(digits)) e164 = `+${digits}`;
  else return null;
  if (e164.startsWith('+660')) e164 = `+66${e164.slice(4)}`; // "+66 081…" — the trunk 0 is dropped internationally
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

export type Identifier = { kind: 'email'; value: string } | { kind: 'phone'; value: string };

/** An email (lower-cased) or a phone (E.164) from a single "Email or phone" field. Null when it is neither. */
export function parseIdentifier(input: string): Identifier | null {
  const value = input.trim();
  if (value.includes('@'))
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      ? { kind: 'email', value: value.toLowerCase() }
      : null;
  const phone = normalizePhone(value);
  return phone ? { kind: 'phone', value: phone } : null;
}
