import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseTarget, run } from '../../../scripts/ops/verify-deployment.mjs';
import { startHarness, type TestHarness } from './helpers';

let h: TestHarness;
let server: Server;
let base: string;
const ORIGIN = 'http://localhost:5173';
beforeAll(async () => {
  h = await startHarness({ RATE_LIMIT_ENABLED: 'true', CORS_ORIGINS: ORIGIN });
  server = createServer(h.app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.close();
  await h.stop();
});

const byName = (results: { name: string; status: string; detail: string }[], part: string) =>
  results.find((r) => r.name.includes(part))!;

describe('deployment verification script', () => {
  it('passes every check that can apply to a local rehearsal, and flags that it is not a production build', async () => {
    const results = await run({ api: parseTarget(base, '--api'), origin: ORIGIN });
    const failed = results.filter((r) => r.status === 'fail').map((r) => r.name);
    // The harness runs with NODE_ENV=test, so exactly the "production hardening" check must fail — proving it can fail.
    expect(failed).toEqual(['Production hardening is on (not a development build)']);
    expect(byName(results, 'HSTS').status).toBe('skip');
    expect(byName(results, '/ready').status).toBe('pass');
    expect(byName(results, 'CORS: the web origin').status).toBe('pass');
    expect(byName(results, 'Webhooks reject unsigned').status).toBe('pass');
    expect(byName(results, 'Rate limiting').status).toBe('pass');
  });

  it('fails when an origin that should be allowed is not, and when the API is unreachable or not ready', async () => {
    const wrong = await run({ api: parseTarget(base, '--api'), origin: 'http://localhost:9999' });
    expect(byName(wrong, 'CORS: the web origin').status).toBe('fail');
    const down = await run({ api: { base: 'http://127.0.0.1:1', https: false } });
    expect(down.filter((r) => r.status === 'fail').length).toBeGreaterThan(3);
    const notReady = await run({
      api: parseTarget(base, '--api'),
      fetchImpl: (async (url: string, init?: RequestInit) =>
        String(url).endsWith('/ready')
          ? new Response(JSON.stringify({ status: 'not_ready', checks: { database: 'down' } }), {
              status: 503,
            })
          : fetch(url, init)) as typeof fetch,
    });
    expect(byName(notReady, '/ready').status).toBe('fail');
  });

  it('reports a leaking server (stack traces, x-powered-by) as a failure', async () => {
    const leaky = (async (url: string, init?: RequestInit) => {
      const res = await fetch(url, init);
      if (String(url).endsWith('/api/v1/health')) {
        const headers = new Headers(res.headers);
        headers.set('x-powered-by', 'Express');
        return new Response(await res.text(), { status: res.status, headers });
      }
      return res;
    }) as typeof fetch;
    const results = await run({ api: parseTarget(base, '--api'), fetchImpl: leaky });
    expect(byName(results, 'Security headers').status).toBe('fail');
    expect(byName(results, 'Security headers').detail).toContain('x-powered-by');
  });

  it('only accepts https targets, except localhost for rehearsals; there is no way to skip certificate checks', () => {
    expect(() => parseTarget('http://api.example.com', '--api')).toThrow(/https/);
    expect(parseTarget('https://api.example.com/x', '--api')).toEqual({
      base: 'https://api.example.com',
      https: true,
    });
    expect(parseTarget('http://localhost:4000', '--api')?.https).toBe(false);
    expect(parseTarget(undefined, '--api')).toBeNull();
  });
});
