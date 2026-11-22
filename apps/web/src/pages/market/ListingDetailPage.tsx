import { useState, type FormEvent } from 'react';
import { ContactSellerButton } from '../../components/inbox/ContactSellerButton';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { FavoriteResult, ListingDTO, NegotiationDTO } from '@farmplus/shared-types';
import { formatBaht, parseBahtToMinor } from '@farmplus/shared-utils';
import { createOfferSchema } from '@farmplus/validation';
import { api } from '../../api';
import { Alert, Badge, Button, Card, TextField, Textarea } from '../../components/ui';
import { errorMessage } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import {
  ListingStatusBadge,
  localizeError,
  rich,
  sexLabel,
  useAnimalLabel,
  useMarketT,
} from './common';

/** `/market/listing/:id` — details, save, and make an offer. */
export default function ListingDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const t = useMarketT();
  const animalLabel = useAnimalLabel();
  const [version, setVersion] = useState(0);
  const { data, error, loading } = useAsync(
    (signal) =>
      api.request<{ listing: ListingDTO }>('GET', `/marketplace/listings/${id}`, { signal }),
    [id, version],
  );
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [fav, setFav] = useState<FavoriteResult>();

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (loading && !data) return <p role="status">{t('loading')}</p>;
  const l = data?.listing;
  if (!l) return null;
  const favorited = fav?.favorited ?? l.viewer.favorited;
  const canOffer = l.status === 'ACTIVE' && !l.viewer.isSellerSide && !l.viewer.negotiationId;

  const toggleFavorite = async () => {
    try {
      setFav(
        await api.request<FavoriteResult>(
          favorited ? 'DELETE' : 'POST',
          `/marketplace/listings/${l.id}/favorite`,
        ),
      );
    } catch (e) {
      setFormError(errorMessage(e));
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const minor = l.negotiable ? parseBahtToMinor(amount) : l.askingPriceMinor;
    if (minor === undefined) return setFormError(t('detail.err.amount'));
    const parsed = createOfferSchema.safeParse({
      amountMinor: minor,
      ...(message.trim() ? { message: message.trim() } : {}),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message;
      return setFormError(issue ? localizeError(issue) : t('detail.err.invalid'));
    }
    if (minor > l.askingPriceMinor) return setFormError(t('detail.err.aboveAsking'));
    setBusy(true);
    setFormError(undefined);
    try {
      const res = await api.request<{ negotiation: NegotiationDTO }>(
        'POST',
        `/marketplace/listings/${l.id}/negotiations`,
        { body: parsed.data },
      );
      navigate(`/market/offers/${res.negotiation.id}`);
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p>
        <Link to="/market">{t('nav.marketplace')}</Link>
      </p>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <h1>{l.title}</h1>
        <ListingStatusBadge status={l.status} />
      </div>
      {l.review?.rejectedReason && (
        <Alert tone="warning">{t('detail.rejected', { reason: l.review.rejectedReason })}</Alert>
      )}
      {l.status === 'RESERVED' && <Alert tone="info">{t('detail.reserved')}</Alert>}
      {l.status === 'SOLD' && <Alert tone="info">{t('detail.sold')}</Alert>}
      <div className="ds-grid ds-grid--2">
        <div>
          {l.photos.length === 0 ? (
            <p>{t('detail.noPhotos')}</p>
          ) : (
            <ul
              style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--ds-space-2)' }}
              aria-label={t('detail.photosAria')}
            >
              {l.photos.map((p) => (
                <li key={p.url}>
                  <img
                    src={p.url}
                    alt={p.caption ?? l.title}
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
          <Card title={formatBaht(l.askingPriceMinor)} headingLevel={2}>
            <p className="ds-row">
              {l.negotiable ? (
                <Badge tone="info">{t('openToOffers')}</Badge>
              ) : (
                <Badge>{t('fixedPrice')}</Badge>
              )}
              {l.deliveryOptions.map((d) => (
                <Badge key={d}>{t(`delivery.${d}`)}</Badge>
              ))}
            </p>
            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: 'max-content 1fr',
                gap: 'var(--ds-space-2) var(--ds-space-4)',
              }}
            >
              <dt>{t('detail.animal')}</dt>
              <dd>{animalLabel(l.animal)}</dd>
              <dt>{t('detail.sex')}</dt>
              <dd>{sexLabel(t, l.animal.sex)}</dd>
              {l.animal.birthDate && (
                <>
                  <dt>{t('detail.born')}</dt>
                  <dd>
                    {l.animal.birthDate}
                    {l.animal.birthDateEstimated ? t('detail.estimated') : ''}
                  </dd>
                </>
              )}
              <dt>{t('detail.location')}</dt>
              <dd>
                {[l.location.district, l.location.province].filter(Boolean).join(', ') || '—'}
              </dd>
              <dt>{t('detail.seller')}</dt>
              <dd>
                {l.seller.displayName} · {l.farmName}
              </dd>
            </dl>
            {l.description && <p style={{ whiteSpace: 'pre-wrap' }}>{l.description}</p>}
            {l.conditions && (
              <>
                <h3>{t('detail.conditions')}</h3>
                <p style={{ whiteSpace: 'pre-wrap' }}>{l.conditions}</p>
              </>
            )}
            {['ACTIVE', 'RESERVED'].includes(l.status) && (
              <Button aria-pressed={favorited} onClick={() => void toggleFavorite()}>
                {favorited ? t('detail.saved') : t('detail.save')}
                {fav ? ` · ${fav.favoriteCount}` : ` · ${l.favoriteCount}`}
              </Button>
            )}
          </Card>

          {l.viewer.isSellerSide && (
            <Alert tone="info">
              {rich(t('detail.yourListing'), {
                link: (
                  <Link to={`/farms/${l.farmId}/listings/${l.id}`}>{t('detail.manageIt')}</Link>
                ),
              })}
            </Alert>
          )}
          {l.viewer.negotiationId && (
            <Alert tone="info">
              {rich(t('detail.hasOffer'), {
                link: (
                  <Link to={`/market/offers/${l.viewer.negotiationId}`}>
                    {t('detail.openNegotiation')}
                  </Link>
                ),
              })}
            </Alert>
          )}
          {!l.viewer.isSellerSide && ['ACTIVE', 'RESERVED'].includes(l.status) && (
            <p>
              <ContactSellerButton listingId={l.id} />
            </p>
          )}
          {canOffer && (
            <form onSubmit={submit} noValidate aria-label={t('detail.makeOffer')}>
              <Card
                title={t('detail.makeOffer')}
                headingLevel={2}
                style={{ marginTop: 'var(--ds-space-4)' }}
              >
                {formError && <Alert tone="danger">{formError}</Alert>}
                {l.negotiable ? (
                  <TextField
                    label={t('detail.yourOffer')}
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    hint={t('detail.upTo', { amount: formatBaht(l.askingPriceMinor) })}
                  />
                ) : (
                  <p>
                    {rich(t('detail.fixedAt'), {
                      amount: <strong>{formatBaht(l.askingPriceMinor)}</strong>,
                    })}
                  </p>
                )}
                <Textarea
                  label={t('detail.message')}
                  rows={2}
                  maxLength={500}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <Button type="submit" variant="primary" loading={busy}>
                  {l.negotiable ? t('detail.sendOffer') : t('detail.requestBuy')}
                </Button>
                <p className="ds-field__hint">{t('detail.offerHint')}</p>
              </Card>
            </form>
          )}
          <Button size="sm" onClick={() => setVersion((v) => v + 1)}>
            {t('detail.refresh')}
          </Button>
        </div>
      </div>
    </>
  );
}
