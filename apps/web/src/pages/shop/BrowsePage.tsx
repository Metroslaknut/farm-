import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  PRODUCT_SORTS,
  type Page,
  type ProductDTO,
  type ProductSort,
} from '@farmplus/shared-types';
import { parseBahtToMinor } from '@farmplus/shared-utils';
import { api } from '../../api';
import { shopCategories } from '../../lib/shopCategories';
import { Alert, Button, Checkbox, Select, TextField } from '../../components/ui';
import { useAsync } from '../../lib/useAsync';
import { useUrlSeed } from '../../lib/useUrlSeed';
import { ProductCard, categoryLabel, useShopT, ViewToggle, type View } from './common';
import { useLocale } from '../../i18n';
import './shop-browse.css';

/** Upper bound of the price slider, in baht. Adjust to your catalogue. */
const SLIDER_MAX = 5000;

interface Filters {
  q: string;
  category: string;
  minPrice: string;
  maxPrice: string;
  inStock: boolean;
  onSale: boolean;
  sort: ProductSort;
}
const EMPTY: Filters = {
  q: '',
  category: '',
  minPrice: '',
  maxPrice: '',
  inStock: false,
  onSale: false,
  sort: 'newest',
};

/** Filters a link can ask for: `?q=`, `?category=`, `?onSale=true` (site header search, category menu, home page). */
const fromUrl = (search: URLSearchParams): Filters => ({
  ...EMPTY,
  q: search.get('q') ?? '',
  category: search.get('category') ?? '',
  onSale: search.get('onSale') === 'true',
});

/** `/shop` — sidebar filters + result bar + product grid. */
export default function ShopBrowsePage() {
  const t = useShopT();
  const [locale] = useLocale();
  const [search] = useSearchParams();
  const [draft, setDraft] = useState<Filters>(() => fromUrl(search));
  const [applied, setApplied] = useState<Filters>(() => fromUrl(search));
  const [page, setPage] = useState(1);
  const [view, setView] = useState<View>('grid');
  useUrlSeed(fromUrl, (seed) => {
    setDraft(seed);
    setApplied(seed);
    setPage(1);
  });
  const [filterError, setFilterError] = useState<
    'browse.errPriceFormat' | 'browse.errPriceRange'
  >();
  const cats = useAsync(() => shopCategories(), []);
  const min = applied.minPrice ? parseBahtToMinor(applied.minPrice) : undefined;
  const max = applied.maxPrice ? parseBahtToMinor(applied.maxPrice) : undefined;
  const list = useAsync(
    (signal) =>
      api.request<Page<ProductDTO>>('GET', '/shop/products', {
        signal,
        query: {
          page,
          pageSize: 12,
          sort: applied.sort,
          ...(applied.q ? { q: applied.q } : {}),
          ...(applied.category ? { category: applied.category } : {}),
          ...(min !== undefined ? { minPriceMinor: min } : {}),
          ...(max !== undefined ? { maxPriceMinor: max } : {}),
          ...(applied.inStock ? { inStock: 'true' } : {}),
          ...(applied.onSale ? { onSale: 'true' } : {}),
        },
      }),
    [applied, page],
  );

  /** Apply immediately (category, sort, stock/sale toggles). */
  const applyNow = (patch: Partial<Filters>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setApplied((a) => ({ ...a, ...patch }));
    setPage(1);
  };

  /** Apply the price range (sidebar "Filter" button). */
  const applyPrice = (event: FormEvent) => {
    event.preventDefault();
    const lo = draft.minPrice ? parseBahtToMinor(draft.minPrice) : undefined;
    const hi = draft.maxPrice ? parseBahtToMinor(draft.maxPrice) : undefined;
    if ((draft.minPrice && lo === undefined) || (draft.maxPrice && hi === undefined))
      return setFilterError('browse.errPriceFormat');
    if (lo !== undefined && hi !== undefined && lo > hi)
      return setFilterError('browse.errPriceRange');
    setFilterError(undefined);
    setPage(1);
    setApplied((a) => ({ ...a, minPrice: draft.minPrice, maxPrice: draft.maxPrice }));
  };

  const clearAll = () => {
    setDraft(EMPTY);
    setApplied(EMPTY);
    setFilterError(undefined);
    setPage(1);
  };

  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const sliderValue = Math.min(SLIDER_MAX, Number(draft.maxPrice) || SLIDER_MAX);
  const lo = draft.minPrice || '0';
  const hi = draft.maxPrice || String(SLIDER_MAX);

  return (
    <div className="shop-page">
      <div className="shop-layout">
        {/* ───────── Sidebar ───────── */}
        <aside className="shop-sidebar" aria-label={t('browse.filterAria')}>
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
                step={10}
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
              {filterError && <Alert tone="danger">{t(filterError)}</Alert>}
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
            <h2 className="shop-widget__title">{t('browse.categories')}</h2>
            <div className="shop-widget__body shop-checklist">
              {cats.data?.categories
                .filter((c) => c.salesEnabled)
                .map((c) => (
                  <Checkbox
                    key={c.key}
                    label={categoryLabel(c, locale)}
                    checked={applied.category === c.key}
                    onChange={(e) => applyNow({ category: e.target.checked ? c.key : '' })}
                  />
                ))}
            </div>
          </section>

          <section className="shop-widget">
            <h2 className="shop-widget__title">{t('browse.moreFilters')}</h2>
            <div className="shop-widget__body shop-checklist">
              <Checkbox
                label={t('browse.inStock')}
                checked={applied.inStock}
                onChange={(e) => applyNow({ inStock: e.target.checked })}
              />
              <Checkbox
                label={t('browse.onSale')}
                checked={applied.onSale}
                onChange={(e) => applyNow({ onSale: e.target.checked })}
              />
              <Button onClick={clearAll}>{t('browse.clear')}</Button>
            </div>
          </section>
        </aside>

        {/* ───────── Results ───────── */}
        <div className="shop-main">
          <div className="shop-bar">
            <span role="status" className="shop-bar__count">
              {data ? t('browse.showing', { count: data.total }) : t('loading')}
            </span>
            <div className="shop-bar__tools">
              <TextField
                label={t('browse.search')}
                value={draft.q}
                onChange={(e) => setDraft({ ...draft, q: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyNow({ q: draft.q });
                }}
              />
              <Select
                label={t('browse.sortBy')}
                value={applied.sort}
                onChange={(e) => applyNow({ sort: e.target.value as ProductSort })}
              >
                {PRODUCT_SORTS.map((s) => (
                  <option key={s} value={s}>
                    {t(`sort.${s}`)}
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
          {data && data.items.length === 0 && <p className="shop-empty">{t('browse.empty')}</p>}

          <div className={view === 'grid' ? 'shop-grid' : 'shop-grid shop-grid--list'}>
            {data?.items.map((p) => (
              <ProductCard key={p.id} product={p} to={`/shop/product/${p.id}`} />
            ))}
          </div>

          {data && data.total > data.pageSize && (
            <div className="ds-row" style={{ marginTop: 'var(--ds-space-4)' }}>
              <Button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                {t('browse.prev')}
              </Button>
              <span role="status">{t('browse.pageInfo', { page, pages, total: data.total })}</span>
              <Button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                {t('browse.next')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
