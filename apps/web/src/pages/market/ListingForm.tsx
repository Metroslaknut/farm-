import { useEffect, useState, type FormEvent } from 'react';
import {
  DELIVERY_OPTIONS,
  LISTING_LIMITS,
  type AnimalSummary,
  SHIPPING_MODES,
  TRANSPORT_REQUIREMENTS,
  type DeliveryOption,
  type ListingDTO,
  type Page,
  type ShippingMode,
  type TransportRequirement,
} from '@farmplus/shared-types';
import { formatBaht, parseBahtToMinor } from '@farmplus/shared-utils';
import {
  createListingSchema,
  fieldErrorsFromDetails,
  fieldErrorsFromZod,
  updateListingSchema,
  type FieldErrors,
} from '@farmplus/validation';
import { api } from '../../api';
import { Alert, Button, Card, Select, TextField, Textarea } from '../../components/ui';
import { useLocale } from '../../i18n';
import { errorMessage } from '../../lib/format';
import { useCanSell } from '../../lib/sellEligibility';
import { typeName } from '../farms/labels';
import { localizeErrors, sexLabel, useAnimalLabel, useMarketT } from './common';

interface PhotoRow {
  url: string;
  caption: string;
}

const minorToText = (m: number | null | undefined): string =>
  m ? (m / 100).toFixed(2).replace(/\.00$/, '') : '';

/** Create (from an existing animal record) or edit a listing. Prices are typed in baht and converted to integer satang before they are sent. */
export function ListingForm({
  farmId,
  listing,
  animalId,
  onSaved,
  onCancel,
}: {
  farmId: string;
  listing?: ListingDTO | undefined;
  animalId?: string | undefined;
  onSaved: (listing: ListingDTO) => void;
  onCancel?: (() => void) | undefined;
}) {
  const t = useMarketT();
  const animalLabel = useAnimalLabel();
  const [locale] = useLocale();
  const editing = Boolean(listing);
  // Only new listings need the seller role (the API checks it on create and submit).
  const canSell = useCanSell(!editing);
  const [animal, setAnimal] = useState(animalId ?? listing?.animalId ?? '');
  const [animals, setAnimals] = useState<AnimalSummary[]>([]);
  const [title, setTitle] = useState(listing?.title ?? '');
  const [description, setDescription] = useState(listing?.description ?? '');
  const [price, setPrice] = useState(minorToText(listing?.askingPriceMinor));
  const [floor, setFloor] = useState(minorToText(listing?.minOfferMinor));
  const [negotiable, setNegotiable] = useState(listing?.negotiable ?? true);
  const [conditions, setConditions] = useState(listing?.conditions ?? '');
  const [delivery, setDelivery] = useState<DeliveryOption[]>(
    listing?.deliveryOptions ?? ['pickup'],
  );
  const sh = listing?.shipping;
  const [shipMode, setShipMode] = useState<ShippingMode>(sh?.mode ?? 'by_province');
  const [shipFlat, setShipFlat] = useState(minorToText(sh?.flatPriceMinor));
  const [shipProvinces, setShipProvinces] = useState<{ province: string; price: string }[]>(
    (sh?.provinces ?? []).map((p) => ({ province: p.province, price: minorToText(p.priceMinor) })),
  );
  const [shipDays, setShipDays] = useState({
    min: String(sh?.estimatedDays?.min ?? ''),
    max: String(sh?.estimatedDays?.max ?? ''),
  });
  const [shipReq, setShipReq] = useState<TransportRequirement[]>(
    sh?.requirements ?? ['livestock_vehicle'],
  );
  const [shipNotes, setShipNotes] = useState(sh?.notes ?? '');
  const [photos, setPhotos] = useState<PhotoRow[]>(
    (listing?.photos ?? []).map((p) => ({ url: p.url, caption: p.caption ?? '' })),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (editing) return;
    api
      .request<Page<AnimalSummary>>('GET', `/farms/${farmId}/animals`, {
        query: { pageSize: 100, archived: 'false', sortBy: 'animalCode', order: 'asc' },
      })
      .then((p) =>
        setAnimals(p.items.filter((a) => ['active', 'for_sale'].includes(a.currentStatus))),
      )
      .catch((e: unknown) => setErrors({ _form: errorMessage(e) }));
  }, [farmId, editing]);

  const toggleDelivery = (d: DeliveryOption) =>
    setDelivery((all) => (all.includes(d) ? all.filter((x) => x !== d) : [...all, d]));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const askingPriceMinor = parseBahtToMinor(price);
    if (askingPriceMinor === undefined) return setErrors({ askingPriceMinor: t('form.err.price') });
    let minOfferMinor: number | undefined;
    if (floor.trim()) {
      minOfferMinor = parseBahtToMinor(floor);
      if (minOfferMinor === undefined) return setErrors({ minOfferMinor: t('form.err.floor') });
    }
    let shipping: Record<string, unknown> | undefined;
    if (delivery.includes('delivery')) {
      const price = (text: string): number | undefined =>
        text.trim() === '0' ? 0 : parseBahtToMinor(text);
      if (shipMode === 'flat') {
        const flat = price(shipFlat);
        if (flat === undefined) return setErrors({ flatPriceMinor: t('form.err.flat') });
        shipping = { mode: 'flat', flatPriceMinor: flat };
      } else {
        const rows = shipProvinces.filter((r) => r.province.trim());
        const parsedRows = rows.map((r) => ({
          province: r.province.trim(),
          priceMinor: price(r.price),
        }));
        if (parsedRows.some((r) => r.priceMinor === undefined))
          return setErrors({ provinces: t('form.err.provinces') });
        shipping = { mode: 'by_province', provinces: parsedRows };
      }
      shipping['requirements'] = shipReq;
      if (shipDays.min.trim() && shipDays.max.trim())
        shipping['estimatedDays'] = { min: Number(shipDays.min), max: Number(shipDays.max) };
      if (shipNotes.trim()) shipping['notes'] = shipNotes.trim();
    }
    const common = {
      title: title.trim(),
      askingPriceMinor,
      negotiable,
      deliveryOptions: delivery,
      ...(shipping ? { shipping } : {}),
      photos: photos
        .filter((p) => p.url.trim())
        .map((p) => ({
          url: p.url.trim(),
          ...(p.caption.trim() ? { caption: p.caption.trim() } : {}),
        })),
    };
    const payload = editing
      ? {
          ...common,
          description: description.trim() || null,
          minOfferMinor: minOfferMinor ?? null,
          conditions: conditions.trim() || null,
        }
      : {
          animalId: animal,
          ...common,
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(minOfferMinor ? { minOfferMinor } : {}),
          ...(conditions.trim() ? { conditions: conditions.trim() } : {}),
        };
    const parsed = (editing ? updateListingSchema : createListingSchema).safeParse(payload);
    if (!parsed.success) return setErrors(localizeErrors(fieldErrorsFromZod(parsed.error)));
    setBusy(true);
    setErrors({});
    try {
      const res = editing
        ? await api.request<{ listing: ListingDTO }>(
            'PATCH',
            `/farms/${farmId}/listings/${listing!.id}`,
            { body: parsed.data },
          )
        : await api.request<{ listing: ListingDTO }>('POST', `/farms/${farmId}/listings`, {
            body: parsed.data,
          });
      onSaved(res.listing);
    } catch (e) {
      const mapped = fieldErrorsFromDetails(
        (e as { details?: { path: string; message: string }[] }).details,
      );
      setErrors(Object.keys(mapped).length ? localizeErrors(mapped) : { _form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={editing ? t('form.editAria') : t('form.newAria')}
    >
      {!canSell && <Alert tone="warning">{t('form.sellerRequired')}</Alert>}
      {errors['_form'] && <Alert tone="danger">{errors['_form']}</Alert>}
      <Card title={t('form.animal')} headingLevel={2} style={{ marginBottom: 'var(--ds-space-4)' }}>
        {editing ? (
          <p>
            {animalLabel(listing!.animal)} · {sexLabel(t, listing!.animal.sex)}
          </p>
        ) : (
          <Select
            label={t('form.chooseAnimal')}
            value={animal}
            onChange={(e) => setAnimal(e.target.value)}
            error={errors['animalId']}
          >
            <option value="">{t('form.choose')}</option>
            {animals.map((a) => (
              <option key={a.id} value={a.id}>
                {a.animalCode}
                {a.name ? ` — ${a.name}` : ''} · {typeName(a.animalType, locale)} ·{' '}
                {sexLabel(t, a.sex)}
              </option>
            ))}
          </Select>
        )}
        <p className="ds-field__hint">{t('form.animalHint')}</p>
      </Card>
      <Card
        title={t('form.details')}
        headingLevel={2}
        style={{ marginBottom: 'var(--ds-space-4)' }}
      >
        <TextField
          label={t('form.title')}
          value={title}
          maxLength={LISTING_LIMITS.title}
          onChange={(e) => setTitle(e.target.value)}
          error={errors['title']}
        />
        <Textarea
          label={t('form.description')}
          rows={4}
          maxLength={LISTING_LIMITS.description}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          error={errors['description']}
        />
        <div className="ds-grid ds-grid--2">
          <TextField
            label={t('form.price')}
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            error={errors['askingPriceMinor']}
            hint={parseBahtToMinor(price) ? formatBaht(parseBahtToMinor(price)!) : undefined}
          />
          <TextField
            label={t('form.floor')}
            inputMode="decimal"
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            error={errors['minOfferMinor']}
          />
        </div>
        <label className="ds-row">
          <input
            type="checkbox"
            checked={negotiable}
            onChange={(e) => setNegotiable(e.target.checked)}
          />{' '}
          {t('form.negotiable')}
        </label>
        <Textarea
          label={t('form.conditions')}
          rows={3}
          maxLength={LISTING_LIMITS.conditions}
          value={conditions}
          onChange={(e) => setConditions(e.target.value)}
          error={errors['conditions']}
          hint={t('form.conditionsHint')}
        />
        <fieldset>
          <legend>{t('form.handover')}</legend>
          {DELIVERY_OPTIONS.map((d) => (
            <label key={d} className="ds-row">
              <input
                type="checkbox"
                checked={delivery.includes(d)}
                onChange={() => toggleDelivery(d)}
              />{' '}
              {d === 'pickup' ? t('form.pickup') : t('form.deliver')}
            </label>
          ))}
          {errors['deliveryOptions'] && <p role="alert">{errors['deliveryOptions']}</p>}
        </fieldset>
      </Card>
      {delivery.includes('delivery') && (
        <Card
          title={t('form.deliveryTerms')}
          headingLevel={2}
          style={{ marginBottom: 'var(--ds-space-4)' }}
        >
          <p className="ds-field__hint">{t('form.deliveryHint')}</p>
          <Select
            label={t('form.mode')}
            value={shipMode}
            onChange={(e) => setShipMode(e.target.value as ShippingMode)}
          >
            {SHIPPING_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`form.mode.${m}`)}
              </option>
            ))}
          </Select>
          {shipMode === 'flat' ? (
            <TextField
              label={t('form.flatPrice')}
              inputMode="decimal"
              value={shipFlat}
              onChange={(e) => setShipFlat(e.target.value)}
              error={errors['flatPriceMinor']}
            />
          ) : (
            <>
              {shipProvinces.map((r, i) => (
                <div key={i} className="ds-grid ds-grid--3" style={{ alignItems: 'end' }}>
                  <TextField
                    label={t('form.provinceN', { n: i + 1 })}
                    value={r.province}
                    onChange={(e) =>
                      setShipProvinces((all) =>
                        all.map((x, j) => (j === i ? { ...x, province: e.target.value } : x)),
                      )
                    }
                  />
                  <TextField
                    label={t('form.priceBaht')}
                    inputMode="decimal"
                    value={r.price}
                    onChange={(e) =>
                      setShipProvinces((all) =>
                        all.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)),
                      )
                    }
                  />
                  <Button
                    size="sm"
                    aria-label={t('form.removeProvince', { n: i + 1 })}
                    onClick={() => setShipProvinces((all) => all.filter((_, j) => j !== i))}
                  >
                    {t('form.remove')}
                  </Button>
                </div>
              ))}
              {errors['provinces'] && <p role="alert">{errors['provinces']}</p>}
              <Button
                onClick={() => setShipProvinces((all) => [...all, { province: '', price: '' }])}
              >
                {t('form.addProvince')}
              </Button>
            </>
          )}
          <div className="ds-grid ds-grid--2">
            <TextField
              label={t('form.daysFrom')}
              inputMode="numeric"
              value={shipDays.min}
              onChange={(e) => setShipDays({ ...shipDays, min: e.target.value })}
            />
            <TextField
              label={t('form.daysTo')}
              inputMode="numeric"
              value={shipDays.max}
              onChange={(e) => setShipDays({ ...shipDays, max: e.target.value })}
              error={errors['estimatedDays']}
              hint={t('form.daysHint')}
            />
          </div>
          <fieldset>
            <legend>{t('form.requirements')}</legend>
            {TRANSPORT_REQUIREMENTS.map((r) => (
              <label key={r} className="ds-row">
                <input
                  type="checkbox"
                  checked={shipReq.includes(r)}
                  onChange={() =>
                    setShipReq((all) =>
                      all.includes(r) ? all.filter((x) => x !== r) : [...all, r],
                    )
                  }
                />{' '}
                {t(`transport.${r}`)}
              </label>
            ))}
          </fieldset>
          <Textarea
            label={t('form.notes')}
            rows={2}
            maxLength={500}
            value={shipNotes}
            onChange={(e) => setShipNotes(e.target.value)}
          />
        </Card>
      )}
      <Card
        title={t('form.photos', { count: photos.length, max: LISTING_LIMITS.photos })}
        headingLevel={2}
        style={{ marginBottom: 'var(--ds-space-4)' }}
      >
        {photos.map((p, i) => (
          <div key={i} className="ds-grid ds-grid--3" style={{ alignItems: 'end' }}>
            <TextField
              label={t('form.photoLink', { n: i + 1 })}
              type="url"
              value={p.url}
              onChange={(e) =>
                setPhotos((all) => all.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
              }
              error={errors[`photos.${i}.url`]}
            />
            <TextField
              label={t('form.caption')}
              value={p.caption}
              onChange={(e) =>
                setPhotos((all) =>
                  all.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)),
                )
              }
            />
            <Button
              size="sm"
              aria-label={t('form.removePhoto', { n: i + 1 })}
              onClick={() => setPhotos((all) => all.filter((_, j) => j !== i))}
            >
              {t('form.remove')}
            </Button>
          </div>
        ))}
        {errors['photos'] && <p role="alert">{errors['photos']}</p>}
        <Button
          disabled={photos.length >= LISTING_LIMITS.photos}
          onClick={() => setPhotos((all) => [...all, { url: '', caption: '' }])}
        >
          {t('form.addPhoto')}
        </Button>
        <p className="ds-field__hint">{t('form.photosHint')}</p>
      </Card>
      <div className="ds-row">
        <Button type="submit" variant="primary" loading={busy} disabled={!canSell}>
          {editing ? t('form.saveChanges') : t('form.saveDraft')}
        </Button>
        {onCancel && <Button onClick={onCancel}>{t('cancel')}</Button>}
      </div>
    </form>
  );
}
