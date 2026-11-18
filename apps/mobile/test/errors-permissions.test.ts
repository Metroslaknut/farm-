import { describe, expect, it } from 'vitest';
import { toViewError } from '../src/api/errors';
import { toResult } from '../src/lib/permission-result';

const apiError = (status?: number, message = 'msg') =>
  Object.assign(new Error(message), { name: 'ApiClientError', status });

describe('toViewError', () => {
  it('no response at all → offline', () => {
    expect(toViewError(apiError(undefined))).toMatchObject({ kind: 'offline' });
  });
  it('401 → unauthorized, 5xx → server, other 4xx → the server message', () => {
    expect(toViewError(apiError(401)).kind).toBe('unauthorized');
    expect(toViewError(apiError(503)).kind).toBe('server');
    expect(toViewError(apiError(409, 'Already exists'))).toEqual({
      kind: 'unknown',
      message: 'Already exists',
    });
  });
  it('unknown thrown values never leak internals', () => {
    expect(toViewError(new TypeError('x is not a function'))).toEqual({
      kind: 'unknown',
      message: 'Something went wrong. Please try again.',
    });
    expect(toViewError(null).kind).toBe('unknown');
  });
});

describe('permission results', () => {
  it('granted / denied (can ask again) / blocked (must open Settings)', () => {
    expect(toResult({ granted: true, canAskAgain: true })).toBe('granted');
    expect(toResult({ granted: false, canAskAgain: true })).toBe('denied');
    expect(toResult({ granted: false, canAskAgain: false })).toBe('blocked');
  });
});
