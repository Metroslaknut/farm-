import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatBaht, parseBahtToMinor } from '@farmplus/shared-utils';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));

import ListingsPage from '../src/pages/admin/listings';
import BrowsePage from '../src/pages/market/BrowsePage';
import ListingDetailPage from '../src/pages/market/ListingDetailPage';
import { ListingForm } from '../src/pages/market/ListingForm';
import NegotiationPage from '../src/pages/market/NegotiationPage';

const ID = (n: number) => String(n).padStart(24, '0');
const author = (n: number, name: string) => ({ id: ID(n), displayName: name });
const listing = (over: object = {}) => ({
  id: ID(1),
  farmId: ID(2),
  animalId: ID(3),
  seller: author(10, 'Somchai'),
  farmName: 'Happy Farm',
  title: 'Swamp buffalo',
  description: 'Calm',
  status: 'ACTIVE',
  askingPriceMinor: 5_000_000,
  currency: 'THB',
  negotiable: true,
  conditions: null,
  deliveryOptions: ['pickup'],
  photos: [{ url: 'https://cdn.example.test/a.jpg' }],
  animal: {
    animalTypeId: ID(4),
    animalTypeName: 'Buffalo',
    breed: 'swamp',
    sex: 'female',
    birthDate: '2022-03-15',
    birthDateEstimated: false,
  },
  location: { province: 'Khon Kaen', district: 'Muang' },
  favoriteCount: 2,
  createdAt: '2026-03-01T00:00:00Z',
  viewer: { isSellerSide: false, favorited: false },
  ...over,
});
const negotiation = (over: object = {}) => ({
  id: ID(5),
  listingId: ID(1),
  listingTitle: 'Swamp buffalo',
  listingStatus: 'ACTIVE',
  askingPriceMinor: 5_000_000,
  buyer: author(20, 'Buyer Bee'),
  seller: author(10, 'Somchai'),
  status: 'open',
  turn: 'buyer',
  currentOfferMinor: 4_500_000,
  currency: 'THB',
  currentSeq: 2,
  offerExpiresAt: '2030-01-01T00:00:00Z',
  history: [
    {
      seq: 1,
      type: 'offer',
      by: 'buyer',
      actor: author(20, 'Buyer Bee'),
      amountMinor: 4_000_000,
      currency: 'THB',
      at: '2026-03-01T00:00:00Z',
    },
    {
      seq: 2,
      type: 'counter',
      by: 'seller',
      actor: author(10, 'Somchai'),
      amountMinor: 4_500_000,
      currency: 'THB',
      message: 'Best price',
      at: '2026-03-01T01:00:00Z',
    },
  ],
  viewer: { party: 'buyer', canAct: true },
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T01:00:00Z',
  ...over,
});

const at = (path: string, route: string, el: React.ReactNode) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={el} />
        <Route path="*" element={<p>navigated</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  request.mockReset();
});

describe('money helpers', () => {
  it('formats satang as baht', () => {
    expect(formatBaht(5_000_000)).toBe('฿50,000.00');
    expect(formatBaht(5)).toBe('฿0.05');
    expect(formatBaht(123_456_789)).toBe('฿1,234,567.89');
  });
  it('parses typed baht into integer satang without floating point', () => {
    expect(parseBahtToMinor('50000')).toBe(5_000_000);
    expect(parseBahtToMinor('50,000.5')).toBe(5_000_050);
    expect(parseBahtToMinor(' 0.07 ')).toBe(7);
    expect(parseBahtToMinor('19.99')).toBe(1999); // the classic float trap (19.99 * 100 = 1998.9999…)
    expect(parseBahtToMinor('1.005')).toBeUndefined();
    for (const bad of ['', 'abc', '-5', '0', '0.00', '1e5', '12.', '.5', '1,2,3.456'])
      expect(parseBahtToMinor(bad), bad).toBeUndefined();
  });
});

describe('browse', () => {
  it('sends filters with prices converted to satang and rejects bad price input without a request', async () => {
    request.mockImplementation(async (_m: string, path: string) =>
      path === '/animal-types'
        ? { animalTypes: [{ id: ID(4), name: 'Buffalo' }] }
        : { items: [listing()] },
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BrowsePage />
      </MemoryRouter>,
    );
    await screen.findByText('Swamp buffalo');
    await user.type(screen.getByLabelText('Province'), 'Khon Kaen');
    await user.click(screen.getAllByRole('button', { name: 'Filter' })[1]!);
    const filterPrice = () => user.click(screen.getAllByRole('button', { name: 'Filter' })[0]!);
    await user.type(screen.getByLabelText('Lowest price (฿)'), 'abc');
    await filterPrice();
    expect(await screen.findByText(/Enter the lowest price as a number/)).toBeTruthy();
    await user.clear(screen.getByLabelText('Lowest price (฿)'));
    await user.type(screen.getByLabelText('Lowest price (฿)'), '30000');
    await user.type(screen.getByRole('textbox', { name: 'Highest price (฿)' }), '20000');
    await filterPrice();
    expect(await screen.findByText(/lowest price is above the highest/)).toBeTruthy();
    await user.clear(screen.getByRole('textbox', { name: 'Highest price (฿)' }));
    await user.type(screen.getByRole('textbox', { name: 'Highest price (฿)' }), '90000.50');
    await filterPrice();
    await user.click(screen.getByLabelText('Buffalo'));
    await waitFor(() => {
      const last = request.mock.calls.filter((c) => c[1] === '/marketplace/listings').at(-1)!;
      expect(last[2].query).toMatchObject({
        province: 'Khon Kaen',
        minPriceMinor: 3_000_000,
        maxPriceMinor: 9_000_050,
        animalTypeId: ID(4),
        sort: 'newest',
      });
    });
  });

  it('shows prices, status and an empty state', async () => {
    request.mockImplementation(async (_m: string, path: string) =>
      path === '/animal-types' ? { animalTypes: [] } : { items: [] },
    );
    render(
      <MemoryRouter>
        <BrowsePage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/No animals match/)).toBeTruthy();
  });
});

describe('listing detail and offers', () => {
  const open = (l: object) => {
    request.mockImplementation(async (m: string, path: string, opts?: { body?: unknown }) => {
      if (m === 'GET') return { listing: l };
      if (path.endsWith('/negotiations'))
        return { negotiation: negotiation({ id: ID(9) }), echo: opts?.body };
      throw new Error(`unexpected ${m} ${path}`);
    });
  };

  it('validates the offer in the browser and sends integer satang', async () => {
    open(listing());
    const user = userEvent.setup();
    at(`/market/listing/${ID(1)}`, '/market/listing/:id', <ListingDetailPage />);
    await screen.findByRole('heading', { name: 'Swamp buffalo' });
    await user.click(screen.getByRole('button', { name: 'Send offer' }));
    expect(await screen.findByText(/Enter your offer as a number/)).toBeTruthy();
    await user.type(screen.getByLabelText('Your offer (฿)'), '60000');
    await user.click(screen.getByRole('button', { name: 'Send offer' }));
    expect(await screen.findByText(/cannot be above the asking price/)).toBeTruthy();
    expect(request.mock.calls.some((c) => c[0] === 'POST')).toBe(false);
    await user.clear(screen.getByLabelText('Your offer (฿)'));
    await user.type(screen.getByLabelText('Your offer (฿)'), '45000.5');
    await user.type(
      screen.getByLabelText('Message to the seller (optional)'),
      'Can collect Saturday',
    );
    await user.click(screen.getByRole('button', { name: 'Send offer' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('POST', `/marketplace/listings/${ID(1)}/negotiations`, {
        body: { amountMinor: 4_500_050, currency: 'THB', message: 'Can collect Saturday' },
      }),
    );
    expect(await screen.findByText('navigated')).toBeTruthy();
  });

  it('a fixed-price listing offers exactly the asking price', async () => {
    open(listing({ negotiable: false }));
    const user = userEvent.setup();
    at(`/market/listing/${ID(1)}`, '/market/listing/:id', <ListingDetailPage />);
    await screen.findByRole('heading', { name: 'Swamp buffalo' });
    expect(screen.queryByLabelText('Your offer (฿)')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Request to buy' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('POST', expect.any(String), {
        body: { amountMinor: 5_000_000, currency: 'THB' },
      }),
    );
  });

  it('no offer form for sellers, existing negotiations, or listings that are not active; sold/reserved are explained', async () => {
    for (const [over, text] of [
      [{ viewer: { isSellerSide: true, favorited: false } }, /This is your listing/],
      [
        { viewer: { isSellerSide: false, favorited: false, negotiationId: ID(5) } },
        /already have an offer/,
      ],
      [{ status: 'RESERVED' }, /reserved by another buyer/],
      [{ status: 'SOLD' }, /has been sold/],
    ] as const) {
      open(listing(over));
      const { unmount } = at(
        `/market/listing/${ID(1)}`,
        '/market/listing/:id',
        <ListingDetailPage />,
      );
      expect(await screen.findByText(text)).toBeTruthy();
      expect(screen.queryByRole('form', { name: 'Make an offer' })).toBeNull();
      unmount();
    }
  });

  it('saving a listing toggles with the server count', async () => {
    request.mockImplementation(async (m: string) =>
      m === 'GET' ? { listing: listing() } : { favorited: true, favoriteCount: 3 },
    );
    const user = userEvent.setup();
    at(`/market/listing/${ID(1)}`, '/market/listing/:id', <ListingDetailPage />);
    await user.click(await screen.findByRole('button', { name: /☆ Save/ }));
    expect(await screen.findByRole('button', { name: /★ Saved · 3/ })).toBeTruthy();
  });

  it("hides the seller's private lowest-offer floor (it is never in the buyer payload, nor rendered)", async () => {
    open(listing());
    at(`/market/listing/${ID(1)}`, '/market/listing/:id', <ListingDetailPage />);
    await screen.findByRole('heading', { name: 'Swamp buffalo' });
    expect(document.body.textContent).not.toMatch(/lowest offer/i);
  });
});

describe('negotiation page', () => {
  const open = (n: object) => {
    request.mockImplementation(async () => ({ negotiation: n }));
  };

  it('shows the immutable history with amounts and actors, and the actions only on your turn', async () => {
    open(negotiation());
    at(`/market/offers/${ID(5)}`, '/market/offers/:id', <NegotiationPage />);
    const history = await screen.findByRole('list', { name: 'Negotiation history' });
    expect(within(history).getByText('฿40,000.00')).toBeTruthy();
    expect(within(history).getByText('฿45,000.00')).toBeTruthy();
    expect(within(history).getByText(/“Best price”/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept ฿45,000.00' })).toBeTruthy();
    expect(screen.getByLabelText('Counter-offer (฿)')).toBeTruthy();
  });

  it('not your turn: no accept/counter, only waiting (and buyer may withdraw)', async () => {
    open(negotiation({ turn: 'seller', viewer: { party: 'buyer', canAct: false } }));
    at(`/market/offers/${ID(5)}`, '/market/offers/:id', <NegotiationPage />);
    await screen.findByRole('list', { name: 'Negotiation history' });
    expect(screen.queryByRole('button', { name: /^Accept/ })).toBeNull();
    expect(screen.queryByLabelText('Counter-offer (฿)')).toBeNull();
    expect(screen.getByRole('button', { name: 'Withdraw my offer' })).toBeTruthy();
  });

  it('accepting asks for confirmation and quotes the offer sequence the user saw', async () => {
    open(negotiation());
    const user = userEvent.setup();
    at(`/market/offers/${ID(5)}`, '/market/offers/:id', <NegotiationPage />);
    await user.click(await screen.findByRole('button', { name: 'Accept ฿45,000.00' }));
    expect(request.mock.calls.some((c) => c[0] === 'POST')).toBe(false);
    await user.click(screen.getAllByRole('button', { name: 'Accept' }).at(-1)!);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('POST', `/marketplace/negotiations/${ID(5)}/accept`, {
        body: { expectedSeq: 2 },
      }),
    );
  });

  it('a counter-offer is validated as baht text and sent as satang with the sequence', async () => {
    open(negotiation());
    const user = userEvent.setup();
    at(`/market/offers/${ID(5)}`, '/market/offers/:id', <NegotiationPage />);
    await screen.findByRole('list', { name: 'Negotiation history' });
    await user.click(screen.getByRole('button', { name: 'Send counter-offer' }));
    expect(await screen.findByText(/Enter your counter-offer as a number/)).toBeTruthy();
    await user.type(screen.getByLabelText('Counter-offer (฿)'), '42000');
    await user.click(screen.getByRole('button', { name: 'Send counter-offer' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('POST', `/marketplace/negotiations/${ID(5)}/counter`, {
        body: { amountMinor: 4_200_000, expectedSeq: 2 },
      }),
    );
  });

  it('a stale-offer error is shown and the latest state is reloaded', async () => {
    let gets = 0;
    request.mockImplementation(async (m: string) => {
      if (m === 'GET') {
        gets++;
        return { negotiation: negotiation() };
      }
      throw Object.assign(
        new Error('The offer changed while you were looking: reload and try again'),
        { status: 409 },
      );
    });
    const user = userEvent.setup();
    at(`/market/offers/${ID(5)}`, '/market/offers/:id', <NegotiationPage />);
    await user.click(await screen.findByRole('button', { name: 'Accept ฿45,000.00' }));
    await user.click(screen.getAllByRole('button', { name: 'Accept' }).at(-1)!);
    expect(await screen.findByText(/offer changed while you were looking/)).toBeTruthy();
    await waitFor(() => expect(gets).toBeGreaterThanOrEqual(2));
  });

  it('accepted deals show the order hand-off; moderators get a read-only view', async () => {
    open(
      negotiation({
        status: 'accepted',
        turn: undefined,
        viewer: { party: 'buyer', canAct: false },
        order: {
          status: 'awaiting_payment',
          amountMinor: 4_500_000,
          currency: 'THB',
          reservedUntil: '2030-01-03T00:00:00Z',
        },
      }),
    );
    const { unmount } = at(`/market/offers/${ID(5)}`, '/market/offers/:id', <NegotiationPage />);
    expect(await screen.findByText(/Agreed at/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel the deal' })).toBeTruthy();
    unmount();
    open(negotiation({ viewer: { party: 'moderator', canAct: false } }));
    at(`/market/offers/${ID(5)}`, '/market/offers/:id', <NegotiationPage />);
    expect(await screen.findByText(/read-only/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Accept/ })).toBeNull();
  });
});

describe('listing form', () => {
  it('converts baht to satang, validates with the shared schema and keeps the floor private to the seller', async () => {
    const animals = {
      items: [
        {
          id: ID(3),
          animalCode: 'A-1',
          name: 'Bua',
          animalType: { id: ID(4), key: 'buffalo', name: 'Buffalo' },
          sex: 'female',
          currentStatus: 'active',
        },
      ],
    };
    request.mockImplementation(async (m: string) =>
      m === 'GET' ? animals : { listing: listing() },
    );
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ListingForm farmId={ID(2)} onSaved={onSaved} />
      </MemoryRouter>,
    );
    await screen.findByRole('option', { name: /A-1/ });
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(await screen.findByText(/Enter the price in baht/)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Choose from your animals'), ID(3));
    await user.type(screen.getByLabelText('Title'), 'Swamp buffalo cow');
    await user.type(screen.getByLabelText('Asking price (฿)'), '50000');
    await user.type(screen.getByLabelText(/Lowest offer you would consider/), '60000');
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(await screen.findByText(/lowest offer cannot be above the asking price/i)).toBeTruthy();
    await user.clear(screen.getByLabelText(/Lowest offer you would consider/));
    await user.type(screen.getByLabelText(/Lowest offer you would consider/), '40000');
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const post = request.mock.calls.find((c) => c[0] === 'POST')!;
    expect(post[2].body).toMatchObject({
      animalId: ID(3),
      title: 'Swamp buffalo cow',
      askingPriceMinor: 5_000_000,
      minOfferMinor: 4_000_000,
      negotiable: true,
      deliveryOptions: ['pickup'],
    });
  });
});

describe('admin moderation queue', () => {
  const pending = {
    ...listing({ status: 'PENDING_REVIEW', minOfferMinor: 4_000_000 }),
    review: { rejectedReason: null },
  };
  it('lists submissions with their terms; reject needs a reason, approve does not', async () => {
    request.mockImplementation(async (m: string) =>
      m === 'GET' ? { items: [pending] } : { listing: { ...pending, status: 'ACTIVE' } },
    );
    const user = userEvent.setup();
    render(<ListingsPage />);
    expect(await screen.findByText(/Floor|floor/)).toBeTruthy();
    expect(screen.getByText(/Happy Farm/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    const confirm = screen.getAllByRole('button', { name: 'Reject' }).at(-1) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByLabelText(/Reason/), 'Photo is blurry');
    await user.click(screen.getAllByRole('button', { name: 'Reject' }).at(-1)!);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        'POST',
        `/marketplace/moderation/listings/${ID(1)}/reject`,
        { body: { reason: 'Photo is blurry' } },
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(screen.getAllByRole('button', { name: 'Approve' }).at(-1)!);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        'POST',
        `/marketplace/moderation/listings/${ID(1)}/approve`,
        { body: {} },
      ),
    );
  });
});
