import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as RegistryModule from '../src/tours/registry';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request }, publicApi: { request } }));
// A test tour on a test page; the real tours are checked by the content test at the bottom.
vi.mock('../src/tours/registry', async (orig) => {
  const real = await orig<typeof RegistryModule>();
  const test = {
    id: 'help-centre', // reuses real catalog keys
    version: 2,
    routes: ['/page'],
    startPath: '/page',
    steps: [
      { anchor: 'a', titleKey: 'help-centre.1.title', bodyKey: 'help-centre.1.body' },
      {
        anchor: 'missing',
        titleKey: 'help-centre.2.title',
        bodyKey: 'help-centre.2.body',
        optional: true,
      },
      {
        anchor: 'c',
        titleKey: 'help-centre.3.title',
        bodyKey: 'help-centre.3.body',
        helpSlug: 'sign-in',
      },
    ],
  };
  // A form wizard: a hidden element is skipped, the form's own button moves the tour on, the next screen's step waits.
  const wizard = {
    id: 'farm-setup', // reuses real catalog keys
    version: 1,
    routes: ['/wizard/:x'],
    notOn: ['/wizard/other'],
    steps: [
      { anchor: 'w-name', titleKey: 'farm-setup.1.title', bodyKey: 'farm-setup.1.body' },
      {
        anchor: 'w-hidden',
        titleKey: 'farm-setup.2.title',
        bodyKey: 'farm-setup.2.body',
        optional: true,
      },
      {
        anchor: 'w-next',
        titleKey: 'farm-setup.3.title',
        bodyKey: 'farm-setup.3.body',
        advanceOnClick: true,
      },
      {
        anchor: 'w-location',
        titleKey: 'farm-setup.4.title',
        bodyKey: 'farm-setup.4.body',
        later: true,
      },
    ],
  };
  const all = [test, wizard];
  return {
    ...real,
    REAL: real.TOURS,
    TOURS: all,
    tourById: (id: string) => all.find((t) => t.id === id),
  };
});

import { AuthContext, withHelpers, type AuthState } from '../src/auth/AuthContext';
import { TourProvider, useTours } from '../src/tours/TourProvider';
import * as registry from '../src/tours/registry';
import tours from '../src/i18n/messages/tours';
import { articles } from '../src/help/content';

beforeAll(() => {
  window.scrollBy = vi.fn() as never;
  // Node shadows jsdom's localStorage (see home.test.tsx): an in-memory one for the guest path.
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
  });
});
beforeEach(() => {
  request.mockReset();
  localStorage.clear();
});
afterEach(() => localStorage.clear());

function Page() {
  const { start } = useTours();
  const navigate = useNavigate();
  return (
    <div>
      <button data-tour="a">First thing</button>
      <button data-tour="c">Third thing</button>
      <button onClick={() => start('help-centre')}>Show again</button>
      <button onClick={() => navigate('/other')}>Leave</button>
    </div>
  );
}

function renderAt(signedIn: boolean) {
  const state: AuthState = signedIn
    ? {
        status: 'authenticated',
        permissions: [],
        mfaRequired: false,
        user: {
          id: 'u1',
          displayName: 'Somchai',
          status: 'active',
          emailVerified: true,
          phoneVerified: false,
          mfaEnabled: false,
          roles: ['buyer'],
          createdAt: '2026-01-01T00:00:00Z',
        },
      }
    : { status: 'anonymous', permissions: [], mfaRequired: false };
  const noop = async () => undefined;
  const value = withHelpers(state, {
    login: async () => 'authenticated',
    completeSignIn: async () => 'authenticated',
    verifyMfa: noop,
    logout: noop,
    reload: noop,
  });
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={['/page']}>
        <TourProvider>
          <Routes>
            <Route path="/page" element={<Page />} />
            <Route path="/other" element={<p>Other page</p>} />
          </Routes>
        </TourProvider>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const card = () => screen.findByRole('dialog');
const local = () => JSON.parse(localStorage.getItem('farmplus.tours') ?? '{}');

describe('guided tour engine', () => {
  it('starts on the first visit, skips a missing optional step, goes back and forward, ends with "Done"', async () => {
    const user = userEvent.setup();
    renderAt(false);
    const d = within(await card());
    expect(d.getByText('Step 1 of 2')).toBeTruthy(); // the optional step without its element is left out
    expect(d.getByRole('heading', { name: 'Search the help' })).toBeTruthy();
    expect(d.queryByRole('button', { name: 'Back' })).toBeNull();
    // Nothing moves by itself.
    await new Promise((r) => setTimeout(r, 300));
    expect(d.getByText('Step 1 of 2')).toBeTruthy();
    // The page is not locked: its buttons still work while the tour is open.
    await user.click(screen.getByRole('button', { name: 'First thing' }));
    await user.click(d.getByRole('button', { name: 'Next' }));
    expect(d.getByText('Step 2 of 2')).toBeTruthy();
    expect(d.getByRole('link', { name: 'Read more' }).getAttribute('href')).toBe('/help/sign-in');
    await user.click(d.getByRole('button', { name: 'Back' }));
    expect(d.getByText('Step 1 of 2')).toBeTruthy();
    await user.click(d.getByRole('button', { name: 'Next' }));
    await user.click(d.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(local()['help-centre']).toEqual({ version: 2, status: 'completed', lastStep: 1 });
  });

  it('is announced and focused; Esc closes it as skipped; it is not shown again, but can be started again', async () => {
    const user = userEvent.setup();
    const { unmount } = renderAt(false);
    await card();
    expect(document.activeElement?.textContent).toBe('Next');
    expect(screen.getByText('Tip, step 1 of 2: Search the help').getAttribute('aria-live')).toBe(
      'polite',
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(local()['help-centre']).toMatchObject({ status: 'skipped', lastStep: 0 });
    unmount();

    renderAt(false);
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.queryByRole('dialog')).toBeNull(); // remembered
    await user.click(screen.getByRole('button', { name: 'Show again' }));
    expect(await card()).toBeTruthy();
  });

  it('"don\'t show again" is kept even when the tour gets a new version', async () => {
    localStorage.setItem(
      'farmplus.tours',
      JSON.stringify({ 'help-centre': { version: 1, status: 'dismissed_forever', lastStep: 0 } }),
    );
    renderAt(false);
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a newer version is shown again to someone who had completed the old one', async () => {
    localStorage.setItem(
      'farmplus.tours',
      JSON.stringify({ 'help-centre': { version: 1, status: 'completed', lastStep: 2 } }),
    );
    renderAt(false);
    expect(await card()).toBeTruthy();
  });

  it('signed in: reads and saves progress on the server, not in this browser', async () => {
    const user = userEvent.setup();
    request.mockImplementation(async (method: string) =>
      method === 'GET' ? { tours: [] } : { tour: {} },
    );
    renderAt(true);
    const d = within(await card());
    await user.click(d.getByRole('button', { name: "Don't show these tips again" }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('PUT', '/me/tours/help-centre', {
        body: { version: 2, status: 'dismissed_forever', lastStep: 0 },
      }),
    );
    expect(localStorage.getItem('farmplus.tours')).toBeNull();
  });

  it('signed in and already done on another device: not shown', async () => {
    request.mockResolvedValue({
      tours: [
        { tourId: 'help-centre', version: 2, status: 'completed', lastStep: 1, updatedAt: '' },
      ],
    });
    renderAt(true);
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('leaving the page ends the tour', async () => {
    const user = userEvent.setup();
    renderAt(false);
    await card();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Leave' }));
    });
    expect(await screen.findByText('Other page')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(local()['help-centre']).toMatchObject({ status: 'skipped' });
  });
});

function Wizard() {
  const [screenNo, setScreenNo] = useState(1);
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      {screenNo === 1 ? (
        <input data-tour="w-name" aria-label="Farm name" />
      ) : (
        <input data-tour="w-location" aria-label="Province" />
      )}
      <span data-tour="w-hidden" hidden>
        Only on wide screens
      </span>
      <button data-tour="w-next" onClick={() => setScreenNo(2)}>
        Form next
      </button>
    </form>
  );
}

function renderWizard(path: string) {
  const value = withHelpers(
    { status: 'anonymous', permissions: [], mfaRequired: false },
    {
      login: async () => 'authenticated',
      completeSignIn: async () => 'authenticated',
      verifyMfa: async () => undefined,
      logout: async () => undefined,
      reload: async () => undefined,
    },
  );
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[path]}>
        <TourProvider>
          <Routes>
            <Route path="/wizard/:x" element={<Wizard />} />
          </Routes>
        </TourProvider>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('tours that follow a form wizard', () => {
  beforeAll(() => {
    // jsdom has no layout: say "not visible" for `hidden` elements, as browsers do.
    HTMLElement.prototype.checkVisibility = function (this: HTMLElement) {
      return !this.closest('[hidden]');
    };
  });

  it("skips a hidden element, waits for the form's own Next, then shows the next screen's step", async () => {
    const user = userEvent.setup();
    renderWizard('/wizard/new');
    const d = within(await card());
    expect(d.getByText('Step 1 of 3')).toBeTruthy(); // the hidden step is left out; the later one is kept
    expect(d.getByRole('heading', { name: 'Name your farm' })).toBeTruthy();
    await user.click(d.getByRole('button', { name: 'Next' }));
    const d2 = within(await card());
    expect(d2.getByRole('heading', { name: 'Go to the next step' })).toBeTruthy();
    expect(d2.queryByRole('button', { name: 'Next' })).toBeNull(); // the form's own button moves it on
    await user.click(screen.getByRole('button', { name: 'Form next' }));
    const d3 = within(await card());
    await waitFor(() => expect(d3.getByRole('heading', { name: 'Farm location' })).toBeTruthy());
    expect(d3.getByText('Step 3 of 3')).toBeTruthy();
    await user.click(d3.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(local()['farm-setup']).toMatchObject({ status: 'completed' });
  });

  it('does not run on a path listed in notOn', async () => {
    renderWizard('/wizard/other');
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the real tours', () => {
  const real = (registry as unknown as { REAL: typeof registry.TOURS }).REAL;
  const slugs = new Set(articles('th').map((a) => a.slug));
  it('every step has Thai and English text, a valid anchor, and real help links', () => {
    expect(real.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const tour of real) {
      expect(ids.has(tour.id), tour.id).toBe(false);
      ids.add(tour.id);
      expect(tour.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(tour.steps.length, tour.id).toBeGreaterThanOrEqual(3);
      expect(tour.steps.length, tour.id).toBeLessThanOrEqual(7);
      if (tour.startPath) expect(tours.th, `name.${tour.id}`).toHaveProperty(`name.${tour.id}`);
      for (const s of tour.steps) {
        expect(s.anchor).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        for (const key of [s.titleKey, s.bodyKey]) {
          expect(tours.th, key).toHaveProperty([key]);
          expect(tours.en, key).toHaveProperty([key]);
        }
        if (s.helpSlug) expect(slugs.has(s.helpSlug), `${tour.id} → ${s.helpSlug}`).toBe(true);
      }
      // Each card must be recognisable: no two steps of a tour share a title.
      for (const locale of ['th', 'en'] as const) {
        const titles = tour.steps.map((s) => (tours[locale] as Record<string, string>)[s.titleKey]);
        expect(new Set(titles).size, `${tour.id} ${locale} titles`).toBe(titles.length);
      }
    }
  });
});
