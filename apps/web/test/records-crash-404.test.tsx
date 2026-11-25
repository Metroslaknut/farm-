import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Link, MemoryRouter, Outlet } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { humanize } from '@farmplus/shared-utils';

/**
 * Staging QA 2026-11-25: B1 (switching record types crashed the page: "Cannot read properties of undefined
 * (reading 'replace')") and B2 (unknown /farms paths rendered a blank page).
 */
const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));
vi.mock('../src/auth/AuthContext', async () => ({
  AuthContext: (await import('react')).createContext(null),
  useAuth: () => ({ status: 'authenticated', user: { displayName: 'Somchai', roles: [] } }),
}));
// The real FarmShell/onboarding guard need many endpoints; this test is about FarmsApp's own routes.
vi.mock('../src/pages/farms/shell/FarmShell', async () => {
  const { RouteErrorBoundary } = await import('../src/components/layout/RouteErrorBoundary');
  return {
    FarmShell: () => (
      <RouteErrorBoundary>
        <Outlet />
      </RouteErrorBoundary>
    ),
  };
});
vi.mock('../src/pages/farms/RequireFarmSetup', () => ({ default: () => <Outlet /> }));

import FarmsApp from '../src/pages/farms/FarmsApp';
import { RouteErrorBoundary } from '../src/components/layout/RouteErrorBoundary';

const farm = {
  farm: {
    id: 'f1',
    name: 'Happy Farm',
    status: 'active',
    location: {},
    contact: {},
    myRole: 'owner',
    createdAt: '2026-01-01T00:00:00Z',
    access: { via: 'member', permissions: ['health.read', 'weight.read', 'expense.read'] },
    stats: { animalsTotal: 0, animalsActive: 0, byStatus: {} },
  },
};
const page = (items: object[]) => ({ items, page: 1, pageSize: 20, total: items.length });
const base = { farmId: 'f1', animal: { id: 'a1', animalCode: 'A-1' }, revision: 1 };

beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (_method: string, path: string) => {
    if (path === '/farms/f1') return farm;
    if (path === '/farms/f1/animals') return page([]);
    if (path === '/farms/f1/weights')
      return page([{ ...base, id: 'w1', weighedOn: '2026-03-01', weightKg: 250, method: 'scale' }]);
    if (path === '/farms/f1/health')
      return page([
        { ...base, id: 'h1', recordedOn: '2026-03-02', type: 'vaccination', title: 'FMD shot' },
      ]);
    if (path === '/farms/f1/expenses')
      return page([
        {
          ...base,
          id: 'e1',
          expenseDate: '2026-03-03',
          category: 'feed',
          description: 'Hay',
          amount: 120,
        },
      ]);
    if (path === '/farms/f1/expenses/summary')
      return { summary: { total: 120, byCategory: [], byMonth: [] } };
    throw new Error(`unexpected ${path}`);
  });
});

/** The app under /farms plus links that move between record types without leaving the list route. */
const renderFarms = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <nav>
        <Link to="/f1/health">go health</Link>
        <Link to="/f1/expenses">go expenses</Link>
      </nav>
      <FarmsApp />
    </MemoryRouter>,
  );

describe('B1: switching record types', () => {
  it('weights → health → expenses shows each list without crashing', async () => {
    const user = userEvent.setup();
    renderFarms('/f1/weights');
    expect(await screen.findByText('250')).toBeTruthy();

    await user.click(screen.getByRole('link', { name: 'go health' }));
    expect(await screen.findByText('FMD shot')).toBeTruthy();
    expect(screen.queryByText('250')).toBeNull();

    await user.click(screen.getByRole('link', { name: 'go expenses' }));
    expect(await screen.findByText('Hay')).toBeTruthy();
    expect(screen.queryByText('FMD shot')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('humanize never throws on a missing value', () => {
    expect(humanize(undefined)).toBe('');
    expect(humanize(null)).toBe('');
    expect(humanize('for_sale')).toBe('For sale');
  });
});

describe('B2: unknown paths under /farms', () => {
  it('shows "not found" instead of a blank page', async () => {
    renderFarms('/f1/no-such-page/really');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
  });
});

describe('route error boundary', () => {
  function Boom(): never {
    throw new Error('boom');
  }
  function Harness() {
    const [broken, setBroken] = useState(true);
    return (
      <>
        <button onClick={() => setBroken(false)}>fix</button>
        <Link to="/other">elsewhere</Link>
        <RouteErrorBoundary>{broken ? <Boom /> : <p>page ok</p>}</RouteErrorBoundary>
      </>
    );
  }

  it('shows a message inside the layout and recovers after navigating away', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/broken']}>
        <Harness />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Something went wrong on this page' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'fix' }));
    // Still on the same path: the message stays until the user leaves (or reloads).
    expect(screen.queryByText('page ok')).toBeNull();
    await user.click(screen.getByRole('link', { name: 'elsewhere' }));
    await waitFor(() => expect(screen.getByText('page ok')).toBeTruthy());
    spy.mockRestore();
  });
});
