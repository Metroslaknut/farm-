/**
 * Reviewed allow-lists for the authorization matrix. Adding to any of these is a SECURITY DECISION: write the reason next to
 * the entry and have it reviewed. The tests fail on any route that behaves more openly than listed.
 */

/** Routes any caller may reach WITHOUT signing in, and why. */
export const PUBLIC_ANONYMOUS: Record<string, string> = {
  'GET /health': 'liveness probe',
  'GET /ready': 'readiness probe',
  'GET /api/v1/health': 'liveness probe',
  'GET /api/v1/ready': 'readiness probe',
  'POST /api/v1/auth/register': 'sign-up (rate limited, validated, buyer role only)',
  'POST /api/v1/auth/login': 'sign-in (rate limited, lockout)',
  'POST /api/v1/auth/mfa/verify': 'second factor, needs a short-lived mfa token',
  'POST /api/v1/auth/refresh': 'needs a valid refresh token (rotation + reuse detection)',
  'POST /api/v1/auth/password/forgot': 'does not reveal whether the account exists',
  'POST /api/v1/auth/password/reset': 'needs a single-use emailed token',
  'POST /api/v1/auth/verify/resend': 'does not reveal whether the account exists',
  'POST /api/v1/auth/verify/email': 'needs a single-use emailed token',
  'POST /api/v1/auth/verify/phone': 'needs a one-time code (5 guesses)',
  'GET /api/v1/auth/oauth/providers': 'which social sign-in buttons to show (provider names only)',
  'GET /api/v1/auth/oauth/:provider/start':
    'starts Google/Facebook sign-in; the return URL must be on OAUTH_RETURN_URLS (rate limited)',
  'GET /api/v1/auth/oauth/:provider/callback':
    'provider redirect; needs a single-use 10-minute state (rate limited)',
  'POST /api/v1/auth/oauth/exchange':
    'needs a single-use 2-minute ticket AND the verifier of the device that started (rate limited)',
  'POST /api/v1/media/dev/uploads/:id':
    'development mock provider only (absent in production, see ops tests)',
  'GET /api/v1/media/dev/files/:id':
    'development mock provider only (absent in production, see ops tests)',
  'GET /api/v1/animal-photos/:key':
    'device-uploaded animal photo for <img> tags (no token possible); the 192-bit random key is the capability, images only',
};

/** Signature-authenticated machine endpoints: anonymous callers must be refused (401), never served. */
export const WEBHOOKS = [
  'POST /api/v1/webhooks/video',
  'POST /api/v1/webhooks/shipping',
  'POST /api/v1/webhooks/payments',
];

/** Routes a signed-in user with NO roles and NO farm may successfully call: personal data and public browsing only. */
export const SELF_SERVICE: Set<string> = new Set([
  'GET /api/v1/health',
  'GET /api/v1/ready',
  'GET /api/v1/auth/me',
  'GET /api/v1/auth/oauth/providers',
  'GET /api/v1/users/me',
  'DELETE /api/v1/users/:id/follow',
  'GET /api/v1/registrations/mine',
  'GET /api/v1/farms',
  // Onboarding state of the caller only (their own memberships + whether they may create a farm).
  'GET /api/v1/farms/me',
  // The caller's own farm invitations and join requests (scoped to userId; nothing about other people).
  'GET /api/v1/farm-invitations',
  'GET /api/v1/animal-types',
  'GET /api/v1/posts',
  'GET /api/v1/marketplace/listings',
  'GET /api/v1/marketplace/favorites',
  'DELETE /api/v1/marketplace/listings/:id/favorite',
  'GET /api/v1/marketplace/negotiations',
  'GET /api/v1/shop/categories',
  'GET /api/v1/shop/products',
  'GET /api/v1/shop/products/:id/reviews',
  'GET /api/v1/shop/cart',
  'DELETE /api/v1/shop/cart/items/:productId',
  'DELETE /api/v1/shop/cart',
  'GET /api/v1/orders',
  'GET /api/v1/videos/limits',
  'GET /api/v1/videos',
  'GET /api/v1/live',
  'GET /api/v1/wallet',
  'GET /api/v1/wallet/transactions',
  'GET /api/v1/wallet/withdrawals',
  'GET /api/v1/notifications',
  'GET /api/v1/notifications/unread-count',
  'GET /api/v1/notifications/preferences',
  'POST /api/v1/notifications/read-all',
  'GET /api/v1/conversations',
  'GET /api/v1/analytics/definitions',
]);
