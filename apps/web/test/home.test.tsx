import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));

import { App } from '../src/App';
import { SiteFooter } from '../src/components/layout/SiteFooter';
import { SiteHeader } from '../src/components/layout/SiteHeader';
import { LanguageToggle } from '../src/components/layout/LanguageToggle';
import { setLocale } from '../src/i18n';
import ShopBrowsePage from '../src/pages/shop/BrowsePage';
import { renderAs } from './helpers';

const product = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  farmId: 'f1',
  farmName: 'Happy Farm',
  seller: { id: 's1', displayName: 'Seller' },
  categoryKey: 'feed',
  categoryName: 'Animal feed',
  title: 'Cattle pellets 30 kg',
  description: null,
  brand: null,
  sku: null,
  unit: 'bag',
  status: 'ACTIVE',
  currency: 'THB',
  priceMinor: 100_000,
  promotion: null,
  effectivePriceMinor: 75_000,
  onSale: true,
  specs: [],
  photos: [],
  deliveryOptions: ['pickup'],
  minOrderQty: 1,
  maxOrderQty: null,
  available: 5,
  inStock: true,
  regulatory: null,
  rating: { average: 4.5, count: 2 },
  soldCount: 3,
  viewer: { isSellerSide: false },
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});
const listing = {
  id: 'l1',
  farmId: 'f1',
  animalId: 'a1',
  seller: { id: 's1', displayName: 'Seller' },
  farmName: 'Buffalo Farm',
  title: 'Swamp buffalo cow',
  status: 'ACTIVE',
  askingPriceMinor: 5_000_000,
  currency: 'THB',
  negotiable: true,
  deliveryOptions: ['pickup'],
  photos: [],
  animal: { breed: 'swamp' },
  location: { province: 'Khon Kaen' },
  favoriteCount: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  viewer: { isSellerSide: false, favorited: false },
};
const post = {
  id: 'post1',
  author: { id: 'u2', displayName: 'Somchai' },
  body: 'How I raised my buffalo calves this season',
  media: [],
  visibility: 'public',
  status: 'published',
  reactionCount: 4,
  commentCount: 1,
  createdAt: '2026-10-10T00:00:00.000Z',
  viewer: { reacted: false, isAuthor: false, followsAuthor: false },
};

beforeEach(() => {
  // The storefront is written in Thai first; these tests check the Thai wording.
  setLocale('th');
  request.mockReset();
  request.mockImplementation(
    (_m: string, path: string, opts?: { query?: Record<string, unknown> }) => {
      if (path === '/shop/categories')
        return Promise.resolve({
          categories: [
            { key: 'feed', name: 'Animal feed', nameTh: 'อาหารสัตว์', salesEnabled: true },
            { key: 'medicines', name: 'Medicines', salesEnabled: false },
          ],
        });
      if (path === '/shop/cart') return Promise.resolve({ cart: { itemCount: 3, groups: [] } });
      if (path === '/shop/products')
        return Promise.resolve({
          items: [product(opts?.query?.['onSale'] ? {} : { id: 'p2', title: 'Best seller' })],
          page: 1,
          pageSize: 8,
          total: 1,
        });
      if (path === '/marketplace/listings') return Promise.resolve({ items: [listing] });
      if (path === '/posts') return Promise.resolve({ items: [post] });
      return Promise.reject(new Error(`unexpected ${path}`));
    },
  );
});
afterEach(cleanup);

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

describe('home page (storefront structure)', () => {
  it('signed out: hero, platform categories, features and a sign-in prompt — no private data is requested', () => {
    renderAs(
      <Routes>
        <Route path="/" element={<App />} />
      </Routes>,
      { status: 'anonymous', route: '/' },
    );
    expect(screen.getByRole('region', { name: 'ข่าวสารและโปรโมชัน' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'เลือกดูตามหมวดหมู่' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ตลาดสัตว์' }).getAttribute('href')).toBe('/market');
    expect(screen.getByRole('heading', { name: 'ราคาจากผู้ขายโดยตรง' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'เข้าสู่ระบบ' }).getAttribute('href')).toBe(
      '/farms/sign-in',
    );
    expect(screen.getByRole('heading', { name: 'แพลตฟอร์มเดียวสำหรับคนทำฟาร์ม' })).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });

  it('signed in: shop categories, discounted products, latest listings, best sellers and community posts', async () => {
    renderAs(
      <Routes>
        <Route path="/" element={<App />} />
      </Routes>,
      { route: '/' },
    );
    expect(await screen.findByRole('heading', { name: 'หมวดหมู่สินค้า' })).toBeTruthy();
    // only categories open for sale are offered
    expect(screen.getByRole('link', { name: /อาหารสัตว์/ }).getAttribute('href')).toBe(
      '/shop?category=feed',
    );
    expect(screen.queryByRole('link', { name: /Medicines/ })).toBeNull();

    const deals = screen.getByRole('region', { name: 'สินค้าลดราคา' });
    const card = await within(deals).findByRole('article', { name: 'Cattle pellets 30 kg' });
    expect(within(card).getByText('ลด 25%')).toBeTruthy();
    expect(card.textContent).toContain('750.00');
    expect(card.textContent).toContain('1,000.00');
    expect(request).toHaveBeenCalledWith(
      'GET',
      '/shop/products',
      expect.objectContaining({ query: { onSale: 'true', sort: 'popular', pageSize: 8 } }),
    );

    const listings = screen.getByRole('region', { name: 'สัตว์ประกาศขายล่าสุด' });
    expect(
      (await within(listings).findByRole('link', { name: 'Swamp buffalo cow' })).getAttribute(
        'href',
      ),
    ).toBe('/market/listing/l1');

    const best = screen.getByRole('region', { name: 'สินค้าขายดี' });
    await within(best).findByRole('link', { name: 'Best seller' });
    // The tab is the Thai category name (staging QA 2026-11-25: it was English).
    await userEvent.click(await within(best).findByRole('button', { name: 'อาหารสัตว์' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        'GET',
        '/shop/products',
        expect.objectContaining({ query: { sort: 'popular', pageSize: 4, category: 'feed' } }),
      ),
    );

    const community = screen.getByRole('region', { name: 'เรื่องเล่าจากชุมชน' });
    expect(await within(community).findByText(/raised my buffalo calves/)).toBeTruthy();
    expect(within(community).getByRole('link', { name: 'อ่านต่อ' }).getAttribute('href')).toBe(
      '/community/posts/post1',
    );
  });

  it('the hero slider moves with its controls', () => {
    renderAs(
      <Routes>
        <Route path="/" element={<App />} />
      </Routes>,
      { status: 'anonymous', route: '/' },
    );
    const first = screen.getByRole('heading', { level: 1 }).textContent;
    fireEvent.click(screen.getByRole('button', { name: 'สไลด์ถัดไป' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toBe(first);
    fireEvent.click(screen.getByRole('button', { name: /ไปที่สไลด์ 1/ }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(first);
  });
});

describe('site header and footer', () => {
  it('signed in: account, cart count, and the search sends the query to the chosen section', async () => {
    renderAs(
      <>
        <SiteHeader />
        <Where />
      </>,
      { route: '/' },
    );
    await userEvent.click(screen.getByRole('button', { name: 'บัญชีของฉัน' }));
    expect(screen.getByRole('menuitem', { name: 'โปรไฟล์' }).getAttribute('href')).toBe(
      '/farms/profile',
    );
    expect(screen.getByRole('menuitem', { name: 'ตั้งค่า' }).getAttribute('href')).toBe(
      '/farms/settings',
    );
    expect(await screen.findByRole('link', { name: 'ตะกร้าสินค้า 3 ชิ้น' })).toBeTruthy();

    await userEvent.type(screen.getByLabelText('คำค้นหา'), 'pellets');
    await userEvent.click(screen.getByRole('button', { name: 'ค้นหา' }));
    expect(screen.getByTestId('where').textContent).toBe('/shop?q=pellets');

    await userEvent.selectOptions(screen.getByLabelText('ค้นหาใน'), 'market');
    await userEvent.click(screen.getByRole('button', { name: 'ค้นหา' }));
    expect(screen.getByTestId('where').textContent).toBe('/market?q=pellets');
  });

  it('signed out: a sign-in link, an empty cart and no API calls', () => {
    renderAs(<SiteHeader />, { status: 'anonymous', route: '/' });
    expect(screen.getByRole('link', { name: /เข้าสู่ระบบ/ }).getAttribute('href')).toBe(
      '/farms/sign-in',
    );
    expect(screen.getByRole('link', { name: 'ตะกร้าสินค้า 0 ชิ้น' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'เมนูหลัก' })).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });

  it('the footer links only to pages that exist', () => {
    renderAs(<SiteFooter />, { route: '/' });
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/market/orders');
    for (const href of hrefs)
      expect(href).toMatch(/^\/(shop|market|farms|community|videos|live|messages|help)/);
  });
});

describe('shop browse reads its filters from the URL', () => {
  it('a header search or category link opens the shop already filtered', async () => {
    renderAs(
      <Routes>
        <Route path="/shop" element={<ShopBrowsePage />} />
      </Routes>,
      { route: '/shop?q=pellets&category=feed&onSale=true' },
    );
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        'GET',
        '/shop/products',
        expect.objectContaining({
          query: expect.objectContaining({ q: 'pellets', category: 'feed', onSale: 'true' }),
        }),
      ),
    );
  });
});

describe('language switch (TH | EN)', () => {
  it('the home page renders in Thai and re-renders in English when the language changes', () => {
    renderAs(
      <Routes>
        <Route path="/" element={<App />} />
      </Routes>,
      { status: 'anonymous', route: '/' },
    );
    expect(screen.getByRole('heading', { name: 'เลือกดูตามหมวดหมู่' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'ข่าวสารและโปรโมชัน' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'เข้าสู่ระบบ' })).toBeTruthy();

    act(() => setLocale('en'));
    expect(screen.getByRole('heading', { name: 'Browse by category' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'News and promotions' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
      '/farms/sign-in',
    );
    expect(screen.getByRole('button', { name: 'Next slide' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'เลือกดูตามหมวดหมู่' })).toBeNull();
  });

  it('the toggle in the header sets <html lang>, remembers the choice and re-renders the header', async () => {
    // Node shadows jsdom's localStorage: give the page an in-memory one for this test.
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => void stored.set(k, String(v)),
      removeItem: (k: string) => void stored.delete(k),
    });
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    renderAs(<SiteHeader />, { status: 'anonymous', route: '/' });
    expect(document.documentElement.lang).toBe('th');
    expect(screen.getByRole('navigation', { name: 'เมนูหลัก' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ตะกร้าสินค้า 0 ชิ้น' })).toBeTruthy();

    await userEvent.click(screen.getByRole('radio', { name: 'English' }));
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem('farmplus.locale')).toBe('en');
    expect((screen.getByRole('radio', { name: 'English' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('navigation', { name: 'Main menu' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cart, 0 items' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Sign in/ }).getAttribute('href')).toBe(
      '/farms/sign-in',
    );
    expect(screen.getByRole('link', { name: 'Register' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Colour theme' })).toBeTruthy();

    await userEvent.click(screen.getByRole('radio', { name: 'ภาษาไทย' }));
    expect(document.documentElement.lang).toBe('th');
    expect(localStorage.getItem('farmplus.locale')).toBe('th');
    expect(screen.getByRole('navigation', { name: 'เมนูหลัก' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'ธีมสี' })).toBeTruthy();
  });

  it('the footer follows the language too', () => {
    renderAs(
      <>
        <LanguageToggle />
        <SiteFooter />
      </>,
      { route: '/' },
    );
    expect(screen.getByRole('navigation', { name: 'สำหรับผู้ขาย' })).toBeTruthy();
    act(() => setLocale('en'));
    expect(screen.getByRole('navigation', { name: 'For sellers' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'My orders' }).getAttribute('href')).toBe(
      '/market/orders',
    );
  });
});
