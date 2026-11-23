import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatDateTime, validationMessage } from '@farmplus/i18n';
import type {
  AnimalSex,
  ListingAnimalSnapshot,
  ListingDTO,
  ListingStatus,
  NegotiationStatus,
} from '@farmplus/shared-types';
import { formatAge, formatBaht, humanize } from '@farmplus/shared-utils';
import { Badge, type Tone } from '../../components/ui';
import { getLocale, useLocale, useT, type Translate } from '../../i18n';
import messages from '../../i18n/messages/market';
import { loadAnimalTypes } from '../../lib/animalTypes';
import { useAsync } from '../../lib/useAsync';
import { typeName } from '../farms/labels';

export type MarketT = Translate<'market'>;
type MarketKey = keyof typeof messages.th;
export const useMarketT = (): MarketT => useT('market');

/**
 * "Animal type · breed" of a listing's animal in the current language. The listing keeps an English snapshot
 * (`animalTypeName`, breed key); the names are looked up in the (shared, cached) animal-type catalog by id and key, and
 * the snapshot is the fallback while it loads or when the type/breed is no longer in the catalog.
 */
export function useAnimalLabel(): (animal: ListingAnimalSnapshot) => string {
  const [locale] = useLocale();
  const { data } = useAsync(() => loadAnimalTypes(), []);
  return (animal) => {
    const type = data?.animalTypes?.find((x) => x.id === animal.animalTypeId);
    const breed = animal.breed ? type?.breeds?.find((b) => b.key === animal.breed) : undefined;
    return [
      type ? typeName(type, locale) : animal.animalTypeName,
      breed
        ? (locale === 'th' && breed.nameTh) || breed.name
        : animal.breed && humanize(animal.breed),
    ]
      .filter(Boolean)
      .join(' · ');
  };
}

/** A server code (reason, event type…) shown to people: translated when known, otherwise humanized as before. */
export function codeLabel(t: MarketT, prefix: string, code: string): string {
  const key = `${prefix}.${code}`;
  return key in messages.th ? t(key as MarketKey) : humanize(code);
}

/** A translated sentence with React elements (links, bold amounts) in its `{name}` slots. */
export function rich(template: string, slots: Record<string, ReactNode>): ReactNode {
  return template
    .split(/(\{\w+\})/)
    .filter((part) => part !== '')
    .map((part, i) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1];
      return (
        <Fragment key={i}>{name !== undefined && name in slots ? slots[name] : part}</Fragment>
      );
    });
}

/** Date and time in the current language (Buddhist calendar in Thai); '—' when missing. */
export function useDateTime(): (iso: string | null | undefined) => string {
  const [locale] = useLocale();
  return (iso) => (iso ? formatDateTime(iso, locale) || '—' : '—');
}

/** Validation messages from the shared schemas are English: shown in the current language. */
export const localizeErrors = <E extends Record<string, string>>(errors: E): E =>
  Object.fromEntries(
    Object.entries(errors).map(([k, v]) => [k, validationMessage(getLocale(), v)]),
  ) as E;
export const localizeError = (message: string): string => validationMessage(getLocale(), message);

/** "3 y 2 m" → "3 ปี 2 เดือน" in Thai; unchanged in English. */
export const ageLabel = (t: MarketT, age: string | undefined): string | undefined =>
  age?.replace(/(\d+) ([ymd])\b/g, (_, n: string, unit: 'y' | 'm' | 'd') =>
    t(`age.${unit}`, { n }),
  );

export const sexLabel = (t: MarketT, sex: AnimalSex): string => codeLabel(t, 'sex', sex);
export const listingStatusLabel = (t: MarketT, s: ListingStatus): string => t(`listingStatus.${s}`);
export const negotiationStatusLabel = (t: MarketT, s: NegotiationStatus): string =>
  t(`negotiationStatus.${s}`);

export const LISTING_TONE: Record<ListingStatus, Tone> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'warning',
  ACTIVE: 'success',
  RESERVED: 'info',
  SOLD: 'neutral',
  REJECTED: 'danger',
  PAUSED: 'warning',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
};
export const NEGOTIATION_TONE: Record<NegotiationStatus, Tone> = {
  open: 'info',
  accepted: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
  expired: 'warning',
  cancelled: 'neutral',
  completed: 'success',
};

export function ListingStatusBadge({ status }: { status: ListingStatus }): ReactNode {
  const t = useMarketT();
  return <Badge tone={LISTING_TONE[status]}>{listingStatusLabel(t, status)}</Badge>;
}

/** Card used in browse, favourites and the seller's list. `to` is where the card links. */
export function ListingCard({
  listing,
  to,
  footer,
}: {
  listing: ListingDTO;
  to: string;
  footer?: ReactNode;
}) {
  const t = useMarketT();
  const animalLabel = useAnimalLabel();
  const age = ageLabel(t, formatAge(listing.animal.birthDate ?? undefined));
  const photo = listing.photos[0];
  return (
    <article
      className="ds-card"
      aria-label={listing.title}
      style={{ display: 'grid', gap: 'var(--ds-space-2)' }}
    >
      {photo ? (
        <img
          src={photo.url}
          alt={photo.caption ?? listing.title}
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
        <Link to={to}>{listing.title}</Link>
      </h2>
      <p style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>
        {formatBaht(listing.askingPriceMinor)}
      </p>
      <p className="ds-field__hint" style={{ margin: 0 }}>
        {[animalLabel(listing.animal), sexLabel(t, listing.animal.sex), age]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <p className="ds-field__hint" style={{ margin: 0 }}>
        {[listing.location.district, listing.location.province].filter(Boolean).join(', ') ||
          t('card.noLocation')}
      </p>
      <p style={{ margin: 0 }} className="ds-row">
        <ListingStatusBadge status={listing.status} />
        {!listing.negotiable && <Badge>{t('fixedPrice')}</Badge>}
      </p>
      {footer}
    </article>
  );
}
