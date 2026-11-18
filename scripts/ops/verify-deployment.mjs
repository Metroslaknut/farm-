#!/usr/bin/env node
/**
 * Post-deploy verification of a running FARM+ environment (staging first, then production).
 *
 *   node scripts/ops/verify-deployment.mjs --api https://api.staging.example.com \
 *        --web https://app.staging.example.com --origin https://app.staging.example.com
 *
 * Read-only: it sends GETs, a CORS preflight and one unsigned webhook POST that must be rejected. It creates no data and
 * needs no credentials. TLS certificates are ALWAYS verified — there is deliberately no option to skip that; a
 * certificate error is a deployment defect to fix, not to bypass. Plain http:// is accepted only for localhost, to
 * rehearse the script itself (HTTPS-only checks are then reported as skipped).
 *
 * Exit code 0 = every check passed (skips are not failures), 1 = at least one failed.
 */
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

export function parseTarget(url, label) {
  if (!url) return null;
  const u = new URL(url);
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local))
    throw new Error(
      `${label} must be https:// (http:// is only accepted for localhost rehearsals)`,
    );
  return { base: u.origin, https: u.protocol === 'https:' };
}

export async function run({ api, web, origin, fetchImpl = fetch }) {
  const results = [];
  const record = (name, ok, detail = '') =>
    results.push({ name, status: ok ? 'pass' : 'fail', detail });
  const skip = (name, why) => results.push({ name, status: 'skip', detail: why });
  const check = async (name, fn) => {
    try {
      const outcome = await fn();
      if (outcome === 'skip') return;
      if (outcome && typeof outcome === 'object') record(name, true, outcome.detail);
      else
        record(
          name,
          outcome === true || outcome === undefined,
          typeof outcome === 'string' ? outcome : '',
        );
    } catch (error) {
      record(name, false, `${error.cause?.code ?? error.name}: ${error.message}`.slice(0, 200));
    }
  };
  const get = (base, path, headers = {}, init = {}) =>
    fetchImpl(`${base}${path}`, { redirect: 'manual', headers, ...init });

  if (api) {
    const A = api.base;
    let health;
    await check('API /health is up and identifies the build', async () => {
      const res = await get(A, '/health');
      health = await res.json();
      if (res.status !== 200 || health.status !== 'ok') return `status ${res.status}`;
      return {
        detail: `deployment=${health.deployment ?? '?'} commit=${health.commit ?? 'unknown'} version=${health.version}`,
      };
    });
    await check('API /ready: database reachable, not shutting down', async () => {
      const res = await get(A, '/ready');
      const body = await res.json();
      return res.status === 200 && body.status === 'ready' && body.checks?.database === 'up'
        ? true
        : `status ${res.status} ${JSON.stringify(body.checks ?? {})}`;
    });
    await check('Production hardening is on (not a development build)', async () =>
      health?.environment === 'production'
        ? true
        : `environment=${health?.environment} (expected production, also for staging)`,
    );
    await check('Responses carry a request id', async () =>
      Boolean((await get(A, '/health')).headers.get('x-request-id')),
    );

    if (api.https) {
      await check('HSTS is sent over HTTPS', async () => {
        const h = (await get(A, '/api/v1/health')).headers.get('strict-transport-security') ?? '';
        const age = Number(/max-age=(\d+)/.exec(h)?.[1] ?? 0);
        return age >= 15_552_000 ? true : `got "${h}"`;
      });
      await check('Plain HTTP is redirected to HTTPS (or refused)', async () => {
        const res = await get(A.replace('https:', 'http:'), '/api/v1/health').catch(() => null);
        if (!res) return true; // port 80 closed is fine
        return [301, 302, 307, 308].includes(res.status) &&
          (res.headers.get('location') ?? '').startsWith('https://')
          ? true
          : `status ${res.status}`;
      });
    } else skip('HSTS / HTTP→HTTPS redirect', 'local http rehearsal');

    await check(
      'Security headers (nosniff, no x-powered-by, no-store, referrer policy)',
      async () => {
        const h = (await get(A, '/api/v1/health')).headers;
        const bad = [];
        if (h.get('x-content-type-options') !== 'nosniff') bad.push('x-content-type-options');
        if (h.get('x-powered-by')) bad.push('x-powered-by present');
        if (h.get('cache-control') !== 'no-store') bad.push('cache-control');
        if (h.get('referrer-policy') !== 'no-referrer') bad.push('referrer-policy');
        return bad.length === 0 ? true : bad.join(', ');
      },
    );
    if (origin) {
      await check('CORS: the web origin is allowed, exactly', async () => {
        const res = await get(A, '/api/v1/health', { origin });
        return res.headers.get('access-control-allow-origin') === origin &&
          !res.headers.get('access-control-allow-credentials')
          ? true
          : `allow-origin=${res.headers.get('access-control-allow-origin')}`;
      });
      await check('CORS: other origins are not allowed', async () => {
        const sibling = `${new URL(origin).protocol}//x.${new URL(origin).host}`;
        for (const o of ['https://evil.invalid', sibling]) {
          const res = await get(A, '/api/v1/health', { origin: o });
          if (res.headers.get('access-control-allow-origin')) return `${o} was allowed`;
        }
        return true;
      });
      await check('CORS preflight allows only the expected methods', async () => {
        const res = await get(
          A,
          '/api/v1/orders',
          {
            origin,
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'authorization,content-type',
          },
          { method: 'OPTIONS' },
        );
        const m = res.headers.get('access-control-allow-methods') ?? '';
        return res.status === 204 && !/\b(TRACE|CONNECT)\b/.test(m) && m.includes('POST')
          ? true
          : `status ${res.status} methods=${m}`;
      });
    } else skip('CORS checks', 'no --origin given');

    await check(
      'Protected endpoints refuse anonymous callers (401, JSON error, no stack)',
      async () => {
        const res = await get(A, '/api/v1/auth/me');
        const text = await res.text();
        return res.status === 401 && /"error"/.test(text) && !/\bat\s+\S+\s+\(/.test(text)
          ? true
          : `status ${res.status}`;
      },
    );
    await check('Unknown routes return a JSON 404', async () => {
      const res = await get(A, '/api/v1/definitely-not-a-route');
      return res.status === 404 && (res.headers.get('content-type') ?? '').includes('json')
        ? true
        : `status ${res.status}`;
    });
    await check(
      'Development-only endpoints are absent',
      async () => (await get(A, '/api/v1/media/dev/probe')).status === 404,
    );
    await check('Webhooks reject unsigned requests', async () => {
      const res = await get(
        A,
        '/api/v1/webhooks/payments',
        { 'content-type': 'application/json' },
        { method: 'POST', body: '{"id":"x","type":"charge.succeeded","data":{}}' },
      );
      return [401, 403, 404].includes(res.status)
        ? true
        : `status ${res.status} (must not accept unsigned events)`;
    });
    await check('Rate limiting is active (limit headers present on auth routes)', async () => {
      const res = await get(
        A,
        '/api/v1/auth/login',
        { 'content-type': 'application/json' },
        {
          method: 'POST',
          body: JSON.stringify({
            identifier: 'verify@invalid.example',
            password: 'not-a-real-password',
          }),
        },
      );
      return [...res.headers.keys()].some((k) => k.startsWith('ratelimit'))
        ? true
        : 'no RateLimit headers: is RATE_LIMIT_ENABLED=true?';
    });
  }

  if (web) {
    const W = web.base;
    let indexHtml = '';
    await check('Web: index.html is served', async () => {
      const res = await get(W, '/');
      indexHtml = await res.text();
      return res.status === 200 && /<div id="root">/.test(indexHtml)
        ? true
        : `status ${res.status}`;
    });
    await check('Web: single-page-app routes fall back to index.html', async () => {
      const res = await get(W, '/farms/some-deep-link');
      return res.status === 200 && /<div id="root">/.test(await res.text())
        ? true
        : `status ${res.status}`;
    });
    await check(
      'Web: Content-Security-Policy forbids inline/eval scripts and framing',
      async () => {
        const csp = (await get(W, '/')).headers.get('content-security-policy') ?? '';
        const script = /script-src([^;]*)/.exec(csp)?.[1] ?? '';
        const bad = [];
        if (!csp) bad.push('no CSP');
        if (/'unsafe-inline'|'unsafe-eval'/.test(script)) bad.push('script-src allows unsafe code');
        if (!/frame-ancestors 'none'/.test(csp)) bad.push('frame-ancestors');
        if (!/object-src 'none'/.test(csp)) bad.push('object-src');
        if (api && !csp.includes(api.base)) bad.push('connect-src does not list the API origin');
        return bad.length === 0 ? true : bad.join(', ');
      },
    );
    if (web.https)
      await check('Web: HSTS, nosniff, frame and referrer headers', async () => {
        const h = (await get(W, '/')).headers;
        const bad = [];
        if (!/max-age=\d{7,}/.test(h.get('strict-transport-security') ?? '')) bad.push('hsts');
        if (h.get('x-content-type-options') !== 'nosniff') bad.push('nosniff');
        if (h.get('x-frame-options') !== 'DENY') bad.push('x-frame-options');
        if (h.get('referrer-policy') !== 'no-referrer') bad.push('referrer-policy');
        return bad.length === 0 ? true : bad.join(', ');
      });
    else skip('Web: HSTS and header set', 'local http rehearsal');
    await check('Web: hashed assets are cached long-term, index.html is not', async () => {
      const asset = /(?:src|href)="(\/assets\/[^"]+)"/.exec(indexHtml)?.[1];
      if (!asset) return 'no /assets reference found in index.html';
      const a = (await get(W, asset)).headers.get('cache-control') ?? '';
      const i = (await get(W, '/')).headers.get('cache-control') ?? '';
      return /immutable/.test(a) && /no-cache|no-store|max-age=0/.test(i)
        ? true
        : `asset="${a}" index="${i}"`;
    });
  }
  return results;
}

async function main() {
  const api = parseTarget(opt('--api'), '--api');
  const web = parseTarget(opt('--web'), '--web');
  const origin = opt('--origin');
  if (!api && !web) {
    process.stderr.write(
      'usage: verify-deployment.mjs --api <url> [--web <url>] [--origin <web origin>] [--json]\n',
    );
    process.exit(2);
  }
  const results = await run({ api, web, origin });
  if (args.includes('--json')) process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  else
    for (const r of results) {
      const mark = r.status === 'pass' ? 'PASS' : r.status === 'skip' ? 'skip' : 'FAIL';
      process.stdout.write(`${mark}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}\n`);
    }
  const failed = results.filter((r) => r.status === 'fail').length;
  process.stdout.write(
    `\n${results.length - failed} of ${results.length} checks ok${failed ? `, ${failed} FAILED` : ''}\n`,
  );
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
