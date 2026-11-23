import { useState, type FormEvent } from 'react';
import { ContactSellerButton } from '../../components/inbox/ContactSellerButton';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { CartDTO, CursorPage, ProductDTO, ProductReviewDTO } from '@farmplus/shared-types';
import { createReviewSchema } from '@farmplus/validation';
import { api } from '../../api';
import { Alert, Badge, Button, Card, TextField, Textarea } from '../../components/ui';
import { formatDate, validationMessage } from '@farmplus/i18n';
import { useLocale } from '../../i18n';
import { errorMessage } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import {
  Price,
  ProductStatusBadge,
  Stars,
  deliveryLabel,
  productCategoryLabel,
  useShopT,
} from './common';

type ReviewPage = CursorPage<ProductReviewDTO> & {
  eligibility: { eligible: boolean; reason?: string; reviewed: boolean };
};

/** `/shop/product/:id` — details, specifications, reviews and "add to cart". */
export default function ProductPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const t = useShopT();
  const [locale] = useLocale();
  const [version, setVersion] = useState(0);
  const product = useAsync(
    (signal) => api.request<{ product: ProductDTO }>('GET', `/shop/products/${id}`, { signal }),
    [id, version],
  );
  const reviews = useAsync(
    (signal) => api.request<ReviewPage>('GET', `/shop/products/${id}/reviews`, { signal }),
    [id, version],
  );
  const [qty, setQty] = useState('1');
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string }>();
  const [busy, setBusy] = useState(false);

  if (product.error) return <Alert tone="danger">{product.error}</Alert>;
  if (product.loading && !product.data) return <p role="status">{t('loading')}</p>;
  const p = product.data?.product;
  if (!p) return null;
  const live = p.status === 'ACTIVE';
  const canBuy = live && p.inStock && !p.viewer.isSellerSide;

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const adding = Number(qty);
    if (!Number.isInteger(adding) || adding < 1)
      return setMsg({ tone: 'danger', text: t('product.errQty') });
    setBusy(true);
    setMsg(undefined);
    try {
      // The API sets the line's quantity, so add to what is already in the cart and check the resulting total.
      const { cart } = await api.request<{ cart?: CartDTO }>('GET', '/shop/cart');
      const inCart =
        cart?.groups.flatMap((g) => g.lines).find((l) => l.productId === p.id)?.quantity ?? 0;
      const quantity = inCart + adding;
      if (quantity < p.minOrderQty)
        return setMsg({ tone: 'danger', text: t('product.errMin', { min: p.minOrderQty }) });
      if (p.maxOrderQty && quantity > p.maxOrderQty)
        return setMsg({ tone: 'danger', text: t('product.errMax', { max: p.maxOrderQty }) });
      if (quantity > p.available)
        return setMsg({ tone: 'danger', text: t('product.errStock', { count: p.available }) });
      await api.request('PUT', `/shop/cart/items/${p.id}`, { body: { quantity } });
      setMsg({ tone: 'success', text: t('product.added') });
    } catch (e) {
      setMsg({ tone: 'danger', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p>
        <Link to="/shop">{t('backToShop')}</Link>
      </p>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <h1>{p.title}</h1>
        <ProductStatusBadge status={p.status} />
      </div>
      {!live && <Alert tone="warning">{t('product.notOnSale')}</Alert>}
      <div className="ds-grid ds-grid--2">
        <div>
          {p.photos.length === 0 ? (
            <p>{t('product.noPhotos')}</p>
          ) : (
            <ul
              style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--ds-space-2)' }}
              aria-label={t('product.photos')}
            >
              {p.photos.map((x) => (
                <li key={x.url}>
                  <img
                    src={x.url}
                    alt={x.caption ?? p.title}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    style={{ width: '100%', borderRadius: 8 }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <Card title={p.title} headingLevel={2}>
            <p>
              <Price product={p} />
            </p>
            <p>
              <Stars average={p.rating.average} count={p.rating.count} />
            </p>
            <p className="ds-row">
              <Badge tone={p.inStock ? 'success' : 'warning'}>
                {p.inStock ? t('product.inStock', { count: p.available }) : t('card.outOfStock')}
              </Badge>
              {p.deliveryOptions.map((d) => (
                <Badge key={d}>{deliveryLabel(t, d)}</Badge>
              ))}
            </p>
            <p className="ds-field__hint">
              {productCategoryLabel(p, locale)}
              {p.brand ? ` · ${p.brand}` : ''}
              {p.sku ? ` · ${t('product.sku', { sku: p.sku })}` : ''} ·{' '}
              {t('product.soldBy', { farm: p.farmName })}
            </p>
            {p.regulatory && (
              <p className="ds-field__hint">
                {t('product.registration', { number: p.regulatory.registrationNumber })}
              </p>
            )}
            {p.description && <p style={{ whiteSpace: 'pre-wrap' }}>{p.description}</p>}
            {p.minOrderQty > 1 || p.maxOrderQty ? (
              <p className="ds-field__hint">
                {p.minOrderQty > 1 && p.maxOrderQty
                  ? t('product.limitBoth', { min: p.minOrderQty, max: p.maxOrderQty })
                  : p.maxOrderQty
                    ? t('product.limitMax', { max: p.maxOrderQty })
                    : t('product.limitMin', { min: p.minOrderQty })}
              </p>
            ) : null}
          </Card>
          {p.viewer.isSellerSide && (
            <Alert tone="info">
              {t('product.yours')}{' '}
              <Link to={`/shop/sell/${p.farmId}/${p.id}`}>{t('product.manage')}</Link>
              {t('product.manageEnd')}
            </Alert>
          )}
          {!p.viewer.isSellerSide && (
            <p>
              <ContactSellerButton productId={p.id} />
            </p>
          )}
          {canBuy && (
            <form onSubmit={add} noValidate aria-label={t('product.addToCart')}>
              <Card
                title={t('product.addToCart')}
                headingLevel={2}
                style={{ marginTop: 'var(--ds-space-4)' }}
              >
                {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
                <TextField
                  label={t('product.quantity')}
                  inputMode="numeric"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
                <div className="ds-row">
                  <Button type="submit" variant="primary" loading={busy}>
                    {t('product.addToCart')}
                  </Button>
                  <Button onClick={() => navigate('/shop/cart')}>{t('product.goToCart')}</Button>
                </div>
                <p className="ds-field__hint">{t('product.chargeHint')}</p>
              </Card>
            </form>
          )}
        </div>
      </div>

      {p.specs.length > 0 && (
        <>
          <h2>{t('product.specs')}</h2>
          <table className="ds-table" aria-label={t('product.specs')}>
            <tbody>
              {p.specs.map((s) => (
                <tr key={s.name}>
                  <th scope="row">{s.name}</th>
                  <td>{s.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>{t('product.reviews')}</h2>
      {reviews.data && (
        <ReviewForm
          productId={p.id}
          eligibility={reviews.data.eligibility}
          onDone={() => setVersion((v) => v + 1)}
        />
      )}
      {reviews.data?.items.length === 0 && <p>{t('product.noReviews')}</p>}
      <ul style={{ listStyle: 'none', padding: 0 }} aria-label={t('product.reviews')}>
        {reviews.data?.items.map((r) => (
          <li key={r.id} style={{ marginBottom: 'var(--ds-space-3)' }}>
            <p style={{ margin: 0 }}>
              <Stars average={r.rating} count={1} /> {r.title ? <strong>{r.title}</strong> : null}
            </p>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.body}</p>
            <p className="ds-field__hint" style={{ margin: 0 }}>
              {r.author.displayName} · {t('product.verified')} · {formatDate(r.createdAt, locale)}
              {r.mine && (
                <>
                  {' · '}
                  <button
                    type="button"
                    className="ds-btn ds-btn--ghost ds-btn--sm"
                    onClick={() =>
                      void api
                        .request('DELETE', `/shop/products/${p.id}/reviews/mine`)
                        .then(() => setVersion((v) => v + 1))
                    }
                  >
                    {t('product.deleteReview')}
                  </button>
                </>
              )}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

function ReviewForm({
  productId,
  eligibility,
  onDone,
}: {
  productId: string;
  eligibility: ReviewPage['eligibility'];
  onDone: () => void;
}) {
  const t = useShopT();
  const [locale] = useLocale();
  const [rating, setRating] = useState('5');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (!eligibility.eligible)
    return (
      <p className="ds-field__hint">
        {locale === 'en' && eligibility.reason
          ? eligibility.reason
          : eligibility.reviewed
            ? t('review.alreadyReviewed')
            : t('review.onlyBuyers')}
      </p>
    );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = createReviewSchema.safeParse({
      rating: Number(rating),
      ...(title.trim() ? { title: title.trim() } : {}),
      body,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message;
      return setError(issue ? validationMessage(locale, issue) : t('review.check'));
    }
    setBusy(true);
    setError(undefined);
    try {
      await api.request('POST', `/shop/products/${productId}/reviews`, { body: parsed.data });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} noValidate aria-label={t('review.write')}>
      <Card title={t('review.write')} headingLevel={3}>
        {error && <Alert tone="danger">{error}</Alert>}
        <TextField
          label={t('review.stars')}
          inputMode="numeric"
          value={rating}
          onChange={(e) => setRating(e.target.value)}
        />
        <TextField
          label={t('review.headline')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Textarea
          label={t('review.body')}
          rows={3}
          maxLength={1000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <Button type="submit" variant="primary" loading={busy}>
          {t('review.post')}
        </Button>
      </Card>
    </form>
  );
}
