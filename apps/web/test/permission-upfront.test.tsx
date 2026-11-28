import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Decided 28 Nov 2026: say what is not allowed up front, instead of after "Save" / "Create". */
const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));
vi.mock('../src/auth/AuthContext', async () => ({
  AuthContext: (await import('react')).createContext(null),
  useAuth: () => ({ status: 'authenticated', user: { id: 'u1', displayName: 'S', roles: [] } }),
}));

import FarmListPage from '../src/pages/farms/FarmListPage';
import { SellFarmsPage as MarketSellPage } from '../src/pages/market/SellPages';
import { SellFarmsPage as ShopSellPage } from '../src/pages/shop/SellPages';
import LiveHostPage from '../src/pages/live/LiveHostPage';

const page = (items: object[] = []) => ({ items, page: 1, pageSize: 50, total: items.length });
let canCreateFarm = true;
let canSell = true;
let canHost = true;
beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (_m: string, path: string) => {
    if (path === '/farms/me') return { status: 'not_applicable', canCreateFarm, farms: [] };
    if (path === '/farms') return page();
    if (path === '/marketplace/sell-eligibility')
      return canSell ? { canSell } : { canSell, reason: 'SELLER_REQUIRED' };
    if (path === '/registrations/mine') return { registrations: [] };
    if (path === '/live/eligibility') return { canHost };
    if (path === '/live') return { items: [] };
    if (path === '/videos/limits') return { provider: 'mock' };
    return page();
  });
});
const renderAt = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('farm list', () => {
  it('without farm-owner access the button asks for it instead of "Create farm"', async () => {
    canCreateFarm = false;
    renderAt(<FarmListPage />);
    const ask = await screen.findAllByRole('link', { name: 'Request farm-owner access' });
    expect(ask.some((a) => a.getAttribute('href') === '/farms/owner-request')).toBe(true);
    expect(screen.queryByRole('link', { name: 'Create farm' })).toBeNull();
  });
  it('with access it stays "Create farm"', async () => {
    canCreateFarm = true;
    renderAt(<FarmListPage />);
    expect(await screen.findByRole('link', { name: 'Create farm' })).toBeTruthy();
  });
});

describe('sell pages', () => {
  it('a non-seller is told on /market/sell and /shop/sell, with the way to apply', async () => {
    canSell = false;
    const { unmount } = renderAt(<MarketSellPage />);
    expect(await screen.findByText(/Only approved sellers can list animals/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Apply to become a seller' })).toBeTruthy();
    unmount();
    renderAt(<ShopSellPage />);
    expect(await screen.findByText(/Only approved sellers can sell products/)).toBeTruthy();
  });
  it('a seller sees no notice', async () => {
    canSell = true;
    renderAt(<MarketSellPage />);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('GET', '/marketplace/sell-eligibility'),
    );
    expect(screen.queryByText(/your account has not been approved as a seller yet/)).toBeNull();
  });
});

describe('live host page', () => {
  it('someone who may not host is told before "Create", with the ways to get it', async () => {
    canHost = false;
    renderAt(<LiveHostPage />);
    expect(await screen.findByText(/only approved farm owners and sellers can/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Request farm-owner access' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Become a seller' })).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Create live stream' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
