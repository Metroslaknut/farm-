import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';
import { RouteErrorBoundary } from '../../../components/layout/RouteErrorBoundary';
import type { FarmDetail, NotificationPage } from '@farmplus/shared-types';
import { api } from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { Icon, type IconName } from '../../../components/layout/Icon';
import { ThemeToggle } from '../../../components/layout/ThemeToggle';
import { useLocale, useT } from '../../../i18n';
import { formatDateTime } from '../../../lib/format';
import { InboxProvider, useInbox } from '../../../lib/inbox';
import { useAsync } from '../../../lib/useAsync';
import { useFarmsT, type FarmsKey } from '../labels';
import { useFarm } from '../useFarmAccess';
import { useFarmSetup } from '../useFarmSetup';
import { useTours } from '../../../tours/TourProvider';
import '../../../styles/index.css';
import './shell.css';
// Same self-hosted fonts as the public layout (the CSP allows fonts from this origin only).
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/noto-sans-thai/400.css';
import '@fontsource/noto-sans-thai/500.css';
import '@fontsource/noto-sans-thai/600.css';
import '@fontsource/noto-sans-thai/700.css';

interface Leaf {
  key: FarmsKey;
  to: string;
  end?: boolean;
}
interface Group {
  key: FarmsKey;
  icon: IconName;
  /** A group with one link renders as a plain menu item (no accordion). */
  items: Leaf[];
}

/** Path segments under /farms that are pages, not farm ids. */
const RESERVED = new Set([
  'sign-in',
  'register',
  'verify-email',
  'oauth-callback',
  'profile',
  'settings',
  'new',
  'list',
  'invitations',
  'seller',
  'owner-request',
  'forgot-password',
  'reset-password',
]);

/** Guided-tour anchors (`data-tour`) of the sidebar groups a tour points at. */
const GROUP_TOUR_ANCHORS: Partial<Record<FarmsKey, string>> = {
  'shell.group.animals': 'farm-menu-animals',
  'shell.group.records': 'farm-menu-records',
  'shell.group.trade': 'farm-menu-trades',
};

const MOBILE = '(max-width: 1023px)';
const isMobile = () => typeof window !== 'undefined' && window.matchMedia?.(MOBILE).matches;

/** Menu for the current farm, filtered by what the caller may do on it (the API enforces it anyway). */
function menu(farm: FarmDetail | undefined, canCreateFarm: boolean): Group[] {
  const groups: Group[] = [];
  if (farm) {
    const can = new Set<string>(farm.access.permissions);
    const writable = farm.status !== 'archived';
    const f = `/farms/${farm.id}`;
    const pick = (items: (Leaf | false)[]) => items.filter((i): i is Leaf => Boolean(i));
    groups.push({
      key: 'shell.group.dashboard',
      icon: 'grid',
      items: pick([
        { key: 'shell.overview', to: f, end: true },
        can.has('farm.read') && { key: 'shell.analytics', to: `${f}/dashboard` },
      ]),
    });
    if (can.has('animals.read'))
      groups.push({
        key: 'shell.group.animals',
        icon: 'cow',
        items: pick([
          { key: 'myFarm.menu.animals', to: `${f}/animals`, end: true },
          can.has('animals.write') &&
            writable && { key: 'myFarm.menu.addAnimal', to: `${f}/animals/new` },
          { key: 'myFarm.menu.lineage', to: `${f}/lineage` },
        ]),
      });
    if (can.has('records.read') || can.has('breeding.read'))
      groups.push({
        key: 'shell.group.records',
        icon: 'clipboard',
        items: pick([
          can.has('breeding.read') && { key: 'kind.breeding.plural', to: `${f}/breeding` },
          can.has('records.read') && { key: 'overview.health', to: `${f}/health` },
          can.has('records.read') && { key: 'myFarm.menu.growth', to: `${f}/weights` },
          can.has('records.read') && { key: 'kind.feeding.plural', to: `${f}/feeding` },
          can.has('expenses.read') && { key: 'kind.expenses.plural', to: `${f}/expenses` },
        ]),
      });
    if (can.has('listings.manage'))
      groups.push({
        key: 'shell.group.trade',
        icon: 'tag',
        items: pick([
          writable && { key: 'myFarm.menu.sell', to: `${f}/listings/new` },
          { key: 'overview.openListings', to: `${f}/listings`, end: true },
          { key: 'myFarm.menu.trades', to: `${f}/trades` },
        ]),
      });
    groups.push({
      key: 'shell.group.farm',
      icon: 'home',
      items: pick([
        { key: 'shell.farmInfo', to: `${f}/info` },
        can.has('members.read') && { key: 'shell.staff', to: `${f}/staff` },
        can.has('farm.update') && writable && { key: 'shell.farmSettings', to: `${f}/edit` },
      ]),
    });
  }
  groups.push(
    { key: 'shell.orders', icon: 'box', items: [{ key: 'shell.orders', to: '/market/orders' }] },
    { key: 'shell.wallet', icon: 'wallet', items: [{ key: 'shell.wallet', to: '/market/wallet' }] },
    { key: 'shell.messages', icon: 'chat', items: [{ key: 'shell.messages', to: '/messages' }] },
    {
      key: 'shell.group.profile',
      icon: 'user',
      items: [
        { key: 'shell.profile', to: '/farms/profile' },
        { key: 'shell.settings', to: '/farms/settings' },
        { key: 'shell.allFarms', to: '/farms/list' },
        { key: 'shell.invitations', to: '/farms/invitations' },
        { key: 'shell.seller', to: '/farms/seller' },
        { key: 'shell.help', to: '/help' },
        ...(canCreateFarm ? [{ key: 'shell.newFarm' as const, to: '/farms/new' }] : []),
      ],
    },
  );
  return groups;
}

/** Open/close state for a popover: closes on Escape (focus back to the trigger) and on a click outside. */
function usePopover(): [
  boolean,
  (open: boolean) => void,
  RefObject<HTMLDivElement | null>,
  RefObject<HTMLButtonElement | null>,
] {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);
  return [open, setOpen, panel, trigger];
}

function Notifications() {
  const t = useFarmsT();
  const { counts, client } = useInbox();
  const [open, setOpen, panel, trigger] = usePopover();
  const ids = useId();
  const list = useAsync(
    (signal) =>
      open
        ? api.request<NotificationPage>('GET', '/notifications', { query: { limit: 5 }, signal })
        : Promise.resolve(null),
    [open],
  );
  if (!client) return null;
  const n = counts.notifications;
  return (
    <div className="fd-pop">
      <button
        ref={trigger}
        type="button"
        className="fd-icon-btn"
        aria-label={t('shell.notifications', { count: n })}
        data-tour="farm-notifications"
        aria-expanded={open}
        aria-controls={`${ids}-list`}
        onClick={() => setOpen(!open)}
      >
        <Icon name="bell" />
        {n > 0 && <span className="fd-icon-btn__badge">{n > 99 ? '99+' : n}</span>}
      </button>
      <div ref={panel} id={`${ids}-list`} className="fd-pop__panel fd-notes" hidden={!open}>
        <p className="fd-pop__title">
          {t('shell.notificationsTitle')}
          {n > 0 && <span className="fd-count">{n}</span>}
        </p>
        {list.data && list.data.items.length === 0 && (
          <p className="fd-muted">{t('shell.noNotifications')}</p>
        )}
        {list.loading && !list.data && <p className="fd-muted">{t('common.loading')}</p>}
        <ul>
          {list.data?.items.map((item) => (
            <li key={item.id} data-unread={!item.readAt}>
              <Link to={item.link ?? '/notifications'} onClick={() => setOpen(false)}>
                <span className="fd-avatar fd-avatar--sm" aria-hidden="true">
                  <Icon name="bell" size={16} />
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{formatDateTime(item.createdAt)}</small>
                  <span className="fd-notes__body">{item.body}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Link className="fd-pop__footer" to="/notifications" onClick={() => setOpen(false)}>
          {t('shell.allNotifications')}
        </Link>
      </div>
    </div>
  );
}

function AccountMenu() {
  const t = useFarmsT();
  const tt = useT('tours');
  const tours = useTours();
  const auth = useAuth();
  const navigate = useNavigate();
  const [open, setOpen, panel, trigger] = usePopover();
  const ids = useId();
  const name = auth.user?.displayName ?? '';
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '?';
  return (
    <div className="fd-pop">
      <button
        ref={trigger}
        type="button"
        className="fd-account"
        data-tour="farm-account-menu"
        aria-label={t('shell.account')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${ids}-menu`}
        onClick={() => setOpen(!open)}
      >
        {auth.user?.avatarUrl ? (
          <img className="fd-avatar" src={auth.user.avatarUrl} alt="" />
        ) : (
          <span className="fd-avatar" aria-hidden="true">
            {initials}
          </span>
        )}
        <span className="fd-account__name">{name}</span>
      </button>
      <div
        ref={panel}
        id={`${ids}-menu`}
        className="fd-pop__panel fd-menu"
        role="menu"
        aria-label={t('shell.account')}
        hidden={!open}
      >
        <p className="fd-menu__who">
          <strong>{name}</strong>
          {auth.user?.email && <small>{auth.user.email}</small>}
        </p>
        <Link to="/farms/profile" role="menuitem" onClick={() => setOpen(false)}>
          <Icon name="user" size={18} />
          {t('shell.profile')}
        </Link>
        <Link to="/farms/settings" role="menuitem" onClick={() => setOpen(false)}>
          <Icon name="shield" size={18} />
          {t('shell.settings')}
        </Link>
        {tours.toursHere[0] && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              tours.start(tours.toursHere[0]!.id);
            }}
          >
            {tt('ui.showAgain')}
          </button>
        )}
        <div className="fd-menu__theme">
          <span>{t('shell.theme')}</span>
          <ThemeToggle />
        </div>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false);
            void auth.logout().then(() => navigate('/farms/sign-in'));
          }}
        >
          <Icon name="arrowRight" size={18} />
          {t('shell.signOut')}
        </button>
      </div>
    </div>
  );
}

function SearchBox({ farmId }: { farmId: string | undefined }) {
  const t = useFarmsT();
  const navigate = useNavigate();
  const [open, setOpen, panel, trigger] = usePopover();
  const ids = useId();
  if (!farmId) return null;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get('q') ?? '').trim();
    setOpen(false);
    navigate(`/farms/${farmId}/animals${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  };
  return (
    <div className="fd-pop">
      <button
        ref={trigger}
        type="button"
        className="fd-icon-btn"
        aria-label={t('shell.search')}
        data-tour="farm-search"
        aria-expanded={open}
        aria-controls={`${ids}-search`}
        onClick={() => setOpen(!open)}
      >
        <Icon name="search" />
      </button>
      <div ref={panel} id={`${ids}-search`} className="fd-pop__panel fd-search" hidden={!open}>
        <form role="search" onSubmit={submit}>
          <label className="ds-sr-only" htmlFor={`${ids}-q`}>
            {t('shell.search')}
          </label>
          <input
            id={`${ids}-q`}
            name="q"
            type="search"
            maxLength={80}
            placeholder={t('shell.searchPlaceholder')}
            // Opening the search is an explicit request to type.
            autoFocus
          />
          <button type="submit" className="fd-icon-btn" aria-label={t('common.search')}>
            <Icon name="search" size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}

function LanguageButton() {
  const t = useFarmsT();
  const [locale, setLocale] = useLocale();
  return (
    <button
      type="button"
      className="fd-icon-btn"
      aria-label={t('shell.language')}
      title={t('shell.language')}
      onClick={() => setLocale(locale === 'th' ? 'en' : 'th')}
    >
      <Icon name="translate" />
    </button>
  );
}

function Sidebar({
  groups,
  farms,
  farmId,
  onNavigate,
}: {
  groups: Group[];
  farms: { id: string; name: string }[];
  farmId: string | undefined;
  onNavigate: () => void;
}) {
  const t = useFarmsT();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const ids = useId();
  const contains = (g: Group) =>
    g.items.some((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to)));
  // Groups the user opened or closed; otherwise the group holding the current page is open.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const isOpen = (g: Group) => toggled[g.key] ?? contains(g);

  return (
    <aside className="fd-sidebar" id="fd-sidebar">
      <Link to={farmId ? `/farms/${farmId}` : '/farms'} className="fd-logo" onClick={onNavigate}>
        <span className="fd-logo__mark" aria-hidden="true">
          <Icon name="sprout" size={22} />
        </span>
        <span>
          FARM<span className="fd-logo__plus">+</span>
        </span>
      </Link>
      {farms.length > 0 && (
        <div className="fd-farm-switch">
          <label htmlFor={`${ids}-farm`}>{t('shell.farm')}</label>
          <select
            id={`${ids}-farm`}
            value={farmId ?? ''}
            onChange={(e) => {
              onNavigate();
              navigate(`/farms/${e.target.value}`);
            }}
          >
            {!farmId && <option value="">{t('common.choose')}</option>}
            {farms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <nav aria-label={t('myFarm.menu')} className="fd-nav" data-tour="farm-sidebar-menu">
        <ul>
          {groups.map((g) => {
            if (g.items.length === 1 && g.items[0]!.key === g.key) {
              const item = g.items[0]!;
              return (
                <li key={g.key}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className="fd-nav__item"
                    onClick={onNavigate}
                  >
                    <Icon name={g.icon} />
                    <span>{t(item.key)}</span>
                  </NavLink>
                </li>
              );
            }
            const open = isOpen(g);
            const sub = `${ids}-${g.key}`;
            return (
              <li key={g.key}>
                <button
                  type="button"
                  className="fd-nav__item fd-nav__group"
                  aria-expanded={open}
                  aria-controls={sub}
                  data-current={contains(g) || undefined}
                  data-tour={GROUP_TOUR_ANCHORS[g.key]}
                  onClick={() => setToggled((s) => ({ ...s, [g.key]: !open }))}
                >
                  <Icon name={g.icon} />
                  <span>{t(g.key)}</span>
                  <Icon name="chevronDown" size={18} className="fd-nav__chevron" />
                </button>
                <ul id={sub} className="fd-nav__sub" hidden={!open}>
                  {g.items.map((i) => (
                    <li key={i.to}>
                      <NavLink to={i.to} end={i.end} onClick={onNavigate}>
                        {t(i.key)}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

function Shell() {
  const t = useFarmsT();
  const tl = useT('layout');
  const setup = useFarmSetup();
  const match = useMatch('/farms/:farmId/*');
  const segment = match?.params.farmId;
  const urlFarmId = segment && !RESERVED.has(segment) ? segment : undefined;
  const farmId = urlFarmId ?? setup.data?.farms[0]?.id;
  const { farm, missing } = useFarm(farmId);
  // One toggle: on wide screens it hides the sidebar, on narrow screens it opens the drawer.
  const [toggled, setToggled] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const closeDrawer = () => {
    if (isMobile()) setToggled(false);
  };
  useEffect(() => {
    if (!toggled || !isMobile()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setToggled(false);
      toggle.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggled]);

  const farms = setup.data?.farms ?? [];
  const groups = menu(
    farm && farm.id === farmId ? farm : undefined,
    Boolean(setup.data?.canCreateFarm),
  );

  return (
    <div className="ds-root fd-shell" data-toggled={toggled}>
      <a href="#main" className="ds-skip">
        {tl('skipToContent')}
      </a>
      <Sidebar
        groups={groups}
        farms={farms.some((f) => f.id === farmId) || !farm ? farms : [...farms, farm]}
        farmId={farmId}
        onNavigate={closeDrawer}
      />
      <button
        type="button"
        className="fd-scrim"
        aria-label={t('shell.closeMenu')}
        tabIndex={-1}
        onClick={() => setToggled(false)}
      />
      <div className="fd-body">
        <header className="fd-topbar">
          <button
            ref={toggle}
            type="button"
            className="fd-icon-btn fd-icon-btn--plain"
            aria-label={t('shell.toggleMenu')}
            data-tour="farm-menu-toggle"
            aria-controls="fd-sidebar"
            onClick={() => setToggled(!toggled)}
          >
            <Icon name="menu" size={24} />
          </button>
          <div className="fd-topbar__actions">
            <SearchBox farmId={farmId} />
            <Notifications />
            <LanguageButton />
            <AccountMenu />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="fd-main">
          <RouteErrorBoundary>
            {missing && urlFarmId ? (
              // A farm that does not exist (or is not the user's): say so, instead of a page with filters and a
              // "try again" that can never work (staging QA #19).
              <div className="ds-card" role="alert">
                <h1>{t('farmMissing.title')}</h1>
                <p>{t('farmMissing.body')}</p>
                <p>
                  <Link to="/farms/list">{t('farmMissing.list')}</Link>
                </p>
              </div>
            ) : (
              <Outlet />
            )}
          </RouteErrorBoundary>
        </main>
        <footer className="fd-footer">
          <p>{t('shell.copyright', { year: new Date().getFullYear() })}</p>
          <nav aria-label={t('shell.footerNav')}>
            <Link to="/">{t('shell.footerHome')}</Link>
            <Link to="/market">{t('shell.footerMarket')}</Link>
            <Link to="/messages">{t('shell.footerHelp')}</Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}

/**
 * "My farm" back office: a dashboard layout (sidebar menu, top bar, footer) for everything a signed-in user does
 * with their farms. Sign-in, registration and the forced farm setup keep the public layout.
 */
export function FarmShell() {
  return (
    <InboxProvider>
      <Shell />
    </InboxProvider>
  );
}
