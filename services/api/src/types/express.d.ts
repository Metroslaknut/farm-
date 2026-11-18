import type { Actor } from '../context';

declare global {
  namespace Express {
    interface Request {
      /** Set by the `authenticate` middleware. */
      actor?: Actor;
      /** Set by the request-context middleware (also returned as X-Request-Id). */
      requestId?: string;
    }
  }
}

export {};
