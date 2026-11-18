import { logger, serializeError } from './logger';

/**
 * Where unexpected errors go. The default writes a structured `error` log line (which the log platform can alert on).
 * To add an error tracker (Sentry, Rollbar, …) call `setErrorReporter` once at startup with an adapter; nothing else
 * changes. Reporters receive only the error and non-sensitive context (request id, route, status) — never bodies,
 * headers or tokens — and must not throw.
 */
export interface ErrorContext {
  requestId?: string | undefined;
  method?: string | undefined;
  route?: string | undefined;
  status?: number | undefined;
  source?: 'http' | 'process' | 'job' | undefined;
}
export type ErrorReporter = (error: unknown, context: ErrorContext) => void;

const logReporter: ErrorReporter = (error, context) =>
  logger.error('unhandled error', { ...context, error: serializeError(error) });

let reporter: ErrorReporter = logReporter;
export const setErrorReporter = (r: ErrorReporter | null): void => {
  reporter = r ?? logReporter;
};
export function reportError(error: unknown, context: ErrorContext = {}): void {
  try {
    reporter(error, context);
  } catch {
    logReporter(error, context); // a broken reporter must not hide the error
  }
}
