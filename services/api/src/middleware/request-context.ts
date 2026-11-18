import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { logger } from '../lib/logger';

const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Gives every request an id (a caller-supplied `X-Request-Id` is kept only if it is a harmless token, so log lines
 * cannot be forged), returns it in the response, and writes ONE access-log line when the response finishes.
 *
 * What is logged: method, route path WITHOUT the query string (queries can carry tokens), status, duration, request id,
 * and the user id once authenticated. What is not: bodies, headers, query strings, IP addresses (personal data; the
 * audit log keeps the IP where a security investigation needs it).
 */
export function requestContext(options: { skipPaths?: string[] } = {}): RequestHandler {
  const skip = new Set(options.skipPaths ?? []);
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    req.requestId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader('x-request-id', req.requestId);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const path = (req.originalUrl || req.url).split('?')[0] ?? '';
      if (skip.has(path)) return; // probes hit these every few seconds
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const status = res.statusCode;
      const line = {
        requestId: req.requestId,
        method: req.method,
        path,
        status,
        durationMs: Math.round(ms),
        ...(req.actor ? { userId: req.actor.userId } : {}),
      };
      if (status >= 500) logger.error('request failed', line);
      else if (status >= 400) logger.warn('request rejected', line);
      else logger.info('request', line);
    });
    next();
  };
}
