import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { ApiEnv } from '@farmplus/config/server';
import { HttpError } from '../lib/errors';

const passthrough: RequestHandler = (_req, _res, next) => next();

/** Per-client-IP fixed-window limiter. In-memory store: use a shared store (Redis) when running multiple API instances. */
export function limiter(env: ApiEnv, options: { windowMs: number; limit: number }): RequestHandler {
  if (!env.RATE_LIMIT_ENABLED) return passthrough;
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new HttpError(429, 'RATE_LIMITED', 'Too many requests, please try again later')),
  });
}

const MINUTE = 60_000;
export const rateLimits = (env: ApiEnv) => ({
  register: limiter(env, { windowMs: 60 * MINUTE, limit: 10 }),
  login: limiter(env, { windowMs: 15 * MINUTE, limit: 10 }),
  mfa: limiter(env, { windowMs: 15 * MINUTE, limit: 10 }),
  refresh: limiter(env, { windowMs: 15 * MINUTE, limit: 60 }),
  sensitive: limiter(env, { windowMs: 60 * MINUTE, limit: 10 }),
  /** Adding farm members by e-mail reveals whether an account exists, so it is throttled. */
  members: limiter(env, { windowMs: 60 * MINUTE, limit: 30 }),
  /** Community feed (Part 09). */
  post: limiter(env, { windowMs: 60 * MINUTE, limit: 30 }),
  comment: limiter(env, { windowMs: 60 * MINUTE, limit: 120 }),
  react: limiter(env, { windowMs: 60 * MINUTE, limit: 600 }),
  follow: limiter(env, { windowMs: 60 * MINUTE, limit: 120 }),
  report: limiter(env, { windowMs: 60 * MINUTE, limit: 30 }),
  /** Video & live (Part 10). */
  upload: limiter(env, { windowMs: 60 * MINUTE, limit: 20 }),
  view: limiter(env, { windowMs: 60 * MINUTE, limit: 1200 }),
  playback: limiter(env, { windowMs: 60 * MINUTE, limit: 1200 }),
  // processing-status polls from the upload screens: one every 3 s for their whole polling window
  videoRefresh: limiter(env, { windowMs: 15 * MINUTE, limit: 300 }),
  live: limiter(env, { windowMs: 60 * MINUTE, limit: 20 }),
  /** Marketplace (Part 11). */
  listing: limiter(env, { windowMs: 60 * MINUTE, limit: 40 }),
  offer: limiter(env, { windowMs: 60 * MINUTE, limit: 120 }),
  /** Orders & shipping (Part 12). */
  order: limiter(env, { windowMs: 60 * MINUTE, limit: 120 }),
  quote: limiter(env, { windowMs: 60 * MINUTE, limit: 60 }),
  /** Analytics (Part 16): dashboards are recalculated per request unless cached; exports are heavier. */
  dashboard: limiter(env, { windowMs: 60 * MINUTE, limit: 240 }),
  dashboardExport: limiter(env, { windowMs: 60 * MINUTE, limit: 30 }),
  /** Notifications & chat (Part 17). Sending is also capped per user in the database (settings), across instances. */
  notifications: limiter(env, { windowMs: 15 * MINUTE, limit: 600 }),
  chatRead: limiter(env, { windowMs: 15 * MINUTE, limit: 900 }),
  chatSend: limiter(env, { windowMs: 15 * MINUTE, limit: 120 }),
  /** AI assessments (Part 15). */
  assessment: limiter(env, { windowMs: 60 * MINUTE, limit: 60 }),
  /** Shop (Part 14): cart edits and reviews. */
  cart: limiter(env, { windowMs: 60 * MINUTE, limit: 600 }),
  review: limiter(env, { windowMs: 60 * MINUTE, limit: 30 }),
  /** Finance (Part 13): starting payments and withdrawals, and staff money actions. */
  payment: limiter(env, { windowMs: 60 * MINUTE, limit: 30 }),
  money: limiter(env, { windowMs: 60 * MINUTE, limit: 60 }),
});
