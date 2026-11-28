/**
 * Personal data is removed from a question before it reaches the AI provider (docs/architecture/assistant.md):
 * e-mail addresses, Thai national ID numbers (13 digits), phone numbers, bank account numbers and LINE ids.
 * The search step works on the original text; only the model sees the redacted one.
 */
const RULES: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[อีเมล]'],
  // Thai national ID: 13 digits, often written 1-2345-67890-12-3
  [/\b\d[-\s]?\d{4}[-\s]?\d{5}[-\s]?\d{2}[-\s]?\d\b/g, '[เลขบัตรประชาชน]'],
  // Phone numbers: 0X… (9–10 digits) or +66…, with optional spaces or dashes
  [/(?:\+66[-\s]?|\b0)\d(?:[-\s]?\d){7,8}\b/g, '[เบอร์โทร]'],
  // Bank account numbers: 10–12 digits, often 123-4-56789-0
  [/\b\d{3}[-\s]?\d[-\s]?\d{5}[-\s]?\d{1,3}\b/g, '[เลขบัญชี]'],
  [/\b\d{10,16}\b/g, '[ตัวเลข]'],
  // LINE id after "line" / "ไลน์" / "@"
  [/(?:line\s*(?:id)?|ไลน์)\s*[:：]?\s*@?[\w.-]{3,}/gi, '[ไลน์]'],
];

export function redact(text: string): string {
  return RULES.reduce((t, [re, label]) => t.replace(re, label), text);
}
