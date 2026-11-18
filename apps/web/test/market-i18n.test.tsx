import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));

import { setLocale } from '../src/i18n';
import BrowsePage from '../src/pages/market/BrowsePage';
import ListingDetailPage from '../src/pages/market/ListingDetailPage';

const ID = (n: number) => String(n).padStart(24, '0');
const listing = {
  id: ID(1),
  farmId: ID(2),
  animalId: ID(3),
  seller: { id: ID(10), displayName: 'Somchai' },
  farmName: 'Happy Farm',
  title: 'Swamp buffalo',
  description: 'Calm',
  status: 'ACTIVE',
  askingPriceMinor: 5_000_000,
  currency: 'THB',
  negotiable: true,
  conditions: null,
  deliveryOptions: ['pickup'],
  photos: [],
  animal: {
    animalTypeId: ID(4),
    animalTypeName: 'Buffalo',
    breed: 'swamp',
    sex: 'female',
    birthDate: null,
    birthDateEstimated: false,
  },
  location: { province: 'Khon Kaen', district: 'Muang' },
  favoriteCount: 2,
  createdAt: '2026-03-01T00:00:00Z',
  viewer: { isSellerSide: false, favorited: false },
};

beforeEach(() => {
  request.mockReset();
  setLocale('th');
});
afterEach(() => setLocale('en'));

describe('market in Thai', () => {
  it('shows the browse page in Thai and switches to English without a reload', async () => {
    request.mockImplementation(async (_m: string, path: string) =>
      path === '/animal-types' ? { animalTypes: [] } : { items: [listing] },
    );
    render(
      <MemoryRouter>
        <BrowsePage />
      </MemoryRouter>,
    );
    await screen.findByText('Swamp buffalo');
    expect(screen.getByRole('heading', { name: 'ตลาดซื้อขายสัตว์' })).toBeTruthy();
    expect(screen.getByLabelText('จังหวัด')).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'ค้นหา' })).toBeTruthy();
    expect(screen.getByText('กำลังขาย')).toBeTruthy(); // listing status, not ACTIVE
    expect(screen.getByText(/เพศเมีย/)).toBeTruthy();
    expect(screen.getByRole('option', { name: 'ราคา: ต่ำไปสูง' })).toBeTruthy();

    act(() => setLocale('en'));
    expect(screen.getByRole('heading', { name: 'Animal marketplace' })).toBeTruthy();
    expect(screen.getByLabelText('Province')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText(/Female/)).toBeTruthy();
    expect(screen.queryByText('กำลังขาย')).toBeNull();
  });

  it('validates an offer with Thai messages', async () => {
    request.mockImplementation(async () => ({ listing }));
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/market/listing/${ID(1)}`]}>
        <Routes>
          <Route path="/market/listing/:id" element={<ListingDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'Swamp buffalo' });
    expect(screen.getByText('รับข้อเสนอราคา')).toBeTruthy();
    expect(screen.getByText('รับเอง')).toBeTruthy();
    await user.type(screen.getByLabelText('ราคาที่คุณเสนอ (฿)'), '60000');
    await user.click(screen.getByRole('button', { name: 'ส่งข้อเสนอ' }));
    expect(await screen.findByText('ราคาที่เสนอต้องไม่สูงกว่าราคาที่ตั้งขาย')).toBeTruthy();
    expect(request.mock.calls.some((c) => c[0] === 'POST')).toBe(false);
  });
});
