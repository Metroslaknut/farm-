import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type {
  CartProblem,
  DeliveryOption,
  ProductDTO,
  ProductStatus,
} from '@farmplus/shared-types';
import { formatBaht } from '@farmplus/shared-utils';
import { Badge, type Tone } from '../../components/ui';
import { useT, type Translate } from '../../i18n';

export const PRODUCT_TONE: Record<ProductStatus, Tone> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'warning',
  ACTIVE: 'success',
  PAUSED: 'warning',
  REJECTED: 'danger',
  SUSPENDED: 'danger',
  ARCHIVED: 'neutral',
};

/** The shop's texts; `useShopT()` in components. */
export type ShopT = Translate<'shop'>;
export const useShopT = (): ShopT => useT('shop');

export const productStatusLabel = (t: ShopT, status: ProductStatus): string =>
  t(`status.${status}`);
/** Built-in product category keys that have a name in both languages (`category.<key>`). */
const KNOWN_CATEGORIES = [
  'feed',
  'supplements',
  'equipment',
  'medicines',
  'medicated_feed',
] as const;

/**
 * A product category's name in the current language. Categories store one (English) name, so the built-in ones are
 * translated by their stable key; a category an admin added later shows its stored name.
 */
export const categoryLabel = (t: ShopT, key: string | undefined, name: string): string =>
  (KNOWN_CATEGORIES as readonly string[]).includes(key ?? '')
    ? t(`category.${key as (typeof KNOWN_CATEGORIES)[number]}`)
    : name;
export const deliveryLabel = (t: ShopT, option: DeliveryOption): string => t(`delivery.${option}`);

export function ProductStatusBadge({ status }: { status: ProductStatus }): ReactNode {
  const t = useShopT();
  return <Badge tone={PRODUCT_TONE[status]}>{productStatusLabel(t, status)}</Badge>;
}

/** Shows what the buyer pays now, with the list price struck through while a promotion runs. */
export function Price({
  product,
}: {
  product: Pick<ProductDTO, 'priceMinor' | 'effectivePriceMinor' | 'onSale' | 'unit'>;
}) {
  const t = useShopT();
  return (
    <span>
      <strong style={{ fontSize: '1.25rem' }}>{formatBaht(product.effectivePriceMinor)}</strong>
      {product.onSale && (
        <>
          {' '}
          <s aria-label={t('price.regular')} style={{ opacity: 0.7 }}>
            {formatBaht(product.priceMinor)}
          </s>{' '}
          <Badge tone="danger">{t('price.sale')}</Badge>
        </>
      )}
      {product.unit ? <span className="ds-field__hint"> / {product.unit}</span> : null}
    </span>
  );
}

export function Stars({ average, count }: { average: number | null; count: number }) {
  const t = useShopT();
  if (count === 0 || average === null)
    return <span className="ds-field__hint">{t('stars.none')}</span>;
  const full = Math.round(average);
  return (
    <span aria-label={t('stars.aria', { average, count })}>
      <span aria-hidden="true">
        {'★'.repeat(full)}
        {'☆'.repeat(5 - full)}
      </span>{' '}
      {average} ({count})
    </span>
  );
}

export function ProductCard({ product, to }: { product: ProductDTO; to: string }) {
  const t = useShopT();
  const photo = product.photos[0];
  return (
    <article
      className="ds-card"
      aria-label={product.title}
      style={{ display: 'grid', gap: 'var(--ds-space-2)' }}
    >
      {photo ? (
        <img
          src={photo.url}
          alt={photo.caption ?? product.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 8 }}
        />
      ) : (
        <div
          style={{
            aspectRatio: '4 / 3',
            display: 'grid',
            placeItems: 'center',
            background: 'var(--ds-surface-alt, #eee)',
            borderRadius: 8,
          }}
        >
          {t('card.noPhoto')}
        </div>
      )}
      <h2 style={{ margin: 0, fontSize: '1.05rem' }}>
        <Link to={to}>{product.title}</Link>
      </h2>
      <p style={{ margin: 0 }}>
        <Price product={product} />
      </p>
      <p className="ds-field__hint" style={{ margin: 0 }}>
        {[
          categoryLabel(t, product.categoryKey, product.categoryName),
          product.brand,
          product.farmName,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <p style={{ margin: 0 }}>
        <Stars average={product.rating.average} count={product.rating.count} />
      </p>
      {!product.inStock && <Badge tone="warning">{t('card.outOfStock')}</Badge>}
    </article>
  );
}

const PROBLEMS: readonly CartProblem[] = [
  'unavailable',
  'out_of_stock',
  'insufficient_stock',
  'below_minimum',
  'above_maximum',
  'own_product',
  'no_delivery',
  'no_pickup',
];
/** Why a cart line cannot be bought as it is (codes from the API). */
export const problemText = (t: ShopT, problem: string): string =>
  (PROBLEMS as readonly string[]).includes(problem)
    ? t(`problem.${problem as CartProblem}`)
    : t('problem.other');

export type View = 'grid' | 'list';

/** Grid/list switch in a browse page's result bar (shop and animal market). */
export function ViewToggle({
  view,
  onChange,
  labels,
}: {
  view: View;
  onChange: (view: View) => void;
  labels: { group: string; grid: string; list: string };
}) {
  return (
    <div className="shop-viewtoggle" role="group" aria-label={labels.group}>
      <button
        type="button"
        aria-pressed={view === 'grid'}
        aria-label={labels.grid}
        onClick={() => onChange('grid')}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <rect
            x="3"
            y="3"
            width="7"
            height="7"
            rx="1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <rect
            x="14"
            y="3"
            width="7"
            height="7"
            rx="1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <rect
            x="3"
            y="14"
            width="7"
            height="7"
            rx="1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <rect
            x="14"
            y="14"
            width="7"
            height="7"
            rx="1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      </button>
      <button
        type="button"
        aria-pressed={view === 'list'}
        aria-label={labels.list}
        onClick={() => onChange('list')}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <rect
            x="3"
            y="4"
            width="6"
            height="6"
            rx="1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <rect
            x="3"
            y="14"
            width="6"
            height="6"
            rx="1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path d="M13 7h8M13 17h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
