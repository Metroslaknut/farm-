import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LISTING_SORTS, type ListingDTO, type ListingSort } from '@farmplus/shared-types';
import { parseBahtToMinor } from '@farmplus/shared-utils';
import { api } from '../../api';
import { Alert, Button, Checkbox, Select, TextField } from '../../components/ui';
import { useAsync } from '../../lib/useAsync';
import { useUrlSeed } from '../../lib/useUrlSeed';
import { usePagedList } from '../community/usePagedList';
import { ViewToggle, type View } from '../shop/common';
import { ListingCard, useMarketT } from './common';
import { useLocale } from '../../i18n';
import { typeName } from '../farms/labels';
import '../shop/shop-browse.css';

/** Upper bound of the price slider, in baht. */
const SLIDER_MAX = 200000;

interface Filters {
  q: string;
  animalTypeId: string;
  province: string;
  minPrice: string;
  maxPrice: string;
  sort: ListingSort;
}
const EMPTY: Filters = {
  q: '',
  animalTypeId: '',
  province: '',
  minPrice: '',
  maxPrice: '',
  sort: 'newest',
};

/** Filters a link can ask for: `?q=` (site header search). */
const fromUrl = (search: URLSearchParams): Filters => ({ ...EMPTY, q: search.get('q') ?? '' });

/** `/market` — animals for sale, laid out like the shop: sidebar filters + result bar + listing grid. */
export default function BrowsePage() {
  const t = useMarketT();
  const [locale] = useLocale();
  const [search] = useSearchParams();
  const [draft, setDraft] = useState<Filters>(() => fromUrl(search));
  const [applied, setApplied] = useState<Filters>(() => fromUrl(search));
  const [view, setView] = useState<View>('grid');
  useUrlSeed(fromUrl, (seed) => {
    setDraft(seed);
    setApplied(seed);
  });
  const [error, setError] = useState<string>();
  const types = useAsync(
    (signal) =>
      api.request<{ animalTypes: { id: string; name: string; nameTh?: string }[] }>(
        'GET',
        '/animal-types',
        {
          signal,
        },
      ),
    [],
  );

  const min = applied.minPrice ? parseBahtToMinor(applied.minPrice) : undefined;
  const max = applied.maxPrice ? parseBahtToMinor(applied.maxPrice) : undefined;
  const list = usePagedList<ListingDTO>('/marketplace/listings', {
    limit: 12,
    sort: applied.sort,
    ...(applied.q ? { q: applied.q } : {}),
    ...(applied.animalTypeId ? { animalTypeId: applied.animalTypeId } : {}),
    ...(applied.province ? { province: applied.province } : {}),
    ...(min !== undefined ? { minPriceMinor: min } : {}),
    ...(max !== undefined ? { maxPriceMinor: max } : {}),
  });

  /** Apply immediately (animal type, sort, search on Enter). */
  const applyNow = (patch: Partial<Filters>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setApplied((a) => ({ ...a, ...patch }));
  };

  /** Apply the price range (sidebar "Filter" button). */
  const applyPrice = (event: FormEvent) => {
    event.preventDefault();
    if (draft.minPrice && parseBahtToMinor(draft.minPrice) === undefined)
      return setError(t('browse.err.minPrice'));
    if (draft.maxPrice && parseBahtToMinor(draft.maxPrice) === undefined)
      return setError(t('browse.err.maxPrice'));
    const lo = draft.minPrice ? parseBahtToMinor(draft.minPrice) : undefined;
    const hi = draft.maxPrice ? parseBahtToMinor(draft.maxPrice) : undefined;
    if (lo !== undefined && hi !== undefined && lo > hi) return setError(t('browse.err.range'));
    setError(undefined);
    setApplied((a) => ({ ...a, minPrice: draft.minPrice, maxPrice: draft.maxPrice }));
  };

  /** Apply the province (sidebar "More filters" form). */
  const applyProvince = (event: FormEvent) => {
    event.preventDefault();
    applyNow({ province: draft.province });
  };

  const clearAll = () => {
    setDraft(EMPTY);
    setApplied(EMPTY);
    setError(undefined);
  };

  const sliderValue = Math.min(SLIDER_MAX, Number(draft.maxPrice) || SLIDER_MAX);
  const lo = draft.minPrice || '0';
  const hi = draft.maxPrice || String(SLIDER_MAX);

  return (
    <div className="shop-page">
      <h1 className="ds-sr-only">{t('browse.title')}</h1>
      <div className="shop-layout">
        {/* ───────── Sidebar ───────── */}
        <aside
          className="shop-sidebar"
          aria-label={t('browse.filterAria')}
          data-tour="market-filters"
        >
          <section className="shop-widget">
            <h2 className="shop-widget__title">{t('browse.priceFilter')}</h2>
            <form className="shop-widget__body" onSubmit={applyPrice} noValidate>
              <div className="shop-price">
                <TextField
                  label={t('browse.minPrice')}
                  inputMode="decimal"
                  value={draft.minPrice}
                  placeholder="0"
                  onChange={(e) => setDraft({ ...draft, minPrice: e.target.value })}
                />
                <TextField
                  label={t('browse.maxPrice')}
                  inputMode="decimal"
                  value={draft.maxPrice}
                  placeholder={String(SLIDER_MAX)}
                  onChange={(e) => setDraft({ ...draft, maxPrice: e.target.value })}
                />
              </div>
              <input
                type="range"
                className="shop-range"
                min={0}
                max={SLIDER_MAX}
                step={1000}
                value={sliderValue}
                aria-label={t('browse.maxPrice')}
                style={{ ['--fill' as string]: `${(sliderValue / SLIDER_MAX) * 100}%` }}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    maxPrice: e.target.value === String(SLIDER_MAX) ? '' : e.target.value,
                  })
                }
              />
              {error && <Alert tone="danger">{error}</Alert>}
              <div className="shop-price__foot">
                <span className="shop-price__label">
                  {t('browse.priceRange', { min: lo, max: hi })}
                </span>
                <Button type="submit" variant="primary">
                  {t('browse.filter')}
                </Button>
              </div>
            </form>
          </section>

          <section className="shop-widget">
            <h2 className="shop-widget__title">{t('browse.animalTypes')}</h2>
            <div className="shop-widget__body shop-checklist">
              {types.data?.animalTypes.map((type) => (
                <Checkbox
                  key={type.id}
                  label={typeName(type, locale)}
                  checked={applied.animalTypeId === type.id}
                  onChange={(e) => applyNow({ animalTypeId: e.target.checked ? type.id : '' })}
                />
              ))}
            </div>
          </section>

          <section className="shop-widget">
            <h2 className="shop-widget__title">{t('browse.moreFilters')}</h2>
            <form className="shop-widget__body" onSubmit={applyProvince} noValidate>
              <TextField
                label={t('field.province')}
                value={draft.province}
                onChange={(e) => setDraft({ ...draft, province: e.target.value })}
              />
              <div className="shop-price__foot">
                <Button onClick={clearAll}>{t('browse.clear')}</Button>
                <Button type="submit" variant="primary">
                  {t('browse.filter')}
                </Button>
              </div>
            </form>
          </section>

          <section className="shop-widget">
            <h2 className="shop-widget__title">{t('browse.shortcuts')}</h2>
            <div className="shop-widget__body">
              <Link to="/market/favorites" className="ds-btn" data-tour="market-favorites">
                {t('browse.saved')}
              </Link>
              <Link to="/market/offers" className="ds-btn" data-tour="market-my-offers">
                {t('browse.myOffers')}
              </Link>
              <Link to="/market/sell" className="ds-btn ds-btn--primary" data-tour="market-sell">
                {t('browse.sell')}
              </Link>
            </div>
          </section>
        </aside>

        {/* ───────── Results ───────── */}
        <div className="shop-main">
          <div className="shop-bar">
            <span role="status" className="shop-bar__count">
              {list.loading ? t('loading') : t('browse.showing', { count: list.items.length })}
            </span>
            <div className="shop-bar__tools" data-tour="market-search">
              <TextField
                label={t('browse.search')}
                type="search"
                value={draft.q}
                onChange={(e) => setDraft({ ...draft, q: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyNow({ q: draft.q });
                }}
              />
              <Select
                label={t('browse.sortBy')}
                value={applied.sort}
                onChange={(e) => applyNow({ sort: e.target.value as ListingSort })}
              >
                {LISTING_SORTS.map((s) => (
                  <option key={s} value={s}>
                    {t(`browse.sort.${s}`)}
                  </option>
                ))}
              </Select>
              <ViewToggle
                view={view}
                onChange={setView}
                labels={{
                  group: t('browse.viewAria'),
                  grid: t('browse.gridView'),
                  list: t('browse.listView'),
                }}
              />
            </div>
          </div>

          {list.error && <Alert tone="danger">{list.error}</Alert>}
          {!list.loading && !list.error && list.items.length === 0 && (
            <p className="shop-empty">{t('browse.empty')}</p>
          )}

          <div
            className={view === 'grid' ? 'shop-grid' : 'shop-grid shop-grid--list'}
            data-tour="market-results"
          >
            {list.items.map((l) => (
              <ListingCard key={l.id} listing={l} to={`/market/listing/${l.id}`} />
            ))}
          </div>

          {list.hasMore && !list.loading && (
            <div className="ds-row" style={{ justifyContent: 'center' }}>
              <Button onClick={() => void list.loadMore()}>{t('loadMore')}</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
