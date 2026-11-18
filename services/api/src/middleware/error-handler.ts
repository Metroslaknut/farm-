import type { ErrorRequestHandler } from 'express';
import type { ApiErrorResponse } from '@farmplus/shared-types';
import type { ApiEnv } from '@farmplus/config/server';
import { HttpError } from '../lib/errors';
import { reportError } from '../lib/error-reporter';

export function errorHandler(_env: ApiEnv): ErrorRequestHandler {
  // Express identifies error handlers by their 4-argument signature.
  return (err, req, res, _next) => {
    let status = 500;
    let body: ApiErrorResponse['error'] = {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    };

    if (err instanceof HttpError) {
      status = err.status;
      body = {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      };
    } else if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500) {
      // Errors raised by Express/body-parser (malformed JSON, payload too large, ...).
      status = err.status;
      body = { code: 'REQUEST_ERROR', message: String(err.message ?? 'Request error') };
    } else {
      // Unexpected failure: report it with the request id (the client only ever sees a generic message).
      reportError(err, {
        requestId: req.requestId,
        method: req.method,
        route: (req.originalUrl || req.url).split('?')[0],
        status,
        source: 'http',
      });
    }
    res.status(status).json({ error: body } satisfies ApiErrorResponse);
  };
}
