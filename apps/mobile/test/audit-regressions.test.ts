import { describe, expect, it, vi } from 'vitest';
import { formatAge } from '@farmplus/shared-utils';
import { createSessionManager } from '../src/auth/session-manager';
import { createMemoryTokenStorage } from '../src/auth/token-storage';

/**
 * Regression tests for mobile defects found in the full-system audit.
 * Each test reproduces the reported behaviour first; the fix makes it pass.
 */
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

describe('AUDIT-MO1: a temporary refresh failure does not sign the user out', () => {
  it('keeps the session on 429/5xx and ends it on 401', async () => {
    const storage = createMemoryTokenStorage();
    await storage.setRefreshToken('refresh-1');
    const exchange = vi.fn();
    const session = createSessionManager({ storage, exchange });
    const lost = vi.fn();
    session.onSessionLost(lost);
    for (const status of [429, 408, 503]) {
      exchange.mockRejectedValueOnce(httpError(status));
      expect(await session.refresh()).toBe(false);
      expect(await storage.getRefreshToken(), String(status)).toBe('refresh-1');
    }
    expect(lost).not.toHaveBeenCalled();
    exchange.mockRejectedValueOnce(httpError(401));
    expect(await session.refresh()).toBe(false);
    expect(await storage.getRefreshToken()).toBeNull();
    expect(lost).toHaveBeenCalledTimes(1);
  });
});

describe('AUDIT-MO6: ages count on the Thai calendar', () => {
  it('an animal born today (Thai date) is 0 days old between 00:00 and 07:00 in Bangkok', () => {
    const now = new Date('2026-10-13T23:30:00Z'); // 06:30 on 14 Oct in Bangkok
    expect(formatAge('2026-10-14', now)).toBe('0 d');
    expect(formatAge('2026-10-15', now)).toBeUndefined();
  });
});
