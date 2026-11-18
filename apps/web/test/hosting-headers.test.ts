import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCsp,
  buildHeaders,
  inlineScriptHashes,
  originOf,
} from '../scripts/render-headers.mjs';

// (vitest runs with the package directory as cwd; jsdom's URL cannot resolve file: URLs)
const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

describe('static hosting security headers', () => {
  it('hashes the inline theme script instead of allowing inline scripts', () => {
    const [hash] = inlineScriptHashes(html);
    const body = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
    expect(hash).toBe(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
    expect(inlineScriptHashes('<script src="/a.js"></script>')).toEqual([]); // external scripts need no hash
    const { csp } = buildHeaders({ html, apiBase: 'https://api.example.com' });
    expect(csp).toContain(hash);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-eval/);
  });

  it('allows only this site, the API (https and wss) and the configured media hosts to be contacted', () => {
    const { csp } = buildHeaders({
      html,
      apiBase: 'https://api.example.com',
      mediaHosts: ['https://cdn.example.com'],
    });
    expect(csp).toContain(
      "connect-src 'self' https://api.example.com wss://api.example.com https://cdn.example.com",
    );
    expect(csp).toContain(
      "img-src 'self' data: blob: https://api.example.com https://cdn.example.com",
    );
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).not.toMatch(/\*(?!\.)/); // no bare wildcard source
    expect(buildCsp({ apiOrigin: null }).includes('https://*.cloudflarestream.com')).toBe(true); // default stream host
  });

  it('emits the other headers, long-lived caching for hashed assets, and the SPA fallback', () => {
    const out = buildHeaders({ html, apiBase: 'https://api.example.com' });
    for (const line of [
      'Strict-Transport-Security: max-age=15552000; includeSubDomains',
      'X-Content-Type-Options: nosniff',
      'X-Frame-Options: DENY',
      'Referrer-Policy: no-referrer',
      'Cross-Origin-Opener-Policy: same-origin',
      'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    ])
      expect(out.headers).toContain(line);
    expect(out.headers).toMatch(
      /\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable/,
    );
    expect(out.headers).toMatch(/\/index\.html\n {2}Cache-Control: no-cache/);
    expect(out.redirects).toBe('/*  /index.html  200\n');
  });

  it('refuses an insecure API origin, malformed hosts and non-URLs', () => {
    expect(() => originOf('http://api.example.com', 'X')).toThrow(/https/);
    expect(originOf('http://localhost:4000', 'X')).toBe('http://localhost:4000'); // local rehearsal only
    expect(() => originOf('not a url', 'X')).toThrow(/absolute URL/);
    expect(() =>
      buildHeaders({
        html,
        apiBase: 'https://api.example.com',
        mediaHosts: ['http://cdn.example.com'],
      }),
    ).toThrow(/https/);
    expect(() =>
      buildHeaders({
        html,
        apiBase: 'https://api.example.com',
        mediaHosts: ['https://cdn.example.com; script-src *'],
      }),
    ).toThrow();
    expect(originOf('', 'X')).toBeNull();
  });
});
