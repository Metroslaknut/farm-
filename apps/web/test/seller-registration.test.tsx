import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));

import { ApiClientError } from '@farmplus/api-client';
import { setLocale } from '../src/i18n';
import SellerRegistrationPage from '../src/pages/farms/SellerRegistrationPage';
import { SellerRequiredNotice } from '../src/pages/farms/SellerRequiredNotice';

const reg = (type: 'seller' | 'identity', status: string, over: object = {}) => ({
  id: `${type}-${status}`,
  type,
  status,
  applicant: { id: 'u1', displayName: 'Somchai' },
  documents: [],
  submittedAt: '2026-11-20T03:00:00.000Z',
  ...over,
});
const decision = (outcome: string, reason: string) => ({
  decision: { outcome, byId: 'a1', at: '2026-11-21T03:00:00.000Z', reason },
});

/** `GET /registrations/mine` answers `mine`; `POST /registrations` calls `posted`. */
type Posted = (opts?: { body?: unknown }) => Promise<unknown>;
function mockApi(
  mine: unknown[] | Error,
  posted = vi.fn<Posted>(async () => ({ registration: {} })),
) {
  request.mockImplementation(async (method: string, path: string, opts?: { body?: unknown }) => {
    if (method === 'GET' && path === '/registrations/mine') {
      if (mine instanceof Error) throw mine;
      return { registrations: mine };
    }
    if (method === 'POST' && path === '/registrations') return posted(opts);
    throw new Error(`unexpected request ${method} ${path}`);
  });
  return posted;
}
const renderPage = () =>
  render(
    <MemoryRouter>
      <SellerRegistrationPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  request.mockReset();
});
afterEach(() => setLocale('en'));

describe('seller registration page', () => {
  it('not applied yet: both forms; validates links before sending, then sends the seller application', async () => {
    const posted = mockApi([]);
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('You have not applied to become a seller yet.')).toBeTruthy();
    const form = screen.getByRole('form', { name: 'Seller application form' });
    expect(screen.getByRole('form', { name: 'Identity verification form' })).toBeTruthy();
    await user.type(within(form).getByLabelText(/Shop or business name/), 'Happy Farm Shop');
    await user.click(within(form).getByRole('button', { name: 'Add a document' }));
    await user.type(within(form).getByLabelText('Document 1 type'), 'business_registration');
    await user.type(within(form).getByLabelText('Document 1 link (https)'), 'http://x.test/a.pdf');
    await user.click(within(form).getByRole('button', { name: 'Send seller application' }));
    expect(posted).not.toHaveBeenCalled(); // http:// is refused in the browser
    expect(within(form).getAllByText(/https/i).length).toBeGreaterThan(1);
    await user.clear(within(form).getByLabelText('Document 1 link (https)'));
    await user.type(within(form).getByLabelText('Document 1 link (https)'), 'https://x.test/a.pdf');
    await user.click(within(form).getByRole('button', { name: 'Send seller application' }));
    expect(await screen.findByText(/Seller application sent/)).toBeTruthy();
    expect(posted.mock.calls[0]![0]).toEqual({
      body: {
        type: 'seller',
        businessName: 'Happy Farm Shop',
        documents: [{ kind: 'business_registration', url: 'https://x.test/a.pdf' }],
      },
    });
  });

  it('pending and under review: status, no form', async () => {
    mockApi([reg('seller', 'PENDING'), reg('identity', 'UNDER_REVIEW')]);
    renderPage();
    expect(await screen.findByText('Pending')).toBeTruthy();
    expect(screen.getByText(/application has been sent and is waiting for review/)).toBeTruthy();
    expect(screen.getByText('Under review')).toBeTruthy();
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('approved: links to sell, identity section hidden', async () => {
    mockApi([reg('seller', 'APPROVED'), reg('identity', 'APPROVED')]);
    renderPage();
    expect(await screen.findByText(/You are an approved seller/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'List an animal for sale' }).getAttribute('href')).toBe(
      '/market/sell',
    );
    expect(screen.getByRole('link', { name: 'Sell products in the shop' })).toBeTruthy();
    expect(screen.queryByText('Identity verification')).toBeNull();
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('rejected: the reason and a form to apply again; identity verified is shown', async () => {
    mockApi([
      reg('seller', 'REJECTED', decision('REJECTED', 'Business licence missing')),
      reg('identity', 'APPROVED'),
    ]);
    renderPage();
    expect(await screen.findByText('Rejected')).toBeTruthy();
    expect(screen.getByText('Reason from the reviewer: Business licence missing')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply again' })).toBeTruthy();
    expect(screen.getByText('Your identity is verified.')).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Identity verification form' })).toBeNull();
  });

  it('suspended: the reason and no way to re-apply', async () => {
    mockApi([reg('seller', 'SUSPENDED', decision('SUSPENDED', 'Fraud reports'))]);
    renderPage();
    expect(await screen.findByText('Suspended')).toBeTruthy();
    expect(screen.getByText('Reason from the reviewer: Fraud reports')).toBeTruthy();
    expect(screen.getAllByText(/cannot be applied for again/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('form', { name: 'Seller application form' })).toBeNull();
  });

  it('a load error offers to try again; a server error on submit is shown in Thai', async () => {
    mockApi(new Error('Network down'));
    const { unmount } = renderPage();
    expect(await screen.findByText(/Network down/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    unmount();

    setLocale('th');
    mockApi(
      [],
      vi.fn<Posted>(async () => {
        throw new ApiClientError('You already have an active registration of this type.', 409, {
          code: 'REGISTRATION_EXISTS',
        });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    const form = await screen.findByRole('form', { name: 'แบบฟอร์มสมัครเป็นผู้ขาย' });
    await user.click(within(form).getByRole('button', { name: 'ส่งใบสมัครผู้ขาย' }));
    expect(await within(form).findByText(/ใบสมัครประเภทนี้ที่ยังดำเนินการอยู่แล้ว/)).toBeTruthy();
  });
});

describe('"approved sellers only" notice on the sell forms', () => {
  it('links to the application page, with the current status when there is one', async () => {
    mockApi([]);
    const { unmount } = render(
      <MemoryRouter>
        <SellerRequiredNotice message="Only approved sellers can list animals." />
      </MemoryRouter>,
    );
    const apply = await screen.findByRole('link', { name: 'Apply to become a seller' });
    expect(apply.getAttribute('href')).toBe('/farms/seller');
    unmount();

    mockApi([reg('seller', 'PENDING')]);
    render(
      <MemoryRouter>
        <SellerRequiredNotice message="Only approved sellers can list animals." />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Your seller application: Pending/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View application' })).toBeTruthy();
  });
});
