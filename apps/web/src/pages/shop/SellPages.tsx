import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  INVENTORY_MOVEMENT_TYPES,
  PRODUCT_STATUSES,
  type FarmSummary,
  type InventoryMovementDTO,
  type Page,
  type ProductCategoryDTO,
  type ProductDTO,
  type ProductEventDTO,
  type CursorPage,
} from '@farmplus/shared-types';
import { formatBaht, humanize, parseBahtToMinor } from '@farmplus/shared-utils';
import { formatDateTime, validationMessage } from '@farmplus/i18n';
import { createProductSchema, stockAdjustSchema, updateProductSchema } from '@farmplus/validation';
import { api } from '../../api';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Select,
  TextField,
  Textarea,
} from '../../components/ui';
import { useLocale } from '../../i18n';
import { errorMessage, toDateTimeLocal } from '../../lib/format';
import { useCanSell } from '../../lib/sellEligibility';
import { useAsync } from '../../lib/useAsync';
import {
  ProductStatusBadge,
  categoryLabel,
  productStatusLabel,
  useShopT,
  type ShopT,
} from './common';

const PRODUCT_EVENTS = ['created', 'edited', 'material_edit', 'withdrawn_for_edit'] as const;
type ProductEventType = (typeof PRODUCT_EVENTS)[number];

/** A product history entry (`created`, `edited`, `status.<status>`…) in the reader's language. */
function eventLabel(t: ShopT, english: boolean, type: string): string {
  if ((PRODUCT_EVENTS as readonly string[]).includes(type))
    return t(`event.${type as ProductEventType}`);
  const status = type.startsWith('status.') ? type.slice(7).toUpperCase() : '';
  if ((PRODUCT_STATUSES as readonly string[]).includes(status))
    return t('event.status', {
      status: productStatusLabel(t, status as ProductDTO['status']).toLowerCase(),
    });
  return english ? humanize(type.replace('.', ' ')) : t('event.other');
}
/** The system's own reason is translated; a moderator's reason is shown as written. */
const eventReason = (t: ShopT, reason: string): string =>
  reason === 'Content changed: new review needed' ? t('event.reasonContentChanged') : reason;

const movementLabel = (t: ShopT, type: string): string =>
  (INVENTORY_MOVEMENT_TYPES as readonly string[]).includes(type)
    ? t(`movement.${type as (typeof INVENTORY_MOVEMENT_TYPES)[number]}`)
    : type;
const signed = (n: number): string => `${n > 0 ? '+' : ''}${n}`;

export function SellFarmsPage() {
  const t = useShopT();
  const farms = useAsync(
    (signal) =>
      api.request<Page<FarmSummary>>('GET', '/farms', { query: { pageSize: 50 }, signal }),
    [],
  );
  const mine =
    farms.data?.items.filter((f) => f.myRole === 'owner' || f.myRole === 'manager') ?? [];
  return (
    <>
      <p>
        <Link to="/shop">{t('backToShop')}</Link>
      </p>
      <h1>{t('browse.sell')}</h1>
      <p>{t('sell.intro')}</p>
      {farms.error && <Alert tone="danger">{farms.error}</Alert>}
      {mine.map((f) => (
        <Card
          key={f.id}
          title={f.name}
          headingLevel={2}
          style={{ marginBottom: 'var(--ds-space-3)' }}
        >
          <Link to={`/shop/sell/${f.id}`} className="ds-btn ds-btn--primary">
            {t('sell.openProducts')}
          </Link>
        </Card>
      ))}
      {!farms.loading && mine.length === 0 && <p>{t('sell.noFarms')}</p>}
    </>
  );
}

export function SellProductsPage() {
  const { farmId = '' } = useParams();
  const t = useShopT();
  const [status, setStatus] = useState('');
  const list = useAsync(
    (signal) =>
      api.request<Page<ProductDTO>>('GET', `/farms/${farmId}/products`, {
        signal,
        query: { pageSize: 50, ...(status ? { status } : {}) },
      }),
    [farmId, status],
  );
  return (
    <>
      <p>
        <Link to="/shop/sell">{t('sell.backToSell')}</Link>
      </p>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <h1>{t('sell.myProducts')}</h1>
        <Link to={`/shop/sell/${farmId}/new`} className="ds-btn ds-btn--primary">
          {t('sell.newProduct')}
        </Link>
      </div>
      <Select label={t('sell.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">{t('sell.all')}</option>
        {PRODUCT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {productStatusLabel(t, s)}
          </option>
        ))}
      </Select>
      {list.error && <Alert tone="danger">{list.error}</Alert>}
      {list.loading && !list.data && <p role="status">{t('loading')}</p>}
      {list.data?.items.length === 0 && <p>{t('sell.noProducts')}</p>}
      <table className="ds-table" aria-label={t('sell.tableAria')}>
        <thead>
          <tr>
            <th scope="col">{t('sell.colProduct')}</th>
            <th scope="col">{t('sell.colPrice')}</th>
            <th scope="col">{t('sell.colStock')}</th>
            <th scope="col">{t('sell.colStatus')}</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((p) => (
            <tr key={p.id}>
              <td>
                <Link to={`/shop/sell/${farmId}/${p.id}`}>{p.title}</Link>
                <div className="ds-field__hint">
                  {categoryLabel(t, p.categoryKey, p.categoryName)}
                </div>
              </td>
              <td>{formatBaht(p.effectivePriceMinor)}</td>
              <td>
                {p.inventory
                  ? t('sell.stockHeld', {
                      stock: p.inventory.stock,
                      reserved: p.inventory.reserved,
                    })
                  : '—'}
                {p.inventory &&
                  p.inventory.lowStockThreshold != null &&
                  p.inventory.stock - p.inventory.reserved <= p.inventory.lowStockThreshold && (
                    <>
                      {' '}
                      <Badge tone="warning">{t('sell.low')}</Badge>
                    </>
                  )}
              </td>
              <td>
                <ProductStatusBadge status={p.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

interface Form {
  categoryKey: string;
  title: string;
  description: string;
  brand: string;
  sku: string;
  unit: string;
  price: string;
  promoPrice: string;
  promoStart: string;
  promoEnd: string;
  minQty: string;
  maxQty: string;
  stock: string;
  lowStock: string;
  specs: { name: string; value: string }[];
  photos: string[];
  pickup: boolean;
  delivery: boolean;
  shipMode: 'flat' | 'by_province';
  flat: string;
  provinces: { province: string; price: string }[];
  daysMin: string;
  daysMax: string;
  registration: string;
}
/** The API names fields differently from the form (satang vs baht, etc.). */
const FORM_FIELD: Record<string, string> = {
  priceMinor: 'price',
  minOrderQty: 'minQty',
  maxOrderQty: 'maxQty',
  lowStockThreshold: 'lowStock',
  promotion: 'promoPrice',
};

const toForm = (p?: ProductDTO): Form => ({
  categoryKey: p?.categoryKey ?? '',
  title: p?.title ?? '',
  description: p?.description ?? '',
  brand: p?.brand ?? '',
  sku: p?.sku ?? '',
  unit: p?.unit ?? '',
  price: p ? String(p.priceMinor / 100) : '',
  promoPrice: p?.promotion ? String(p.promotion.priceMinor / 100) : '',
  promoStart: p?.promotion ? toDateTimeLocal(p.promotion.startsAt) : '',
  promoEnd: p?.promotion ? toDateTimeLocal(p.promotion.endsAt) : '',
  minQty: String(p?.minOrderQty ?? 1),
  maxQty: p?.maxOrderQty ? String(p.maxOrderQty) : '',
  stock: '0',
  lowStock: p?.inventory?.lowStockThreshold != null ? String(p.inventory.lowStockThreshold) : '',
  specs: p?.specs.length ? p.specs.map((s) => ({ ...s })) : [],
  photos: p?.photos.map((x) => x.url) ?? [''],
  pickup: p ? p.deliveryOptions.includes('pickup') : true,
  delivery: p ? p.deliveryOptions.includes('delivery') : false,
  shipMode: p?.shipping?.mode ?? 'by_province',
  flat: p?.shipping?.flatPriceMinor != null ? String(p.shipping.flatPriceMinor / 100) : '',
  provinces: p?.shipping?.provinces?.map((x) => ({
    province: x.province,
    price: String(x.priceMinor / 100),
  })) ?? [{ province: '', price: '' }],
  daysMin: p?.shipping?.estimatedDays ? String(p.shipping.estimatedDays.min) : '',
  daysMax: p?.shipping?.estimatedDays ? String(p.shipping.estimatedDays.max) : '',
  registration: p?.regulatory?.registrationNumber ?? '',
});

/** Create or edit one product, with its submit/pause/archive actions, stock counting and movement log. */
export function ProductFormPage() {
  const { farmId = '', id } = useParams();
  const navigate = useNavigate();
  const t = useShopT();
  const [version, setVersion] = useState(0);
  const loaded = useAsync(
    async (signal) =>
      id
        ? await api.request<{ product: ProductDTO; events: ProductEventDTO[] }>(
            'GET',
            `/farms/${farmId}/products/${id}`,
            { signal },
          )
        : null,
    [farmId, id, version],
  );
  const cats = useAsync(
    (signal) =>
      api.request<{ categories: ProductCategoryDTO[] }>('GET', '/shop/categories', { signal }),
    [],
  );
  if (id && loaded.loading && !loaded.data) return <p role="status">{t('loading')}</p>;
  if (loaded.error) return <Alert tone="danger">{loaded.error}</Alert>;
  if (id && !loaded.data) return null;
  return (
    <Editor
      key={`${id ?? 'new'}-${version}`}
      farmId={farmId}
      product={loaded.data?.product}
      events={loaded.data?.events ?? []}
      categories={cats.data?.categories ?? []}
      onSaved={(pid) => (id ? setVersion((v) => v + 1) : navigate(`/shop/sell/${farmId}/${pid}`))}
      reload={() => setVersion((v) => v + 1)}
    />
  );
}

function Editor({
  farmId,
  product,
  events,
  categories,
  onSaved,
  reload,
}: {
  farmId: string;
  product?: ProductDTO | undefined;
  events: ProductEventDTO[];
  categories: ProductCategoryDTO[];
  onSaved: (id: string) => void;
  reload: () => void;
}) {
  const t = useShopT();
  const [locale] = useLocale();
  const [f, setF] = useState<Form>(toForm(product));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<boolean>(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const cat = categories.find((c) => c.key === f.categoryKey);
  // Only new products need the seller role (the API checks it on create and submit).
  const canSell = useCanSell(!product);
  const editable =
    !product ||
    ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'REJECTED'].includes(product.status);

  const buildBody = (): Record<string, unknown> | undefined => {
    const bad: Record<string, string> = {};
    const money = (
      v: string,
      key: string,
      required = false,
      allowZero = false, // delivery may be free
    ): number | null | undefined => {
      if (!v.trim()) {
        if (required) bad[key] = t('form.errAmount');
        return null;
      }
      const m = allowZero && v.trim() === '0' ? 0 : parseBahtToMinor(v);
      if (m === undefined) bad[key] = t('form.errAmountFormat');
      return m;
    };
    const price = money(f.price, 'price', true);
    const deliveryOptions = [...(f.pickup ? ['pickup'] : []), ...(f.delivery ? ['delivery'] : [])];
    if (deliveryOptions.length === 0) bad['deliveryOptions'] = t('form.errDelivery');
    let shipping: Record<string, unknown> | undefined;
    if (f.delivery) {
      if (f.shipMode === 'flat') {
        const flat = money(f.flat, 'flat', true, true);
        if (flat !== null && flat !== undefined)
          shipping = { mode: 'flat', flatPriceMinor: flat, requirements: [] };
      } else {
        const rows = f.provinces.filter((r) => r.province.trim() || r.price.trim());
        const parsed = rows.map((r) => ({
          province: r.province.trim(),
          priceMinor: r.price.trim() === '0' ? 0 : parseBahtToMinor(r.price),
        }));
        if (parsed.length === 0 || parsed.some((r) => !r.province || r.priceMinor === undefined))
          bad['provinces'] = t('form.errProvinces');
        else shipping = { mode: 'by_province', provinces: parsed, requirements: [] };
      }
      if (shipping && f.daysMin.trim() && f.daysMax.trim())
        shipping['estimatedDays'] = { min: Number(f.daysMin), max: Number(f.daysMax) };
    }
    const promoP = money(f.promoPrice, 'promoPrice');
    const promotion = promoP
      ? {
          priceMinor: promoP,
          startsAt: f.promoStart ? new Date(f.promoStart).toISOString() : '',
          endsAt: f.promoEnd ? new Date(f.promoEnd).toISOString() : '',
        }
      : null;
    if (Object.keys(bad).length) {
      setErrors(bad);
      return undefined;
    }
    return {
      categoryKey: f.categoryKey,
      title: f.title,
      description: f.description.trim() || (product ? null : undefined),
      brand: f.brand.trim() || (product ? null : undefined),
      sku: f.sku.trim() || (product ? null : undefined),
      unit: f.unit.trim() || (product ? null : undefined),
      priceMinor: price,
      promotion: promotion ?? (product ? null : undefined),
      specs: f.specs.filter((s) => s.name.trim() || s.value.trim()),
      photos: f.photos
        .map((u) => u.trim())
        .filter(Boolean)
        .map((url) => ({ url })),
      deliveryOptions,
      ...(shipping ? { shipping } : product ? { shipping: null } : {}),
      minOrderQty: Number(f.minQty) || 1,
      maxOrderQty: f.maxQty.trim() ? Number(f.maxQty) : product ? null : undefined,
      lowStockThreshold: f.lowStock.trim() ? Number(f.lowStock) : product ? null : undefined,
      ...(cat?.requiresRegistration
        ? { regulatory: { registrationNumber: f.registration.trim() } }
        : product
          ? { regulatory: null }
          : {}),
      ...(product ? {} : { stock: Number(f.stock) || 0 }),
    };
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setErrors({});
    setNote(false);
    const raw = buildBody();
    if (!raw) return;
    const body = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
    const parsed = (product ? updateProductSchema : createProductSchema).safeParse(body);
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((i) => [
            FORM_FIELD[String(i.path[0])] ?? String(i.path[0] ?? '_form'),
            validationMessage(locale, i.message),
          ]),
        ),
      );
      return;
    }
    setBusy(true);
    try {
      const res = product
        ? await api.request<{ product: ProductDTO }>(
            'PATCH',
            `/farms/${farmId}/products/${product.id}`,
            { body: parsed.data },
          )
        : await api.request<{ product: ProductDTO }>('POST', `/farms/${farmId}/products`, {
            body: parsed.data,
          });
      if (product && res.product.status === 'PENDING_REVIEW' && product.status === 'ACTIVE')
        setNote(true);
      onSaved(res.product.id);
    } catch (e) {
      setErrors({ _form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  const act = async (action: 'submit' | 'pause' | 'resume' | 'archive') => {
    if (!product) return;
    setBusy(true);
    setErrors({});
    try {
      await api.request('POST', `/farms/${farmId}/products/${product.id}/${action}`, { body: {} });
      reload();
    } catch (e) {
      setErrors({ _form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const field = (k: keyof Form, label: string, props: { hint?: string; type?: string } = {}) => (
    <TextField
      label={label}
      value={String(f[k])}
      onChange={(e) => set(k, e.target.value as never)}
      error={errors[k as string]}
      hint={props.hint}
      type={props.type}
    />
  );

  return (
    <>
      <p>
        <Link to={`/shop/sell/${farmId}`}>{t('sell.backToMine')}</Link>
      </p>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <h1>{product ? product.title : t('sell.newProduct')}</h1>
        {product && <ProductStatusBadge status={product.status} />}
      </div>
      {note && <Alert tone="info">{t('form.backInReview')}</Alert>}
      {product?.review?.rejectedReason && (
        <Alert tone="warning">
          {t('form.rejected', { reason: product.review.rejectedReason })}
        </Alert>
      )}
      {product?.review?.suspendedReason && (
        <Alert tone="danger">
          {t('form.suspended', { reason: product.review.suspendedReason })}
        </Alert>
      )}
      {!canSell && <Alert tone="warning">{t('form.sellerRequired')}</Alert>}
      {errors['_form'] && <Alert tone="danger">{errors['_form']}</Alert>}
      {product && (
        <div className="ds-row">
          {product.status === 'DRAFT' && (
            <Button variant="primary" loading={busy} onClick={() => void act('submit')}>
              {t('form.submit')}
            </Button>
          )}
          {product.status === 'ACTIVE' && (
            <Button onClick={() => void act('pause')}>{t('form.pause')}</Button>
          )}
          {product.status === 'PAUSED' && (
            <Button variant="primary" onClick={() => void act('resume')}>
              {t('form.resume')}
            </Button>
          )}
          {['DRAFT', 'REJECTED', 'PAUSED', 'ACTIVE', 'SUSPENDED'].includes(product.status) && (
            <Button variant="danger" onClick={() => void act('archive')}>
              {t('form.archive')}
            </Button>
          )}
        </div>
      )}

      {editable && (
        <form
          onSubmit={save}
          noValidate
          aria-label={product ? t('form.editAria') : t('sell.newProduct')}
        >
          <Card
            title={t('form.cardProduct')}
            headingLevel={2}
            style={{ marginTop: 'var(--ds-space-4)' }}
          >
            <Select
              label={t('form.category')}
              value={f.categoryKey}
              onChange={(e) => set('categoryKey', e.target.value)}
              error={errors['categoryKey']}
            >
              <option value="">{t('form.choose')}</option>
              {categories.map((c) => (
                <option key={c.key} value={c.key} disabled={!c.salesEnabled}>
                  {categoryLabel(t, c.key, c.name)}
                  {!c.salesEnabled ? t('form.notForSale') : ''}
                </option>
              ))}
            </Select>
            {field('title', t('form.title'))}
            <Textarea
              label={t('form.description')}
              rows={4}
              value={f.description}
              maxLength={4000}
              onChange={(e) => set('description', e.target.value)}
              error={errors['description']}
              hint={t('form.descriptionHint')}
            />
            {field('brand', t('form.brand'))}
            {field('sku', t('form.sku'))}
            {field('unit', t('form.unit'))}
            {cat?.requiresRegistration && (
              <TextField
                label={t('form.registration')}
                value={f.registration}
                onChange={(e) => set('registration', e.target.value)}
                error={errors['regulatory']}
                hint={t('form.registrationHint')}
              />
            )}
          </Card>
          <Card
            title={t('form.cardPrice')}
            headingLevel={2}
            style={{ marginTop: 'var(--ds-space-4)' }}
          >
            {field('price', t('form.price'))}
            {field('promoPrice', t('form.promoPrice'))}
            {f.promoPrice && (
              <>
                {field('promoStart', t('form.promoStart'), { type: 'datetime-local' })}
                {field('promoEnd', t('form.promoEnd'), { type: 'datetime-local' })}
              </>
            )}
            {errors['promotion'] && <Alert tone="danger">{errors['promotion']}</Alert>}
            {field('minQty', t('form.minQty'), { type: 'number' })}
            {field('maxQty', t('form.maxQty'), { type: 'number' })}
            {!product && field('stock', t('form.stock'), { type: 'number' })}
            {field('lowStock', t('form.lowStock'), { type: 'number' })}
          </Card>
          <Card
            title={t('form.cardSpecs')}
            headingLevel={2}
            style={{ marginTop: 'var(--ds-space-4)' }}
          >
            {f.specs.map((s, i) => (
              <div className="ds-row" key={i}>
                <TextField
                  label={t('form.specName', { n: i + 1 })}
                  value={s.name}
                  onChange={(e) =>
                    set(
                      'specs',
                      f.specs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                    )
                  }
                />
                <TextField
                  label={t('form.specValue', { n: i + 1 })}
                  value={s.value}
                  onChange={(e) =>
                    set(
                      'specs',
                      f.specs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                    )
                  }
                />
                <Button
                  size="sm"
                  onClick={() =>
                    set(
                      'specs',
                      f.specs.filter((_, j) => j !== i),
                    )
                  }
                >
                  {t('form.remove')}
                </Button>
              </div>
            ))}
            <Button size="sm" onClick={() => set('specs', [...f.specs, { name: '', value: '' }])}>
              {t('form.addSpec')}
            </Button>
          </Card>
          <Card
            title={t('form.cardPhotos')}
            headingLevel={2}
            style={{ marginTop: 'var(--ds-space-4)' }}
          >
            {f.photos.map((u, i) => (
              <TextField
                key={i}
                label={t('form.photoLink', { n: i + 1 })}
                value={u}
                onChange={(e) =>
                  set(
                    'photos',
                    f.photos.map((x, j) => (j === i ? e.target.value : x)),
                  )
                }
              />
            ))}
            {errors['photos'] && <Alert tone="danger">{errors['photos']}</Alert>}
            <Button size="sm" onClick={() => set('photos', [...f.photos, ''])}>
              {t('form.addPhoto')}
            </Button>
          </Card>
          <Card
            title={t('form.cardDelivery')}
            headingLevel={2}
            style={{ marginTop: 'var(--ds-space-4)' }}
          >
            <Checkbox
              label={t('form.pickup')}
              checked={f.pickup}
              onChange={(e) => set('pickup', e.target.checked)}
            />
            <Checkbox
              label={t('form.delivery')}
              checked={f.delivery}
              onChange={(e) => set('delivery', e.target.checked)}
            />
            {errors['deliveryOptions'] && <Alert tone="danger">{errors['deliveryOptions']}</Alert>}
            {f.delivery && (
              <>
                <Select
                  label={t('form.deliveryPrice')}
                  value={f.shipMode}
                  onChange={(e) => set('shipMode', e.target.value as Form['shipMode'])}
                >
                  <option value="by_province">{t('form.byProvince')}</option>
                  <option value="flat">{t('form.flat')}</option>
                </Select>
                {f.shipMode === 'flat' ? (
                  field('flat', t('form.flatPrice'))
                ) : (
                  <>
                    {f.provinces.map((r, i) => (
                      <div className="ds-row" key={i}>
                        <TextField
                          label={t('form.province', { n: i + 1 })}
                          value={r.province}
                          onChange={(e) =>
                            set(
                              'provinces',
                              f.provinces.map((x, j) =>
                                j === i ? { ...x, province: e.target.value } : x,
                              ),
                            )
                          }
                        />
                        <TextField
                          label={t('form.provincePrice', { n: i + 1 })}
                          value={r.price}
                          onChange={(e) =>
                            set(
                              'provinces',
                              f.provinces.map((x, j) =>
                                j === i ? { ...x, price: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      </div>
                    ))}
                    <Button
                      size="sm"
                      onClick={() =>
                        set('provinces', [...f.provinces, { province: '', price: '' }])
                      }
                    >
                      {t('form.addProvince')}
                    </Button>
                    {errors['provinces'] && <Alert tone="danger">{errors['provinces']}</Alert>}
                  </>
                )}
                {field('daysMin', t('form.daysMin'), { type: 'number' })}
                {field('daysMax', t('form.daysMax'), { type: 'number' })}
                <p className="ds-field__hint">{t('form.ratesHint')}</p>
              </>
            )}
          </Card>
          <div className="ds-row" style={{ marginTop: 'var(--ds-space-4)' }}>
            <Button type="submit" variant="primary" loading={busy} disabled={!canSell}>
              {product ? t('form.save') : t('form.create')}
            </Button>
          </div>
        </form>
      )}

      {product && <StockPanel farmId={farmId} product={product} onChanged={reload} />}
      {events.length > 0 && (
        <>
          <h2>{t('history.title')}</h2>
          <ul aria-label={t('history.aria')}>
            {events.map((e, i) => (
              <li key={i}>
                {eventLabel(t, locale === 'en', e.type)} ·{' '}
                {e.actor?.displayName ?? t('history.system')} · {formatDateTime(e.at, locale)}
                {e.data && typeof e.data['reason'] === 'string'
                  ? ` — “${eventReason(t, e.data['reason'])}”`
                  : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function StockPanel({
  farmId,
  product,
  onChanged,
}: {
  farmId: string;
  product: ProductDTO;
  onChanged: () => void;
}) {
  const t = useShopT();
  const [locale] = useLocale();
  const [mode, setMode] = useState<'delta' | 'set'>('delta');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const log = useAsync(
    (signal) =>
      api.request<CursorPage<InventoryMovementDTO>>(
        'GET',
        `/farms/${farmId}/products/${product.id}/movements`,
        { signal, query: { limit: 10 } },
      ),
    [product.id, product.inventory?.stock, product.inventory?.reserved],
  );
  const inv = product.inventory;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const n = Number(amount);
    const body = { [mode]: n, reason: reason.trim() };
    const parsed = stockAdjustSchema.safeParse(body);
    if (!amount.trim() || !Number.isInteger(n) || !parsed.success)
      return setError(
        parsed.success
          ? t('stock.errWhole')
          : parsed.error.issues[0]
            ? validationMessage(locale, parsed.error.issues[0].message)
            : t('stock.errCheck'),
      );
    setBusy(true);
    setError(undefined);
    try {
      await api.request('POST', `/farms/${farmId}/products/${product.id}/stock`, {
        body: parsed.data,
      });
      setAmount('');
      setReason('');
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h2>{t('stock.title')}</h2>
      {inv && (
        <p>
          {t('stock.onHand')} <strong>{inv.stock}</strong> {t('stock.held')}{' '}
          <strong>{inv.reserved}</strong> {t('stock.available')}{' '}
          <strong>{inv.stock - inv.reserved}</strong>
        </p>
      )}
      <form onSubmit={submit} noValidate aria-label={t('stock.adjust')}>
        <Card title={t('stock.adjust')} headingLevel={3}>
          {error && <Alert tone="danger">{error}</Alert>}
          <Select
            label={t('stock.mode')}
            value={mode}
            onChange={(e) => setMode(e.target.value as 'delta' | 'set')}
          >
            <option value="delta">{t('stock.modeDelta')}</option>
            <option value="set">{t('stock.modeSet')}</option>
          </Select>
          <TextField
            label={mode === 'delta' ? t('stock.change') : t('stock.total')}
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <TextField
            label={t('stock.reason')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            hint={t('stock.reasonHint')}
          />
          <Button type="submit" variant="primary" loading={busy}>
            {t('stock.update')}
          </Button>
        </Card>
      </form>
      <h3>{t('stock.log')}</h3>
      <ul aria-label={t('stock.log')}>
        {log.data?.items.map((m) => (
          <li key={m.id}>
            {movementLabel(t, m.type)} ·{' '}
            {m.deltaStock !== 0 ? t('stock.deltaOnHand', { delta: signed(m.deltaStock) }) : ''}
            {m.deltaReserved !== 0 ? t('stock.deltaHeld', { delta: signed(m.deltaReserved) }) : ''}
            {m.orderNo ? ` · ${m.orderNo}` : ''}
            {m.note ? ` · ${m.note}` : ''} · {formatDateTime(m.at, locale)}
          </li>
        ))}
      </ul>
    </>
  );
}
