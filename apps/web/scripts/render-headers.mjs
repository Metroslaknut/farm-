import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Static-host security configuration, generated at build time from the built `index.html` and the deployment's own
 * origins (so nothing environment-specific is committed). Output: `dist/_headers` and `dist/_redirects`, the format
 * understood by Cloudflare Pages and Netlify; for other hosts copy the same headers into their configuration.
 *
 * Content-Security-Policy highlights:
 *  - `script-src 'self'` plus the SHA-256 of each inline script in index.html (the theme bootstrap) — no 'unsafe-inline' for scripts;
 *  - `connect-src` is this site, the API origin (https + the matching wss for Socket.IO) and the streaming/CDN hosts;
 *  - `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `upgrade-insecure-requests`.
 * Inline STYLES are allowed ('unsafe-inline' for style-src only): the design system sets style attributes. That is a
 * conscious, documented trade-off (docs/ops/deployment.md) — styles cannot execute code.
 */
const DEFAULT_MEDIA_HOSTS = ['https://*.cloudflarestream.com'];

const hostList = (value) =>
  String(value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

export function originOf(url, label) {
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} must be an absolute URL, got "${url}"`);
  }
  if (parsed.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(parsed.hostname))
    throw new Error(`${label} must be https (got ${parsed.protocol}//)`);
  return parsed.origin;
}

export function inlineScriptHashes(html) {
  const hashes = [];
  for (const match of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = match[1];
    if (body && body.trim())
      hashes.push(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
  }
  return hashes;
}

export function buildCsp({ apiOrigin, mediaHosts = DEFAULT_MEDIA_HOSTS, scriptHashes = [] }) {
  const connect = [
    "'self'",
    ...(apiOrigin ? [apiOrigin, apiOrigin.replace(/^http/, 'ws')] : []),
    ...mediaHosts,
  ];
  return [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    // The API origin serves photos uploaded from devices (`/api/v1/animal-photos/…`).
    `img-src 'self' data: blob: ${[...(apiOrigin ? [apiOrigin] : []), ...mediaHosts].join(' ')}`.trim(),
    `media-src 'self' blob: ${mediaHosts.join(' ')}`.trim(),
    `connect-src ${connect.join(' ')}`,
    "worker-src 'self' blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

export function buildHeaders({ html, apiBase, mediaHosts }) {
  const apiOrigin = originOf(apiBase, 'VITE_API_BASE_URL');
  const hosts = mediaHosts?.length ? mediaHosts : DEFAULT_MEDIA_HOSTS;
  for (const h of hosts)
    if (!/^https:\/\/[A-Za-z0-9*.-]+(:\d+)?$/.test(h))
      throw new Error(`WEB_MEDIA_HOSTS entry "${h}" must look like https://host`);
  const csp = buildCsp({ apiOrigin, mediaHosts: hosts, scriptHashes: inlineScriptHashes(html) });
  const headers = [
    '/*',
    `  Content-Security-Policy: ${csp}`,
    '  Strict-Transport-Security: max-age=15552000; includeSubDomains',
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: DENY',
    '  Referrer-Policy: no-referrer',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    '  Cross-Origin-Opener-Policy: same-origin',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/index.html',
    '  Cache-Control: no-cache',
    '',
  ].join('\n');
  // Single-page app: every path that is not a file serves index.html (client-side routing).
  const redirects = '/*  /index.html  200\n';
  return { headers, redirects, csp };
}

function main() {
  const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  const indexPath = join(dist, 'index.html');
  if (!existsSync(indexPath)) throw new Error('dist/index.html not found: run `vite build` first');
  const apiBase = process.env.VITE_API_BASE_URL ?? '';
  if (process.env.WEB_REQUIRE_API_BASE === 'true' && !apiBase)
    throw new Error(
      'VITE_API_BASE_URL is required for this build (the browser must know where the API is)',
    );
  const out = buildHeaders({
    html: readFileSync(indexPath, 'utf8'),
    apiBase,
    mediaHosts: hostList(process.env.WEB_MEDIA_HOSTS),
  });
  writeFileSync(join(dist, '_headers'), out.headers);
  writeFileSync(join(dist, '_redirects'), out.redirects);
  process.stdout.write('wrote dist/_headers and dist/_redirects\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
