import { useContext, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { CursorPage, ListingDTO, Page, PostDTO, ProductDTO } from '@farmplus/shared-types';
import { formatDate } from '@farmplus/i18n';
import { formatBaht, localName } from '@farmplus/shared-utils';
import { api } from './api';
import { shopCategories } from './lib/shopCategories';
import { AuthContext } from './auth/AuthContext';
import { Icon, type IconName } from './components/layout/Icon';
import { categoryIcon } from './components/layout/SiteHeader';
import { useLocale, useT, type Translate } from './i18n';
import { useAsync } from './lib/useAsync';
import './home.css';

// ---------------------------------------------------------------------------
// Static content
// ---------------------------------------------------------------------------
type T = Translate<'home'>;

/** Slides: texts are `home` catalog keys `slides.<key>.eyebrow|title|lead|cta`. */
const SLIDES = [
  { key: 'shop', tone: 'green', to: '/shop' },
  { key: 'market', tone: 'sand', to: '/market' },
  { key: 'farms', tone: 'ink', to: '/farms' },
] as const;

/** Platform areas shown as category cards when the shop categories cannot be read (signed out). */
const areas = (t: T): { to: string; label: string; icon: IconName }[] => [
  { to: '/shop', label: t('areas.shop'), icon: 'store' },
  { to: '/market', label: t('areas.market'), icon: 'cow' },
  { to: '/farms', label: t('areas.farms'), icon: 'home' },
  { to: '/community', label: t('areas.community'), icon: 'users' },
  { to: '/videos', label: t('areas.videos'), icon: 'video' },
  { to: '/live', label: t('areas.live'), icon: 'live' },
];

const FEATURES: { icon: IconName; key: 'price' | 'payment' | 'delivery' | 'chat' }[] = [
  { icon: 'tag', key: 'price' },
  { icon: 'shield', key: 'payment' },
  { icon: 'truck', key: 'delivery' },
  { icon: 'chat', key: 'chat' },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export function App() {
  const auth = useContext(AuthContext);
  const signedIn = auth?.status === 'authenticated';
  const t = useT('home');
  return (
    <div className="home">
      <Band>
        <div className="home-hero" data-tour="home-welcome">
          <HeroSlider />
          <div className="home-hero__side">
            <Link to="/market/sell" className="home-promo home-promo--soft">
              <span className="home-promo__eyebrow">{t('promo.sell.eyebrow')}</span>
              <strong>{t('promo.sell.title')}</strong>
              <span className="home-promo__link">
                {t('promo.sell.link')} <Icon name="arrowRight" size={16} />
              </span>
            </Link>
            <Link to="/shop?onSale=true" className="home-promo home-promo--green">
              <span className="home-promo__eyebrow">{t('promo.sale.eyebrow')}</span>
              <strong>{t('promo.sale.title')}</strong>
              <span className="home-promo__link">
                {t('promo.sale.link')} <Icon name="arrowRight" size={16} />
              </span>
            </Link>
          </div>
        </div>
      </Band>

      <Band>
        <Categories signedIn={signedIn} />
      </Band>

      <Band>
        <ul className="home-features" aria-label={t('features.label')}>
          {FEATURES.map((f) => (
            <li key={f.key} className="home-feature">
              <span className="home-feature__icon">
                <Icon name={f.icon} size={26} />
              </span>
              <div>
                <h3>{t(`features.${f.key}.title`)}</h3>
                <p>{t(`features.${f.key}.text`)}</p>
              </div>
            </li>
          ))}
        </ul>
      </Band>

      {signedIn ? (
        <>
          <Band tone="soft">
            <DealsSection />
          </Band>
          <Band>
            <ListingsSection />
          </Band>
          <Band tone="soft">
            <BestSellersSection />
          </Band>
          <Band>
            <CommunitySection />
          </Band>
        </>
      ) : (
        <Band tone="green">
          <section className="home-cta" aria-labelledby="home-signin-title">
            <div>
              <h2 id="home-signin-title">{t('signIn.title')}</h2>
              <p>{t('signIn.text')}</p>
            </div>
            <Link to="/farms/sign-in" className="home-btn home-btn--light">
              {t('signIn.button')}
            </Link>
          </section>
        </Band>
      )}

      <Band tone="soft">
        <section id="about" className="home-about" aria-labelledby="about-title">
          <div>
            <h2 id="about-title">{t('about.title')}</h2>
            <p>{t('about.text')}</p>
          </div>
          <div className="home-about__actions">
            <Link to="/market/sell" className="home-btn">
              {t('about.sellAnimals')}
            </Link>
            <Link to="/shop/sell" className="home-btn home-btn--outline">
              {t('about.openShop')}
            </Link>
          </div>
        </section>
      </Band>
    </div>
  );
}

/** A full-width band with the content held to the store container. */
function Band({ tone, children }: { tone?: 'soft' | 'green'; children: ReactNode }) {
  return (
    <div className={tone ? `home-band home-band--${tone}` : 'home-band'}>
      <div className="site-container">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero slider: auto-advances, paused on hover/focus, with a pause button, never for reduced motion
// ---------------------------------------------------------------------------
function HeroSlider() {
  const t = useT('home');
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [reduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const running = !paused && !hovered && !reduced;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), 6000);
    return () => clearInterval(timer);
  }, [running]);
  const go = (i: number) => setIndex((i + SLIDES.length) % SLIDES.length);
  const slide = SLIDES[index]!;

  return (
    <section
      className={`home-slider home-slider--${slide.tone}`}
      aria-roledescription="carousel"
      aria-label={t('slides.label')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <div
        className="home-slider__slide"
        role="group"
        aria-roledescription="slide"
        aria-label={t('slides.position', { index: index + 1, total: SLIDES.length })}
        aria-live={running ? 'off' : 'polite'}
      >
        <span className="home-slider__eyebrow">{t(`slides.${slide.key}.eyebrow`)}</span>
        <h1>{t(`slides.${slide.key}.title`)}</h1>
        <p>{t(`slides.${slide.key}.lead`)}</p>
        <Link to={slide.to} className="home-btn">
          {t(`slides.${slide.key}.cta`)}
          <Icon name="arrowRight" size={18} />
        </Link>
      </div>
      <div className="home-slider__controls">
        <button type="button" onClick={() => go(index - 1)} aria-label={t('slides.previous')}>
          <Icon name="chevronLeft" size={18} />
        </button>
        <button type="button" onClick={() => go(index + 1)} aria-label={t('slides.next')}>
          <Icon name="chevronRight" size={18} />
        </button>
        {!reduced && (
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? t('slides.play') : t('slides.pause')}
          >
            <Icon name={paused ? 'play' : 'pause'} size={16} />
          </button>
        )}
      </div>
      <div className="home-slider__dots">
        {SLIDES.map((s, i) => (
          <button
            key={s.key}
            type="button"
            aria-label={t('slides.goTo', { index: i + 1, name: t(`slides.${s.key}.eyebrow`) })}
            aria-current={i === index ? 'true' : undefined}
            onClick={() => go(i)}
          />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Category cards
// ---------------------------------------------------------------------------
function Categories({ signedIn }: { signedIn: boolean }) {
  const t = useT('home');
  const [locale] = useLocale();
  const cats = useAsync(() => (signedIn ? shopCategories() : Promise.resolve(null)), [signedIn]);
  const tiles =
    cats.data?.categories
      .filter((c) => c.salesEnabled)
      .map((c) => ({
        to: `/shop?category=${encodeURIComponent(c.key)}`,
        label: localName(c, locale),
        icon: categoryIcon(c.key),
      })) ?? areas(t);
  return (
    <section className="home-section" aria-labelledby="home-cats-title">
      <SectionHead
        id="home-cats-title"
        title={cats.data ? t('cats.shopTitle') : t('cats.browseTitle')}
      />
      <ul className="home-cats">
        {tiles.map((tile) => (
          <li key={tile.to}>
            <Link to={tile.to} className="home-cat">
              <Icon name={tile.icon} size={44} strokeWidth={1.4} />
              <span>{tile.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Signed-in sections (every browse API needs an account)
// ---------------------------------------------------------------------------
function DealsSection() {
  const t = useT('home');
  const list = useAsync(
    (signal) =>
      api.request<Page<ProductDTO>>('GET', '/shop/products', {
        signal,
        query: { onSale: 'true', sort: 'popular', pageSize: 8 },
      }),
    [],
  );
  return (
    <section className="home-section" aria-labelledby="home-deals-title">
      <SectionHead
        id="home-deals-title"
        title={t('deals.title')}
        more={{ to: '/shop?onSale=true', label: t('deals.more') }}
      />
      <Loaded state={list} empty={t('deals.empty')}>
        {(data) => (
          <div className="home-grid">
            {data.items.map((p) => (
              <StoreProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </Loaded>
    </section>
  );
}

function ListingsSection() {
  const t = useT('home');
  const list = useAsync(
    (signal) =>
      api.request<CursorPage<ListingDTO>>('GET', '/marketplace/listings', {
        signal,
        query: { sort: 'newest', limit: 4 },
      }),
    [],
  );
  return (
    <section className="home-section" aria-labelledby="home-listings-title">
      <SectionHead
        id="home-listings-title"
        title={t('listings.title')}
        more={{ to: '/market', label: t('listings.more') }}
      />
      <Loaded state={list} empty={t('listings.empty')}>
        {(data) => (
          <div className="home-grid">
            {data.items.map((l) => (
              <article key={l.id} className="home-card" aria-label={l.title}>
                <Thumb
                  url={l.photos[0]?.url}
                  alt={l.photos[0]?.caption ?? l.title}
                  icon="cow"
                  to={`/market/listing/${l.id}`}
                />
                {l.negotiable && (
                  <span className="home-badge home-badge--ink">{t('listings.negotiable')}</span>
                )}
                <div className="home-card__body">
                  <h3>
                    <Link to={`/market/listing/${l.id}`}>{l.title}</Link>
                  </h3>
                  <span className="home-card__meta">
                    <Icon name="pin" size={14} />
                    {[l.location.province, l.farmName].filter(Boolean).join(' · ')}
                  </span>
                  <div className="home-card__foot">
                    <span className="home-price">{formatBaht(l.askingPriceMinor)}</span>
                    <Link to={`/market/listing/${l.id}`} className="home-add">
                      {t('listings.details')}
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </Loaded>
    </section>
  );
}

function BestSellersSection() {
  const t = useT('home');
  const [locale] = useLocale();
  const cats = useAsync(() => shopCategories(), []);
  const tabs = [
    { key: '', name: t('best.all') },
    ...(cats.data?.categories
      .filter((c) => c.salesEnabled)
      .slice(0, 4)
      .map((c) => ({ key: c.key, name: localName(c, locale) })) ?? []),
  ];
  const [active, setActive] = useState('');
  const list = useAsync(
    (signal) =>
      api.request<Page<ProductDTO>>('GET', '/shop/products', {
        signal,
        query: { sort: 'popular', pageSize: 4, ...(active ? { category: active } : {}) },
      }),
    [active],
  );
  return (
    <section className="home-section" aria-labelledby="home-best-title">
      <SectionHead id="home-best-title" title={t('best.title')}>
        <div className="home-tabs" role="group" aria-label={t('best.pickCategory')}>
          {tabs.map((tab) => (
            <button
              key={tab.key || 'all'}
              type="button"
              aria-pressed={active === tab.key}
              onClick={() => setActive(tab.key)}
            >
              {tab.name}
            </button>
          ))}
        </div>
      </SectionHead>
      <Loaded state={list} empty={t('best.empty')}>
        {(data) => (
          <div className="home-grid">
            {data.items.map((p) => (
              <StoreProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </Loaded>
    </section>
  );
}

function CommunitySection() {
  const t = useT('home');
  const [locale] = useLocale();
  const feed = useAsync(
    (signal) =>
      api.request<CursorPage<PostDTO>>('GET', '/posts', {
        signal,
        query: { limit: 4, sort: 'recent' },
      }),
    [],
  );
  return (
    <section className="home-section" aria-labelledby="home-community-title">
      <SectionHead
        id="home-community-title"
        title={t('community.title')}
        more={{ to: '/community', label: t('community.more') }}
      />
      <Loaded state={feed} empty={t('community.empty')}>
        {(data) => (
          <div className="home-grid">
            {data.items.map((post) => (
              <article key={post.id} className="home-post">
                <Thumb url={post.media[0]?.url} alt="" icon="clipboard" />
                <div className="home-post__body">
                  <span className="home-card__meta">
                    <Icon name="user" size={14} />
                    {post.author.displayName}
                    <span aria-hidden="true">·</span>
                    {formatDate(post.createdAt, locale)}
                  </span>
                  <p className="home-post__excerpt">{post.body}</p>
                  <Link to={`/community/posts/${post.id}`} className="home-post__more">
                    {t('community.readMore')} <Icon name="arrowRight" size={16} />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </Loaded>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------
function SectionHead({
  id,
  title,
  more,
  children,
}: {
  id: string;
  title: string;
  more?: { to: string; label: string };
  children?: ReactNode;
}) {
  return (
    <div className="home-section__head">
      <h2 id={id}>{title}</h2>
      {children}
      {more && (
        <Link to={more.to} className="home-section__more">
          {more.label}
          <Icon name="arrowRight" size={16} />
        </Link>
      )}
    </div>
  );
}

function Loaded<T extends { items: unknown[] }>({
  state,
  empty,
  children,
}: {
  state: { data: T | undefined; error: string | undefined; loading: boolean };
  empty: string;
  children: (data: T) => ReactNode;
}) {
  const t = useT('home');
  if (state.error) return <p className="home-note">{t('loadFailed', { error: state.error })}</p>;
  if (!state.data)
    return (
      <p className="home-note" role="status">
        {t('loading')}
      </p>
    );
  if (state.data.items.length === 0) return <p className="home-note">{empty}</p>;
  return <>{children(state.data)}</>;
}

function Thumb({
  url,
  alt,
  icon,
  to,
}: {
  url: string | undefined;
  alt: string;
  icon: IconName;
  to?: string;
}) {
  // A photo that fails to load (host down, removed) falls back to the same placeholder as "no photo".
  const [broken, setBroken] = useState(false);
  const inner =
    url && !broken ? (
      <img
        src={url}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    ) : (
      <Icon name={icon} size={56} strokeWidth={1.2} />
    );
  return to ? (
    <Link to={to} className="home-thumb" tabIndex={-1} aria-hidden="true">
      {inner}
    </Link>
  ) : (
    <div className="home-thumb">{inner}</div>
  );
}

function StoreProductCard({ product: p }: { product: ProductDTO }) {
  const t = useT('home');
  const off =
    p.onSale && p.priceMinor > 0
      ? Math.round(((p.priceMinor - p.effectivePriceMinor) / p.priceMinor) * 100)
      : 0;
  const to = `/shop/product/${p.id}`;
  return (
    <article className="home-card" aria-label={p.title}>
      <Thumb url={p.photos[0]?.url} alt={p.photos[0]?.caption ?? p.title} icon="box" to={to} />
      {off > 0 && <span className="home-badge">{t('product.discount', { percent: off })}</span>}
      <div className="home-card__body">
        <h3>
          <Link to={to}>{p.title}</Link>
        </h3>
        <span className="home-card__meta">{[p.unit, p.farmName].filter(Boolean).join(' · ')}</span>
        {p.rating.count > 0 && (
          <span className="home-card__rating">
            <Icon name="star" size={14} />
            {p.rating.average?.toFixed(1)} ({p.rating.count})
          </span>
        )}
        <div className="home-card__foot">
          <span>
            <span className="home-price">{formatBaht(p.effectivePriceMinor)}</span>
            {p.onSale && <s className="home-price--old">{formatBaht(p.priceMinor)}</s>}
          </span>
          {p.inStock ? (
            <Link to={to} className="home-add">
              <Icon name="cart" size={16} />
              {t('product.buy')}
            </Link>
          ) : (
            <span className="home-card__meta">{t('product.outOfStock')}</span>
          )}
        </div>
      </div>
    </article>
  );
}
