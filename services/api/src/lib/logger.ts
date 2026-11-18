/**
 * Structured logging: one JSON object per line on stdout/stderr, which every log platform (CloudWatch, Datadog, Loki,
 * Cloud Logging …) ingests without configuration. No dependency, so it also runs in the worker.
 *
 * Privacy/security rules, enforced here rather than left to callers:
 *  - values under sensitive keys (authorization, password, token, secret, cookie, key, …) are replaced by "[redacted]";
 *  - credentials inside connection strings and bearer tokens inside text are masked;
 *  - request/response bodies and query strings are never logged by the HTTP layer.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|cookie|api[-_]?key|private|credential|signature|otp|mfa|^key$|dsn|uri/i;
const URI_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/gi;
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

export const maskText = (text: string): string =>
  text.replace(URI_CREDENTIALS, '$1$2:[redacted]@').replace(BEARER, '$1 [redacted]');

export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return maskText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 6) return '[truncated]';
  if (value instanceof Error) return serializeError(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>))
    out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
  return out;
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: maskText(String(error)) };
  return {
    name: error.name,
    message: maskText(error.message),
    ...(error.stack ? { stack: maskText(error.stack) } : {}),
    ...((error as { code?: unknown }).code !== undefined
      ? { code: (error as { code?: unknown }).code }
      : {}),
  };
}

export type LogSink = (level: LogLevel, line: string) => void;
const consoleSink: LogSink = (level, line) => {
  if (process.env['NODE_ENV'] === 'test') return; // keep test output clean; tests that care install their own sink
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(`${line}\n`);
};

let sink: LogSink = consoleSink;
let threshold: LogLevel = 'info';
let base: Record<string, unknown> = {};

/** Configure once at startup (and in tests). */
export function configureLogger(options: {
  level?: LogLevel;
  sink?: LogSink | null;
  base?: Record<string, unknown>;
}): void {
  if (options.level) threshold = options.level;
  if (options.sink !== undefined) sink = options.sink ?? consoleSink;
  if (options.base) base = options.base;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

function make(bound: Record<string, unknown>): Logger {
  const emit = (level: LogLevel, msg: string, fields: Record<string, unknown> = {}) => {
    if (RANK[level] < RANK[threshold]) return;
    const entry = {
      ts: new Date().toISOString(),
      level,
      msg: maskText(msg),
      ...base,
      ...(redact({ ...bound, ...fields }) as Record<string, unknown>),
    };
    try {
      sink(level, JSON.stringify(entry));
    } catch {
      /* logging must never throw into the request path */
    }
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (f) => make({ ...bound, ...f }),
  };
}

export const logger: Logger = make({});
