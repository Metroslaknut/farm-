import type { RequestHandler } from 'express';

const PROBES = new Set(['/health', '/ready', '/api/v1/health', '/api/v1/ready']);

/**
 * Production only. TLS ends at the load balancer, which forwards `X-Forwarded-Proto`; with `trust proxy` configured
 * Express turns that into `req.secure`. Plain-HTTP requests are redirected (GET/HEAD) or refused (everything else —
 * a redirect would make a client resend credentials in the clear), so tokens are never accepted over HTTP.
 * Health/readiness probes are exempt: orchestrators call them over the private network without TLS.
 */
export function requireHttps(): RequestHandler {
  return (req, res, next) => {
    if (req.secure || PROBES.has(req.path)) return next();
    if (req.method === 'GET' || req.method === 'HEAD') {
      const host = req.get('host');
      // Never redirect to a host we did not expect from the request itself; refuse a missing/odd Host.
      if (host && /^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(host)) {
        res.redirect(308, `https://${host}${req.originalUrl}`);
        return;
      }
    }
    res.status(400).json({ error: { code: 'HTTPS_REQUIRED', message: 'Use HTTPS' } });
  };
}

/** API responses can carry personal and financial data: never let a browser or proxy cache them. */
export const noStore: RequestHandler = (_req, res, next) => {
  if (!res.getHeader('cache-control')) res.setHeader('cache-control', 'no-store');
  next();
};
