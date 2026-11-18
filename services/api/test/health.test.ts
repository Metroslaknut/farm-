import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@farmplus/validation';
import { startHarness, type TestHarness } from './helpers';

let h: TestHarness;
let server: Server;
let base: string;

beforeAll(async () => {
  h = await startHarness();
  server = h.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await h.stop();
});

describe('health endpoints', () => {
  it.each(['/health', '/api/v1/health'])('GET %s returns a valid payload', async (path) => {
    const res = await fetch(`${base}${path}`);
    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(await res.json());
    expect(body.status).toBe('ok');
    expect(body.environment).toBe('test');
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await fetch(`${base}/api/v1/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
