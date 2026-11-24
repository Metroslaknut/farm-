import { useContext, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import type { CartDTO } from '@farmplus/shared-types';
import { api } from '../../api';
import { localName } from '@farmplus/shared-utils';
import { shopCategories } from '../../lib/shopCategories';
import { AuthContext } from '../../auth/AuthContext';
import { useMinWidth } from '../../hooks/useMediaQuery';
import { useTours } from '../../tours/TourProvider';
import { useLocale, useT, type Translate } from '../../i18n';
import { useAsync } from '../../lib/useAsync';
import { InboxLinks } from '../inbox/InboxLinks';
import type { NavItem } from './Header';
import { Icon, type IconName } from './Icon';
import { LanguageToggle } from './LanguageToggle';
import { ThemeToggle } from './ThemeToggle';
import './site.css';

/** Main storefront navigation. */
const nav = (t: Translate<'layout'>): NavItem[] => [
  { to: '/', label: t('nav.home'), end: true },
  { to: '/shop', label: t('nav.shop') },
  { to: '/market', label: t('nav.market') },
  { to: '/farms', label: t('nav.farms') },
  { to: '/community', label: t('nav.community') },
  { to: '/videos', label: t('nav.videos') },
  { to: '/live', label: t('nav.live') },
];

/** Shown in the category menu when the shop categories cannot be read (signed out): the platform's own areas. */
const areas = (t: Translate<'layout'>): { to: string; label: string; icon: IconName }[] => [
  { to: '/shop', label: t('areas.shop'), icon: 'store' },
  { to: '/market', label: t('areas.market'), icon: 'cow' },
  { to: '/farms', label: t('areas.farms'), icon: 'home' },
  { to: '/community', label: t('areas.community'), icon: 'users' },
];

/** Line icon per shop category key (anything unknown gets a sprout). */
export function categoryIcon(key: string): IconName {
  if (key.includes('feed')) return 'wheat';
  if (key.includes('supplement') || key.includes('medicine') || key.includes('vet')) return 'pill';
  if (key.includes('equipment') || key.includes('tool')) return 'tools';
  if (key.includes('seed') || key.includes('plant')) return 'sprout';
  return 'box';
}

type Scope = 'shop' | 'market';

/**
 * Storefront header: green top bar, the main bar (logo, category menu, search, inbox, account and cart) and the
 * section navigation. Works with or without an AuthProvider above it: signed-out visitors get sign-in links and no
 * cart count. Below 768px the navigation collapses behind a menu button.
 */
export function SiteHeader() {
  const auth = useContext(AuthContext);
  const signedIn = auth?.status === 'authenticated';
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const ids = useId();
  const t = useT('layout');
  const tt = useT('tours');
  const tours = useTours();
  const [locale] = useLocale();
  // Phones (< 768px, the header's own breakpoint): the search box is too narrow for the full hint.
  const wideSearch = useMinWidth('md');

  // The cart count follows navigation (an item added on a product page shows up on the next page).
  const cart = useAsync(
    (signal) =>
      signedIn
        ? api.request<{ cart: CartDTO }>('GET', '/shop/cart', { signal })
        : Promise.resolve(null),
    [signedIn, pathname],
  );
  const cats = useAsync(() => (signedIn ? shopCategories() : Promise.resolve(null)), [signedIn]);
  const itemCount = cart.data?.cart.itemCount ?? 0;
  const categoryLinks =
    cats.data?.categories
      .filter((c) => c.salesEnabled)
      .map((c) => ({
        to: `/shop?category=${encodeURIComponent(c.key)}`,
        label: localName(c, locale),
        icon: categoryIcon(c.key),
      })) ?? areas(t);

  const [scope, setScope] = useState<Scope>('shop');
  const [q, setQ] = useState('');
  const search = (event: FormEvent) => {
    event.preventDefault();
    const text = q.trim();
    navigate(`/${scope}${text ? `?q=${encodeURIComponent(text)}` : ''}`);
  };

  // Both disclosures close on navigation (state is keyed by the path) and on Escape.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [catsFor, setCatsFor] = useState<string | null>(null);
  const [profileFor, setProfileFor] = useState<string | null>(null);
  const menuOpen = menuFor === pathname;
  const catsOpen = catsFor === pathname;
  const profileOpen = profileFor === pathname;
  const menuButton = useRef<HTMLButtonElement>(null);
  const catsButton = useRef<HTMLButtonElement>(null);
  const catsPanel = useRef<HTMLDivElement>(null);
  const profileButton = useRef<HTMLButtonElement>(null);
  const profilePanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen && !catsOpen && !profileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (catsOpen) catsButton.current?.focus();
      else if (profileOpen) profileButton.current?.focus();
      else menuButton.current?.focus();
      setCatsFor(null);
      setMenuFor(null);
      setProfileFor(null);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!catsPanel.current?.contains(target) && !catsButton.current?.contains(target))
        setCatsFor(null);
      if (!profilePanel.current?.contains(target) && !profileButton.current?.contains(target))
        setProfileFor(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [menuOpen, catsOpen, profileOpen]);

  const items = nav(t);

  return (
    <header className="site-header">
      <div className="site-topbar">
        <div className="site-container site-topbar__row">
          <p className="site-topbar__note">
            <span className="site-topbar__tag">{t('header.newTag')}</span>
            {t('header.newNote')}
          </p>
          <nav aria-label={t('header.quickLinks')} className="site-topbar__links">
            <a href="/#about">{t('header.about')}</a>
            <Link to="/market/orders">{t('header.trackOrders')}</Link>
            <Link to="/market/wallet">{t('header.wallet')}</Link>
          </nav>
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </div>

      <div className="site-main">
        <div className="site-container site-main__row">
          <Link to="/" className="site-logo" aria-label={t('header.logoHome')}>
            <span className="site-logo__mark" aria-hidden="true">
              <Icon name="sprout" size={22} />
            </span>
            <span>
              FARM<span className="site-logo__plus">+</span>
            </span>
          </Link>

          <div className="site-categories">
            <button
              ref={catsButton}
              type="button"
              className="site-categories__btn"
              aria-expanded={catsOpen}
              aria-controls={`${ids}-cats`}
              onClick={() => setCatsFor(catsOpen ? null : pathname)}
            >
              <Icon name="grid" size={18} />
              <span className="site-categories__label">{t('header.categories')}</span>
              <Icon name="chevronDown" size={16} />
            </button>
            <div
              ref={catsPanel}
              id={`${ids}-cats`}
              className="site-categories__panel"
              hidden={!catsOpen}
            >
              <ul>
                {categoryLinks.map((c) => (
                  <li key={c.to}>
                    <Link to={c.to}>
                      <Icon name={c.icon} size={20} />
                      {c.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <form className="site-search" role="search" onSubmit={search}>
            <label className="site-visually-hidden" htmlFor={`${ids}-scope`}>
              {t('header.searchIn')}
            </label>
            <select
              id={`${ids}-scope`}
              value={scope}
              onChange={(e) => setScope(e.target.value as Scope)}
            >
              <option value="shop">{t('header.scopeShop')}</option>
              <option value="market">{t('header.scopeMarket')}</option>
            </select>
            <label className="site-visually-hidden" htmlFor={`${ids}-q`}>
              {t('header.searchTerms')}
            </label>
            <input
              id={`${ids}-q`}
              type="search"
              value={q}
              maxLength={80}
              placeholder={t(
                wideSearch ? 'header.searchPlaceholder' : 'header.searchPlaceholderShort',
              )}
              onChange={(e) => setQ(e.target.value)}
            />
            <button type="submit">
              {t('header.search')}
              <Icon name="search" size={18} />
            </button>
          </form>

          <div className="site-actions">
            <InboxLinks />
            <Link
              to="/shop/cart"
              className="site-action"
              aria-label={t('header.cartLabel', { count: itemCount })}
            >
              <span className="site-action__icon">
                <Icon name="cart" />
                {itemCount > 0 && (
                  <span className="site-cart__count" aria-hidden="true">
                    {itemCount > 99 ? '99+' : itemCount}
                  </span>
                )}
              </span>
              <span className="site-action__text" aria-hidden="true">
                <small>{t('header.cart')}</small>
                {t('header.cartItems', { count: itemCount })}
              </span>
            </Link>
            {signedIn ? (
              <div className="site-profile-menu">
                <button
                  ref={profileButton}
                  type="button"
                  className="site-action site-profile-menu__trigger"
                  aria-label={t('header.myAccount')}
                  aria-haspopup="menu"
                  aria-expanded={profileOpen}
                  aria-controls={`${ids}-profile-menu`}
                  onClick={() => setProfileFor(profileOpen ? null : pathname)}
                >
                  <span className="site-action__icon">
                    <Icon name="user" />
                  </span>
                  <span className="site-action__text">
                    <small>{t('header.myAccount')}</small>
                    {auth?.user?.displayName}
                  </span>
                </button>
                <div
                  ref={profilePanel}
                  id={`${ids}-profile-menu`}
                  className="site-profile-menu__panel"
                  role="menu"
                  aria-label={t('header.myAccount')}
                  hidden={!profileOpen}
                >
                  <Link to="/farms/profile" role="menuitem" onClick={() => setProfileFor(null)}>
                    {t('header.profile')}
                  </Link>
                  <Link to="/farms/settings" role="menuitem" onClick={() => setProfileFor(null)}>
                    {t('header.settings')}
                  </Link>
                  <Link to="/farms/seller" role="menuitem" onClick={() => setProfileFor(null)}>
                    {t('header.becomeSeller')}
                  </Link>
                  <Link to="/help" role="menuitem" onClick={() => setProfileFor(null)}>
                    {t('header.help')}
                  </Link>
                  {tours.toursHere[0] && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setProfileFor(null);
                        tours.start(tours.toursHere[0]!.id);
                      }}
                    >
                      {tt('ui.showAgain')}
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setProfileFor(null);
                      void auth?.logout().then(() => navigate('/farms/sign-in'));
                    }}
                  >
                    {t('header.signOut')}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <Link to="/farms/sign-in" className="site-action">
                  <span className="site-action__icon">
                    <Icon name="user" />
                  </span>
                  <span className="site-action__text">
                    <small>{t('header.account')}</small>
                    {t('header.signIn')}
                  </span>
                </Link>
                <Link to="/farms/register" className="site-register">
                  {t('header.register')}
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="site-navbar">
        <div className="site-container site-navbar__row">
          <button
            ref={menuButton}
            type="button"
            className="site-navbar__toggle"
            aria-expanded={menuOpen}
            aria-controls={`${ids}-nav`}
            onClick={() => setMenuFor(menuOpen ? null : pathname)}
          >
            <Icon name="menu" size={18} />
            {menuOpen ? t('header.closeMenu') : t('header.menu')}
          </button>
          <nav
            id={`${ids}-nav`}
            aria-label={t('header.mainMenu')}
            className="site-navbar__nav"
            data-open={menuOpen}
          >
            <ul>
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} end={item.end}>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <Link to="/market/sell" className="site-navbar__cta">
            <Icon name="plus" size={18} />
            {t('header.sell')}
          </Link>
        </div>
      </div>
    </header>
  );
}
