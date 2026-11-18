import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type TestHarness } from '../helpers';
import { createShopWorld, type ShopWorld } from '../shop-fixtures';

/**
 * Regression tests for shop moderation defects found in the second full-system audit.
 * Each test reproduces the reported behaviour first; the fix makes it pass.
 */
let h: TestHarness;
let w: ShopWorld;
beforeAll(async () => {
  h = await startHarness();
  w = await createShopWorld(h);
});
afterAll(() => h.stop());

describe('AUDIT2-S1: a material edit made while a product is paused needs a new review', () => {
  it('pause → change title/text → resume cannot publish unreviewed content', async () => {
    const s = await w.seller();
    const p = await w.live(s);
    const buyer = await w.buyer();
    const base = `/farms/${s.farmId}/products/${p.id}`;
    expect((await w.call('post', s.user, `${base}/pause`)).body.product.status).toBe('PAUSED');

    const edit = await w.call('patch', s.user, base, {
      title: 'A completely different product',
      description: 'Rewritten after approval while paused.',
    });
    expect(edit.status).toBe(200);
    expect(edit.body.product.status).toBe('PENDING_REVIEW');

    const resume = await w.call('post', s.user, `${base}/resume`);
    expect(resume.status).toBe(409);
    expect((await w.call('get', buyer, `/shop/products/${p.id}`)).status).toBe(404);

    await w.call('post', w.mod, `/shop/moderation/products/${p.id}/approve`);
    expect((await w.call('get', buyer, `/shop/products/${p.id}`)).status).toBe(200);
  });

  it('routine edits (price, stock limits) on a paused product keep it paused and resumable', async () => {
    const s = await w.seller();
    const p = await w.live(s);
    const base = `/farms/${s.farmId}/products/${p.id}`;
    await w.call('post', s.user, `${base}/pause`);
    const edit = await w.call('patch', s.user, base, { priceMinor: 123_400 });
    expect(edit.body.product.status).toBe('PAUSED');
    expect((await w.call('post', s.user, `${base}/resume`)).body.product.status).toBe('ACTIVE');
  });
});
