import type { TourDefinition, TourStep } from './types';

/** Short helper: step `n` of tour text group `group` (keys `<group>.<n>.title|body` in the `tours` catalog). */
const step = (
  group: string,
  n: number,
  anchor: string,
  extra: Omit<TourStep, 'anchor' | 'titleKey' | 'bodyKey'> = {},
): TourStep => ({
  anchor,
  titleKey: `${group}.${n}.title`,
  bodyKey: `${group}.${n}.body`,
  ...extra,
});

/** The fixed pages under /farms that the pattern `/farms/:farmId` would otherwise also match. */
const FARMS_FIXED = [
  'new',
  'list',
  'seller',
  'owner-request',
  'profile',
  'settings',
  'invitations',
  'sign-in',
  'register',
  'verify-email',
  'forgot-password',
  'reset-password',
  'oauth-callback',
].map((p) => `/farms/${p}`);

/** One tour per record kind ("the first time of each kind"): same steps and texts, its own name and progress. */
const recordTour = (
  kind: 'health' | 'weights' | 'feeding' | 'expenses' | 'breeding',
): TourDefinition => ({
  id: `records-${kind}`,
  version: 1,
  routes: [`/farms/:farmId/${kind}`],
  audience: 'member',
  steps: [
    step('records', 1, 'records-add', { optional: true, helpSlug: 'farm-records' }),
    step('records', 2, 'records-filters'),
    step('records', 3, 'records-show-voided', { helpSlug: 'farm-records' }),
    ...(kind === 'expenses' ? [step('records', 4, 'records-spending', { optional: true })] : []),
  ],
});

/**
 * Every guided tour. Keep each one short (3–7 steps, ≤ 2 lines per step). The test `test/tours.test.tsx` checks that
 * every text key exists in Thai and English and every `helpSlug` is a real help article.
 */
export const TOURS: TourDefinition[] = [
  {
    id: 'help-centre',
    version: 1,
    routes: ['/help'],
    startPath: '/help',
    audience: 'any',
    steps: [
      { anchor: 'help-search', titleKey: 'help-centre.1.title', bodyKey: 'help-centre.1.body' },
      {
        anchor: 'help-getting-started',
        titleKey: 'help-centre.2.title',
        bodyKey: 'help-centre.2.body',
        helpSlug: 'account-overview',
      },
      {
        anchor: 'help-tours',
        titleKey: 'help-centre.3.title',
        bodyKey: 'help-centre.3.body',
        optional: true,
      },
    ],
  },
  {
    // First signed-in visit to the home page. The desktop menu and the phone "Menu" button are both listed: only the
    // one that can be seen at this width is shown.
    id: 'welcome',
    version: 1,
    routes: ['/'],
    startPath: '/',
    audience: 'member',
    steps: [
      step('welcome', 1, 'home-welcome', { helpSlug: 'account-overview' }),
      step('welcome', 2, 'main-menu', { optional: true }),
      step('welcome', 3, 'main-menu-toggle', { optional: true }),
      step('welcome', 4, 'nav-my-farm', { optional: true, helpSlug: 'create-farm' }),
      step('welcome', 5, 'account-menu', { helpSlug: 'verify-identity-seller' }),
    ],
  },
  {
    // Only shown while the list is empty. People who may create a farm are sent to the setup straight away (farm-setup).
    id: 'farm-list-empty',
    version: 1,
    routes: ['/farms', '/farms/list'],
    startPath: '/farms/list',
    audience: 'member',
    steps: [
      step('farm-list-empty', 1, 'farm-list-empty'),
      step('farm-list-empty', 2, 'farm-owner-request', {
        optional: true,
        helpSlug: 'request-farm-owner',
      }),
      // Only for people who may create a farm (the others see the request link of step 2 instead).
      step('farm-list-empty', 3, 'farm-create', { optional: true, helpSlug: 'create-farm' }),
    ],
  },
  {
    // Follows the wizard: steps on its next screens wait until the person presses the form's own "Next".
    id: 'farm-setup',
    version: 1,
    routes: ['/farms/new'],
    startPath: '/farms/new',
    audience: 'member',
    steps: [
      step('farm-setup', 1, 'farm-name', { helpSlug: 'create-farm' }),
      step('farm-setup', 2, 'farm-animal-types'),
      step('farm-setup', 3, 'farm-setup-submit', { advanceOnClick: true }),
      step('farm-setup', 4, 'farm-location', { later: true }),
      step('farm-setup', 5, 'farm-map-pin', { later: true }),
      step('farm-setup', 6, 'farm-setup-submit', { advanceOnClick: true, later: true }),
      step('farm-setup', 7, 'farm-contact', { later: true, helpSlug: 'create-farm' }),
    ],
  },
  {
    // The farm's overview (where /farms leads), with the shell's menu, search and notifications.
    id: 'farm-dashboard',
    version: 1,
    routes: ['/farms/:farmId'],
    notOn: FARMS_FIXED,
    audience: 'member',
    steps: [
      step('farm-dashboard', 1, 'farm-home-title', { helpSlug: 'farm-overview' }),
      step('farm-dashboard', 2, 'farm-kpis', { optional: true }),
      step('farm-dashboard', 3, 'farm-growth-alert', { optional: true, helpSlug: 'farm-records' }),
      step('farm-dashboard', 4, 'farm-sidebar-menu', { optional: true }),
      step('farm-dashboard', 5, 'farm-menu-toggle'),
      step('farm-dashboard', 6, 'farm-search', { optional: true }),
      step('farm-dashboard', 7, 'farm-notifications', { optional: true }),
    ],
  },
  {
    id: 'animal-new',
    version: 1,
    routes: ['/farms/:farmId/animals/new'],
    audience: 'member',
    steps: [
      step('animal-new', 1, 'animal-code', { helpSlug: 'add-animal' }),
      step('animal-new', 2, 'animal-type'),
      step('animal-new', 3, 'animal-sex'),
      step('animal-new', 4, 'animal-first-weight', { optional: true }),
      step('animal-new', 5, 'animal-birth'),
      step('animal-new', 6, 'animal-parents'),
      step('animal-new', 7, 'animal-save', { helpSlug: 'add-animal' }),
    ],
  },
  {
    id: 'animal-profile',
    version: 1,
    routes: ['/farms/:farmId/animals/:animalId'],
    notOn: ['/farms/:farmId/animals/new'],
    audience: 'member',
    steps: [
      step('animal-profile', 1, 'animal-info', { helpSlug: 'add-animal' }),
      step('animal-profile', 2, 'animal-growth', { optional: true, helpSlug: 'farm-records' }),
      step('animal-profile', 3, 'animal-health', { optional: true }),
      step('animal-profile', 4, 'animal-pedigree'),
      step('animal-profile', 5, 'animal-history', { optional: true }),
      step('animal-profile', 6, 'animal-assessment', { optional: true }),
      step('animal-profile', 7, 'animal-list-for-sale', {
        optional: true,
        helpSlug: 'list-animal-for-sale',
      }),
    ],
  },
  recordTour('health'),
  recordTour('weights'),
  recordTour('feeding'),
  recordTour('expenses'),
  recordTour('breeding'),
  {
    // Owners only in practice: the invite form (first step) is only on an owner's page.
    id: 'farm-staff',
    version: 1,
    routes: ['/farms/:farmId/staff'],
    audience: 'member',
    steps: [
      step('farm-staff', 1, 'staff-invite', { helpSlug: 'farm-staff' }),
      step('farm-staff', 2, 'staff-invite-role'),
      step('farm-staff', 3, 'staff-invite-permissions'),
      step('farm-staff', 4, 'staff-join-link'),
      step('farm-staff', 5, 'staff-invitations'),
      step('farm-staff', 6, 'staff-request-actions', { optional: true }),
      step('farm-staff', 7, 'staff-member-actions', { optional: true }),
    ],
  },
  {
    id: 'seller-apply',
    version: 1,
    routes: ['/farms/seller'],
    startPath: '/farms/seller',
    audience: 'member',
    steps: [
      step('seller-apply', 1, 'seller-why', { helpSlug: 'verify-identity-seller' }),
      step('seller-apply', 2, 'seller-identity', { optional: true }),
      step('seller-apply', 3, 'seller-application'),
      step('seller-apply', 4, 'seller-status', { optional: true }),
      step('seller-apply', 5, 'seller-reason', { optional: true }),
    ],
  },
  {
    // Not yet an approved seller: the first step points at "Apply to become a seller" (only shown to them).
    id: 'listing-new',
    version: 1,
    routes: ['/farms/:farmId/listings/new'],
    audience: 'member',
    steps: [
      step('listing-new', 1, 'listing-become-seller', {
        optional: true,
        helpSlug: 'verify-identity-seller',
      }),
      step('listing-new', 2, 'listing-animal', { helpSlug: 'list-animal-for-sale' }),
      step('listing-new', 3, 'listing-price'),
      step('listing-new', 4, 'listing-negotiable'),
      step('listing-new', 5, 'listing-photos'),
      step('listing-new', 6, 'listing-save', { helpSlug: 'list-animal-for-sale' }),
      step('listing-new', 7, 'listing-back-to-listings'),
    ],
  },
  {
    id: 'market-sell',
    version: 1,
    routes: ['/market/sell'],
    startPath: '/market/sell',
    audience: 'member',
    steps: [
      step('market-sell', 1, 'market-sell-farm', {
        optional: true,
        helpSlug: 'list-animal-for-sale',
      }),
      step('market-sell', 2, 'market-sell-no-farms', { optional: true, helpSlug: 'create-farm' }),
      step('market-sell', 3, 'market-sell-earnings'),
    ],
  },
  {
    id: 'shop-sell',
    version: 1,
    routes: ['/shop/sell/:farmId/new'],
    audience: 'member',
    steps: [
      step('shop-sell', 1, 'shop-become-seller', {
        optional: true,
        helpSlug: 'verify-identity-seller',
      }),
      step('shop-sell', 2, 'shop-category', { helpSlug: 'sell-products' }),
      step('shop-sell', 3, 'shop-name'),
      step('shop-sell', 4, 'shop-price'),
      step('shop-sell', 5, 'shop-stock', { optional: true }),
      step('shop-sell', 6, 'shop-photos'),
      step('shop-sell', 7, 'shop-save', { helpSlug: 'sell-products' }),
    ],
  },
  {
    id: 'market-buyer',
    version: 1,
    routes: ['/market'],
    startPath: '/market',
    audience: 'member',
    steps: [
      step('market-buyer', 1, 'market-search', { helpSlug: 'buy-animals' }),
      step('market-buyer', 2, 'market-filters'),
      step('market-buyer', 3, 'market-favorites'),
      step('market-buyer', 4, 'market-my-offers'),
      step('market-buyer', 5, 'header-orders', { optional: true }),
      step('market-buyer', 6, 'header-wallet', { optional: true, helpSlug: 'buy-animals' }),
    ],
  },
  {
    id: 'market-listing',
    version: 1,
    routes: ['/market/listing/:id'],
    audience: 'member',
    steps: [
      step('market-listing', 1, 'listing-summary', { helpSlug: 'buy-animals' }),
      step('market-listing', 2, 'listing-favorite', { optional: true }),
      step('market-listing', 3, 'listing-make-offer', { optional: true, helpSlug: 'buy-animals' }),
      step('market-listing', 4, 'listing-open-negotiation', { optional: true }),
      step('market-listing', 5, 'listing-contact-seller', { optional: true }),
    ],
  },
  {
    id: 'community',
    version: 1,
    routes: ['/community'],
    startPath: '/community',
    audience: 'member',
    steps: [
      step('community', 1, 'community-composer', { helpSlug: 'community-videos-live' }),
      step('community', 2, 'community-add-media'),
      step('community', 3, 'community-visibility'),
      step('community', 4, 'community-post'),
      step('community', 5, 'community-feed-filters'),
    ],
  },
  {
    id: 'video-upload',
    version: 1,
    routes: ['/videos/upload'],
    startPath: '/videos/upload',
    audience: 'member',
    steps: [
      step('video-upload', 1, 'video-file', { helpSlug: 'community-videos-live' }),
      step('video-upload', 2, 'video-title'),
      step('video-upload', 3, 'video-visibility'),
      step('video-upload', 4, 'video-upload'),
    ],
  },
  {
    id: 'live-host',
    version: 1,
    routes: ['/live/host'],
    startPath: '/live/host',
    audience: 'member',
    steps: [
      step('live-host', 1, 'live-intro', { helpSlug: 'community-videos-live' }),
      step('live-host', 2, 'live-title'),
      step('live-host', 3, 'live-access'),
      step('live-host', 4, 'live-create'),
    ],
  },
];

export const tourById = (id: string): TourDefinition | undefined => TOURS.find((t) => t.id === id);
