import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { apiErrorMessage, apiErrors, validationMessage, validationMessages } from '@farmplus/i18n';
import { loginSchema, registerSchema } from '@farmplus/validation';

// jsdom replaces the global URL, so resolve from the file path instead.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..') + '/';
const API_SRC = join(ROOT, 'services/api/src');
const CLIENT_SRC = join(ROOT, 'packages/api-client/src');
const VALIDATION_SRC = join(ROOT, 'packages/validation/src');
const GENERIC_TH = 'ข้อมูลบางช่องไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง';
const THAI = /[฀-๿]/;

const tsFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? tsFiles(join(dir, entry.name))
      : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
        ? [join(dir, entry.name)]
        : [],
  );

/** The argument text of the call whose `(` is at `open` (string contents skipped, so parentheses inside them don't count). */
function callArguments(source: string, open: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return source.slice(open + 1, i);
  }
  return '';
}

/**
 * Every error code the API and the API client can produce: codes passed to the error helpers (`badRequest`, `conflict`,
 * `forbidden`, `unauthorized`, `notFound`, the modules' `err`/`unprocessable`/`invalid`/`bad`, `new HttpError`, the
 * socket's `fail`), their default codes, and codes written directly in responses/acks (`code: '…'`, `error: '…'`).
 */
function collectErrorCodes(): Map<string, string> {
  const CODE = /'([A-Z][A-Z0-9_]{2,})'/g;
  const HELPER =
    /\b(?:badRequest|unauthorized|forbidden|conflict|notFound|err|unprocessable|fail|invalid|bad|HttpError)\s*\(/g;
  const DIRECT = [
    /\bcode\s*[:=]\s*'([A-Z][A-Z0-9_]{2,})'/g,
    /\.code\s*\?\?\s*'([A-Z][A-Z0-9_]{2,})'/g,
    /\berror:\s*'([A-Z][A-Z0-9_]{2,})'/g,
  ];
  const codes = new Map<string, string>();
  // The mockup seed data (scripts/mockup) uses `code: 'F01'` etc. as farm/shop record codes, not API error codes.
  const MOCKUP_SEED = join(API_SRC, 'scripts/mockup') + '/';
  const sources = [...tsFiles(API_SRC), ...tsFiles(CLIENT_SRC)].filter(
    (file) => !file.startsWith(MOCKUP_SEED),
  );
  for (const file of sources) {
    const source = readFileSync(file, 'utf8');
    for (const call of source.matchAll(HELPER)) {
      const args = callArguments(source, call.index + call[0].length - 1);
      for (const code of args.matchAll(CODE)) codes.set(code[1]!, file.slice(ROOT.length));
    }
    for (const pattern of DIRECT)
      for (const code of source.matchAll(pattern)) codes.set(code[1]!, file.slice(ROOT.length));
  }
  // The AI narrative checks (modules/ai/narrative.ts) are logged, never sent to clients.
  for (const code of codes.keys()) if (code.startsWith('AI_OUTPUT_')) codes.delete(code);
  return codes;
}

const literal = (node: ts.Node | undefined): string | undefined =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;

function walk(file: string, visit: (node: ts.Node) => void): void {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const recurse = (node: ts.Node): void => {
    visit(node);
    ts.forEachChild(node, recurse);
  };
  recurse(sf);
}

const ZOD_MESSAGE_METHODS = new Set([
  'min', 'max', 'length', 'regex', 'refine', 'positive', 'nonnegative', 'negative', 'int', 'gte', 'lte', 'gt', 'lt',
  'email', 'url', 'datetime', 'multipleOf', 'nonempty',
]); // prettier-ignore

/** The fixed English messages of packages/validation (Zod custom messages, `issue(…)`, `bad(…)`, `notInFuture(label)`). */
function collectSchemaMessages(): Set<string> {
  const messages = new Set<string>();
  for (const file of tsFiles(VALIDATION_SRC)) {
    walk(file, (node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : callee.getText();
        const args = node.arguments;
        if (ts.isPropertyAccessExpression(callee) && ZOD_MESSAGE_METHODS.has(name))
          for (const arg of args) {
            const text = literal(arg);
            if (text) messages.add(text);
          }
        if (name === 'issue' && args.length === 3) add(literal(args[2]));
        if (name === 'bad' && args.length === 2) add(literal(args[1]));
        if (name === 'notInFuture') {
          const label = literal(args[0]);
          if (label) messages.add(`${label} cannot be in the future`);
        }
      }
      if (ts.isPropertyAssignment(node) && ['message', 'error'].includes(node.name.getText()))
        add(literal(node.initializer));
    });
  }
  function add(text: string | undefined): void {
    if (text) messages.add(text);
  }
  return messages;
}

/** The fixed English field messages the API itself puts in `details` (`invalid(field, '…')`, `{ path, message }`, …). */
function collectApiFieldMessages(): Set<string> {
  const messages = new Set<string>();
  const add = (text: string | undefined) => text && messages.add(text);
  for (const file of tsFiles(API_SRC)) {
    walk(file, (node) => {
      if (ts.isCallExpression(node)) {
        const name = node.expression.getText();
        const args = node.arguments;
        if ((name === 'invalid' || name === 'bad' || name === 'unprocessable') && args.length >= 2)
          add(literal(args[1]));
        if (name === 'err' && args.length === 4) add(literal(args[2]));
      }
      if (ts.isObjectLiteralExpression(node)) {
        const names = node.properties.map((p) => p.name?.getText());
        if (names.includes('path') && names.includes('message'))
          for (const p of node.properties)
            if (ts.isPropertyAssignment(p) && p.name.getText() === 'message')
              add(literal(p.initializer));
      }
    });
  }
  return messages;
}

describe('API error codes', () => {
  const codes = collectErrorCodes();

  it('finds the codes in the API sources', () => {
    expect(codes.size).toBeGreaterThan(150);
    for (const code of [
      'VALIDATION_ERROR',
      'NOT_FOUND',
      'INTERNAL_ERROR',
      'UNAUTHENTICATED',
      'RATE_LIMITED',
    ])
      expect(codes.has(code)).toBe(true);
  });

  it('has a Thai and an English message for every code the API or client can return', () => {
    const missing = [...codes].filter(
      ([code]) => !(code in apiErrors.th) || !(code in apiErrors.en),
    );
    expect(missing.map(([code, file]) => `${code} (${file})`)).toEqual([]);
  });

  it('keeps th and en keys identical, non-empty, and Thai in Thai', () => {
    expect(Object.keys(apiErrors.en).sort()).toEqual(Object.keys(apiErrors.th).sort());
    for (const [code, th] of Object.entries(apiErrors.th)) {
      expect(th.trim(), code).not.toBe('');
      expect(THAI.test(th), code).toBe(true);
      expect((apiErrors.en as Record<string, string>)[code]!.trim(), code).not.toBe('');
    }
  });

  it('apiErrorMessage translates known codes and falls back to UNKNOWN', () => {
    expect(apiErrorMessage('th', 'INVALID_CREDENTIALS')).toBe(apiErrors.th.INVALID_CREDENTIALS);
    expect(apiErrorMessage('en', 'INVALID_CREDENTIALS')).toBe(apiErrors.en.INVALID_CREDENTIALS);
    expect(apiErrorMessage('th', 'NETWORK')).toBe(apiErrors.th.NETWORK);
    for (const code of [undefined, '', 'SOMETHING_NEW', 'toString', '__proto__', 'constructor']) {
      expect(apiErrorMessage('th', code)).toBe(apiErrors.th.UNKNOWN);
      expect(apiErrorMessage('en', code)).toBe(apiErrors.en.UNKNOWN);
    }
  });
});

describe('validation messages', () => {
  it('translates every fixed message of packages/validation', () => {
    const messages = collectSchemaMessages();
    expect(messages.size).toBeGreaterThan(80);
    const untranslated = [...messages].filter((m) => validationMessage('th', m) === GENERIC_TH);
    expect(untranslated).toEqual([]);
  });

  it('translates every fixed field message of the API', () => {
    const messages = collectApiFieldMessages();
    expect(messages.size).toBeGreaterThan(60);
    const untranslated = [...messages].filter((m) => validationMessage('th', m) === GENERIC_TH);
    expect(untranslated).toEqual([]);
  });

  it('uses the exact dictionary entries', () => {
    expect(validationMessage('th', 'At least 10 characters')).toBe('ต้องมีอย่างน้อย 10 ตัวอักษร');
    expect(validationMessage('th', 'Phone must be in E.164 format')).toBe(
      validationMessages['Phone must be in E.164 format'],
    );
    expect(validationMessage('th', 'Give the listing a title')).toBe('กรุณาตั้งชื่อประกาศ');
    for (const [english, thai] of Object.entries(validationMessages)) {
      expect(validationMessage('th', english)).toBe(thai);
      expect(THAI.test(thai), english).toBe(true);
    }
  });

  it('keeps English as is', () => {
    expect(validationMessage('en', 'At least 10 characters')).toBe('At least 10 characters');
    expect(validationMessage('en', 'Something unknown')).toBe('Something unknown');
  });

  it('translates templated messages and keeps their values', () => {
    expect(validationMessage('th', 'At most 120 characters')).toBe('ไม่เกิน 120 ตัวอักษร');
    expect(validationMessage('th', 'The minimum order is 3')).toBe('สั่งซื้อขั้นต่ำ 3 ชิ้น');
    expect(validationMessage('th', 'A report can cover at most 366 days')).toContain('366');
    expect(validationMessage('th', 'The sire is recorded as female')).toBe(
      'พ่อพันธุ์ตัวนี้ถูกบันทึกเป็นเพศเมีย',
    );
    expect(validationMessage('th', 'Type “ENABLE feed” to confirm')).toBe(
      'พิมพ์ “ENABLE feed” เพื่อยืนยัน',
    );
    expect(
      validationMessage('th', '4 unit(s) are held by unpaid orders: you cannot go below that'),
    ).toContain('4');
  });

  it('translates Zod 4 default messages with their numbers', () => {
    const cases: [string, string][] = [
      ['Invalid input', 'ข้อมูลไม่ถูกต้อง'],
      ['Invalid input: expected string, received undefined', 'กรุณากรอกข้อมูลช่องนี้'],
      ['Invalid input: expected number, received string', 'รูปแบบข้อมูลไม่ถูกต้อง'],
      ['Invalid option: expected one of "a"|"b"', 'กรุณาเลือกตัวเลือกที่ถูกต้อง'],
      ['Too small: expected string to have >=3 characters', 'ต้องมีอย่างน้อย 3 ตัวอักษร'],
      ['Too small: expected string to have >=1 characters', 'กรุณากรอกข้อมูลช่องนี้'],
      ['Too big: expected string to have <=80 characters', 'ต้องมีไม่เกิน 80 ตัวอักษร'],
      ['Too small: expected array to have >=1 items', 'ต้องมีอย่างน้อย 1 รายการ'],
      ['Too big: expected array to have <=10 items', 'ต้องมีไม่เกิน 10 รายการ'],
      ['Too small: expected number to be >0', 'ต้องมากกว่า 0'],
      ['Too small: expected number to be >=1', 'ต้องไม่น้อยกว่า 1'],
      ['Too big: expected number to be <=1000000', 'ต้องไม่เกิน 1000000'],
      ['Invalid email address', 'อีเมลไม่ถูกต้อง'],
      ['Invalid URL', 'ลิงก์ (URL) ไม่ถูกต้อง'],
      ['Invalid ISO datetime', 'วันที่และเวลาไม่ถูกต้อง'],
      ['Invalid string: must match pattern /^[a-z]+$/', 'รูปแบบไม่ถูกต้อง'],
      ['Invalid number: must be a multiple of 5', 'ต้องเป็นผลคูณของ 5'],
      ['Unrecognized key: "extra"', 'มีข้อมูลที่ไม่รู้จัก: "extra"'],
    ];
    for (const [english, thai] of cases)
      expect(validationMessage('th', english), english).toBe(thai);
  });

  it('translates the messages Zod really produces for the shared schemas', () => {
    const issues = [
      ...(loginSchema.safeParse({ identifier: 'ab', extra: 1 }).error?.issues ?? []),
      ...(registerSchema.safeParse({
        email: 'not-an-email',
        password: 'x'.repeat(200),
        displayName: '',
      }).error?.issues ?? []),
    ];
    expect(issues.length).toBeGreaterThan(3);
    for (const issue of issues)
      expect(validationMessage('th', issue.message), issue.message).not.toBe(GENERIC_TH);
  });

  it('falls back to a generic Thai message', () => {
    expect(validationMessage('th', 'A brand new message nobody translated')).toBe(GENERIC_TH);
    expect(validationMessage('th', 'toString')).toBe(GENERIC_TH);
  });
});
