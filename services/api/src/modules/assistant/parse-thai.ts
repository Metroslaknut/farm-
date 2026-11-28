import { thaiToday } from '@farmplus/validation';

/**
 * Deterministic readers for what people type (docs/architecture/assistant-actions.md): the model only passes on the
 * person's own phrases ("2 โล 3 ขีด", "เมื่อวาน"); these turn them into values. Anything unclear → null, and the
 * assistant asks instead of guessing.
 */
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
export const normalise = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)))
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/\s+/g, ' ');

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Weight in kg: กก. / กิโล(กรัม) / โล / kg, ขีด (100 g), กรัม / g, ตัน; "ครึ่ง" after a unit adds half of it. */
export function parseWeightKg(phrase: string): number | null {
  const s = normalise(phrase);
  const unit: [RegExp, number][] = [
    [/^(?:กิโลกรัม|กิโล|กก\.?|โล|kg|kgs|kilo(?:gram)?s?)/, 1],
    [/^(?:ขีด)/, 0.1],
    [/^(?:กรัม|g|grams?)/, 0.001],
    [/^(?:ตัน|tons?)/, 1000],
  ];
  const re = new RegExp(`${NUM}\\s*`, 'g');
  let total = 0;
  let found = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const value = Number(m[1]);
    const rest = s.slice(re.lastIndex);
    const u = unit.find(([r]) => r.test(rest));
    if (!u) {
      // A bare number is kilograms only when it is the whole phrase ("250"); otherwise it is unclear.
      if (found || s.replace(/^\D*/, '') !== m[1]) return null;
      total += value;
      found = true;
      continue;
    }
    const matched = rest.match(u[0])![0];
    re.lastIndex += matched.length;
    let amount = value * u[1];
    if (/^\s*ครึ่ง/.test(s.slice(re.lastIndex))) amount += (u[1] * 1) / 2;
    total += amount;
    found = true;
  }
  if (!found && /^ครึ่ง\s*(?:กิโล|กก|โล)/.test(s)) return 0.5;
  return found && total > 0 ? round2(total) : null;
}

/** A quantity for feeding: kg (with ขีด), g, l, ml or pieces. */
export function parseQuantity(
  phrase: string,
): { amount: number; unit: 'kg' | 'g' | 'l' | 'ml' | 'piece' } | null {
  const s = normalise(phrase);
  const m = new RegExp(`^${NUM}\\s*(.*)$`).exec(s);
  if (/ขีด|โล|กิโล|กก|kg/.test(s)) {
    const kg = parseWeightKg(s);
    return kg === null ? null : { amount: kg, unit: 'kg' };
  }
  if (!m) return null;
  const amount = Number(m[1]);
  const u = m[2]!.trim();
  if (!(amount > 0)) return null;
  if (/^(?:กรัม|g|grams?)/.test(u)) return { amount, unit: 'g' };
  if (/^(?:ลิตร|l|litres?|liters?)/.test(u)) return { amount, unit: 'l' };
  if (/^(?:มล\.?|มิลลิลิตร|ซีซี|cc|ml)/.test(u)) return { amount, unit: 'ml' };
  if (/^(?:ชิ้น|ก้อน|อัน|เม็ด|pieces?|pcs?)/.test(u)) return { amount, unit: 'piece' };
  return null;
}

const MONTHS: [RegExp, number][] = [
  [/^(?:มกราคม|ม\.ค\.?|jan(?:uary)?)/, 1],
  [/^(?:กุมภาพันธ์|ก\.พ\.?|feb(?:ruary)?)/, 2],
  [/^(?:มีนาคม|มี\.ค\.?|mar(?:ch)?)/, 3],
  [/^(?:เมษายน|เม\.ย\.?|apr(?:il)?)/, 4],
  [/^(?:พฤษภาคม|พ\.ค\.?|may)/, 5],
  [/^(?:มิถุนายน|มิ\.ย\.?|jun(?:e)?)/, 6],
  [/^(?:กรกฎาคม|ก\.ค\.?|jul(?:y)?)/, 7],
  [/^(?:สิงหาคม|ส\.ค\.?|aug(?:ust)?)/, 8],
  [/^(?:กันยายน|ก\.ย\.?|sep(?:t(?:ember)?)?)/, 9],
  [/^(?:ตุลาคม|ต\.ค\.?|oct(?:ober)?)/, 10],
  [/^(?:พฤศจิกายน|พ\.ย\.?|nov(?:ember)?)/, 11],
  [/^(?:ธันวาคม|ธ\.ค\.?|dec(?:ember)?)/, 12],
];

const pad = (n: number) => String(n).padStart(2, '0');
export const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
function ymd(y: number, m: number, d: number): string | null {
  if (y > 2400) y -= 543; // Buddhist era
  if (y < 100) y += y > 50 ? 1900 : 2000;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.getUTCDate() === d && date.getUTCMonth() + 1 === m
    ? iso
    : null;
}

/** A Thai calendar day (YYYY-MM-DD): วันนี้ / เมื่อวาน / เมื่อวานซืน / พรุ่งนี้ / "3 วันก่อน" / d/m/(พ.ศ. or ค.ศ.) / "5 ธ.ค. 2569". */
export function parseThaiDate(phrase: string, now: Date = new Date()): string | null {
  const s = normalise(phrase);
  const today = thaiToday(now.getTime());
  if (/^(?:วันนี้|today)$/.test(s)) return today;
  if (/^(?:เมื่อวานซืน|day before yesterday)$/.test(s)) return addDays(today, -2);
  if (/^(?:เมื่อวาน|yesterday)$/.test(s)) return addDays(today, -1);
  if (/^(?:พรุ่งนี้|tomorrow)$/.test(s)) return addDays(today, 1);
  let m = /^(\d{1,3}) ?(?:วัน)(?:ก่อน|ที่แล้ว)$|^(\d{1,3}) days? ago$/.exec(s);
  if (m) return addDays(today, -Number(m[1] ?? m[2]));
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  const year = Number(today.slice(0, 4));
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(s);
  if (m) return ymd(m[3] ? Number(m[3]) : year, Number(m[2]), Number(m[1]));
  m = /^(?:วันที่ ?)?(\d{1,2}) ?(.+?)(?: ?(\d{2,4}))?$/.exec(s);
  if (m) {
    const month = MONTHS.find(([r]) => r.test(m![2]!.replace(/^เดือน ?/, '')));
    if (month) return ymd(m[3] ? Number(m[3]) : year, month[1], Number(m[1]));
  }
  return null;
}

/** male / female from ตัวผู้, เพศผู้, ตัวเมีย, … (null when not said). */
export function parseSex(phrase: string | undefined): 'male' | 'female' | null {
  if (!phrase) return null;
  const s = normalise(phrase);
  if (/เมีย|หญิง|female|\bf\b|แม่พันธุ์/.test(s)) return 'female';
  if (/ผู้|ชาย|male|\bm\b|พ่อพันธุ์/.test(s)) return 'male';
  return null;
}
