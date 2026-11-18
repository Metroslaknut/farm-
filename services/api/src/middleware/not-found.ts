import type { RequestHandler } from 'express';
import type { ApiErrorResponse } from '@farmplus/shared-types';

export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ApiErrorResponse = {
    error: { code: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.path}` },
  };
  res.status(404).json(body);
};
