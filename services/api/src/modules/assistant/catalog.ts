/**
 * The only pages the assistant may link to (docs/architecture/assistant.md). The model picks ids from this list; a
 * link is shown only when the person may open the page. Farm-specific pages (/farms/:id/…) are reached from "My farm",
 * so they are not listed.
 */
export type Audience = 'any' | 'guest' | 'member' | 'farm_owner' | 'seller';

export interface CatalogPage {
  id: string;
  path: string;
  th: string;
  en: string;
  audience: Audience;
}

export const PAGE_CATALOG: readonly CatalogPage[] = [
  { id: 'home', path: '/', th: 'หน้าแรก', en: 'Home', audience: 'any' },
  { id: 'help', path: '/help', th: 'ศูนย์ช่วยเหลือ', en: 'Help centre', audience: 'any' },
  { id: 'sign-in', path: '/farms/sign-in', th: 'เข้าสู่ระบบ', en: 'Sign in', audience: 'guest' },
  { id: 'register', path: '/farms/register', th: 'สมัครสมาชิก', en: 'Register', audience: 'guest' },
  {
    id: 'forgot-password',
    path: '/farms/forgot-password',
    th: 'ลืมรหัสผ่าน',
    en: 'Forgot password',
    audience: 'guest',
  },
  { id: 'my-farms', path: '/farms', th: 'ฟาร์มของฉัน', en: 'My farms', audience: 'member' },
  { id: 'farm-list', path: '/farms/list', th: 'รายการฟาร์ม', en: 'Farm list', audience: 'member' },
  {
    id: 'create-farm',
    path: '/farms/new',
    th: 'สร้างฟาร์ม',
    en: 'Create a farm',
    audience: 'farm_owner',
  },
  {
    id: 'owner-request',
    path: '/farms/owner-request',
    th: 'ขอสิทธิ์เจ้าของฟาร์ม',
    en: 'Request farm-owner access',
    audience: 'member',
  },
  {
    id: 'seller-apply',
    path: '/farms/seller',
    th: 'สมัครเป็นผู้ขาย',
    en: 'Become a seller',
    audience: 'member',
  },
  { id: 'profile', path: '/farms/profile', th: 'โปรไฟล์', en: 'Profile', audience: 'member' },
  {
    id: 'settings',
    path: '/farms/settings',
    th: 'ตั้งค่าบัญชีและความปลอดภัย',
    en: 'Account and security settings',
    audience: 'member',
  },
  {
    id: 'invitations',
    path: '/farms/invitations',
    th: 'คำเชิญของฉัน',
    en: 'My invitations',
    audience: 'member',
  },
  { id: 'market', path: '/market', th: 'ตลาดสัตว์', en: 'Livestock market', audience: 'member' },
  {
    id: 'market-sell',
    path: '/market/sell',
    th: 'ขายสัตว์',
    en: 'Sell animals',
    audience: 'seller',
  },
  {
    id: 'my-offers',
    path: '/market/offers',
    th: 'ข้อเสนอของฉัน',
    en: 'My offers',
    audience: 'member',
  },
  {
    id: 'my-orders',
    path: '/market/orders',
    th: 'คำสั่งซื้อของฉัน',
    en: 'My orders',
    audience: 'member',
  },
  { id: 'wallet', path: '/market/wallet', th: 'กระเป๋าเงิน', en: 'Wallet', audience: 'member' },
  {
    id: 'saved',
    path: '/market/favorites',
    th: 'ที่บันทึกไว้',
    en: 'Saved listings',
    audience: 'member',
  },
  { id: 'shop', path: '/shop', th: 'ร้านค้า', en: 'Shop', audience: 'member' },
  { id: 'shop-sell', path: '/shop/sell', th: 'ขายสินค้า', en: 'Sell products', audience: 'seller' },
  { id: 'cart', path: '/shop/cart', th: 'ตะกร้า', en: 'Cart', audience: 'member' },
  { id: 'community', path: '/community', th: 'ชุมชน', en: 'Community', audience: 'member' },
  { id: 'videos', path: '/videos', th: 'วิดีโอ', en: 'Videos', audience: 'member' },
  {
    id: 'video-upload',
    path: '/videos/upload',
    th: 'อัปโหลดวิดีโอ',
    en: 'Upload a video',
    audience: 'member',
  },
  { id: 'live', path: '/live', th: 'ไลฟ์', en: 'Live', audience: 'member' },
  { id: 'live-host', path: '/live/host', th: 'เริ่มไลฟ์', en: 'Go live', audience: 'member' },
];

export const pageById = (id: string): CatalogPage | undefined =>
  PAGE_CATALOG.find((p) => p.id === id);

/** Whether a page may be offered to this person (null = guest). Roles come from the server-side access, never input. */
export function mayOpen(page: CatalogPage, roleKeys: readonly string[] | null): boolean {
  switch (page.audience) {
    case 'any':
      return true;
    case 'guest':
      return roleKeys === null;
    case 'member':
      return roleKeys !== null;
    case 'farm_owner':
      return roleKeys !== null && roleKeys.includes('farm_owner');
    case 'seller':
      return roleKeys !== null && roleKeys.includes('seller');
  }
}

/** Guided tours the assistant may suggest (the ids in apps/web/src/tours/registry.ts; a test keeps them in step). */
export const TOUR_IDS: readonly string[] = [
  'help-centre',
  'welcome',
  'farm-list-empty',
  'farm-setup',
  'farm-dashboard',
  'animal-new',
  'animal-profile',
  'records-health',
  'records-weights',
  'records-feeding',
  'records-expenses',
  'records-breeding',
  'farm-staff',
  'seller-apply',
  'listing-new',
  'market-sell',
  'shop-sell',
  'market-buyer',
  'market-listing',
  'community',
  'video-upload',
  'live-host',
];
