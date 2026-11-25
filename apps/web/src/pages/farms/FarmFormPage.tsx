import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { FarmDetail, FarmSummary } from '@farmplus/shared-types';
import {
  createFarmSchema,
  updateFarmSchema,
  fieldErrorsFromDetails,
  fieldErrorsFromZod,
  type FieldErrors,
} from '@farmplus/validation';
import { api } from '../../api';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Modal,
  Select,
  TextField,
  Textarea,
} from '../../components/ui';
import { errorMessage } from '../../lib/format';
import { loadAnimalTypes } from '../../lib/animalTypes';
import { useAsync } from '../../lib/useAsync';
import { localizeErrors, typeName, useFarmsT } from './labels';
import { useLocale } from '../../i18n';

type Draft = Record<
  | 'name'
  | 'description'
  | 'province'
  | 'district'
  | 'subdistrict'
  | 'postalCode'
  | 'address'
  | 'phone'
  | 'email'
  | 'lineId',
  string
>;
const EMPTY: Draft = {
  name: '',
  description: '',
  province: '',
  district: '',
  subdistrict: '',
  postalCode: '',
  address: '',
  phone: '',
  email: '',
  lineId: '',
};

/** Setup steps (create only): which cards each step shows, and which error paths belong to it. */
const STEPS = [
  { card: 'profile', title: 'form.profile', fields: ['name', 'description', 'animalTypeIds'] },
  { card: 'location', title: 'form.location', fields: ['location'] },
  { card: 'contact', title: 'form.contact', fields: ['contact'] },
] as const;

const draftOf = (farm: FarmDetail): Draft => ({
  name: farm.name,
  description: farm.description ?? '',
  province: farm.location.province ?? '',
  district: farm.location.district ?? '',
  subdistrict: farm.location.subdistrict ?? '',
  postalCode: farm.location.postalCode ?? '',
  address: farm.location.address ?? '',
  phone: farm.contact.phone ?? '',
  email: farm.contact.email ?? '',
  lineId: farm.contact.lineId ?? '',
});

/** Drop empty strings so optional fields are simply omitted (the API schema treats "" as invalid). */
const compact = <T extends Record<string, string>>(obj: T) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v.trim() !== ''));

/** `/farms/new` (step-by-step farm setup) and `/farms/:farmId/edit` (all sections at once, reached from the profile). */
export default function FarmFormPage() {
  const t = useFarmsT();
  const { farmId } = useParams();
  const existing = useAsync(
    (signal) =>
      farmId
        ? api.request<{ farm: FarmDetail }>('GET', `/farms/${farmId}`, { signal })
        : Promise.resolve(undefined),
    [farmId],
  );
  if (!farmId) return <FarmForm />;
  if (existing.error)
    return (
      <Alert tone="danger">
        {existing.error}{' '}
        <button type="button" onClick={existing.reload}>
          {t('common.tryAgain')}
        </button>
      </Alert>
    );
  if (!existing.data) return <p role="status">{t('overview.loading')}</p>;
  return <FarmForm farm={existing.data.farm} onSaved={existing.reload} />;
}

function FarmForm({ farm, onSaved }: { farm?: FarmDetail; onSaved?: () => void }) {
  const t = useFarmsT();
  const [locale] = useLocale();
  const navigate = useNavigate();
  const farmId = farm?.id;
  const editing = Boolean(farm);
  /** Sent by the onboarding guard: setup cannot be skipped, so there is no way back. */
  const required = Boolean(
    (useLocation().state as { setupRequired?: boolean } | null)?.setupRequired,
  );
  const pinned: [number, number] | null =
    farm?.location.latitude !== undefined && farm.location.longitude !== undefined
      ? [farm.location.latitude, farm.location.longitude]
      : null;
  const [draft, setDraft] = useState<Draft>(farm ? draftOf(farm) : EMPTY);
  const [typeIds, setTypeIds] = useState<string[]>(farm?.animalTypeIds ?? []);
  const [step, setStep] = useState(0);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const types = useAsync(() => loadAnimalTypes(), []);
  const [places, setPlaces] = useState<PlaceData | null>(null);
  const [placeLoadError, setPlaceLoadError] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number]>(pinned ?? [13.2, 101.0]);
  const [pin, setPin] = useState<[number, number] | null>(pinned);
  useEffect(() => {
    let active = true;
    const loadLevel = async (level: 'province' | 'district' | 'subdistrict') => {
      const response = await fetch(`https://api.openadmindata.org/api/v1/th/${level}.json`);
      if (!response.ok) throw new Error('Address data unavailable');
      const result = (await response.json()) as { entities?: Place[] };
      if (!Array.isArray(result.entities)) throw new Error('Invalid address data');
      return result.entities;
    };
    Promise.all([loadLevel('province'), loadLevel('district'), loadLevel('subdistrict')])
      .then(([province, district, subdistrict]) => {
        if (active) setPlaces({ province, district, subdistrict });
      })
      .catch(() => {
        if (active) setPlaceLoadError(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const provinces = places?.province ?? [];
  const selectedProvince = provinces.find((place) => place.name_local === draft.province);
  const districts = useMemo(
    () => places?.district.filter((place) => place.parent_id === selectedProvince?.id) ?? [],
    [places, selectedProvince],
  );
  const selectedDistrict = districts.find((place) => place.name_local === draft.district);
  const subdistricts = useMemo(
    () => places?.subdistrict.filter((place) => place.parent_id === selectedDistrict?.id) ?? [],
    [places, selectedDistrict],
  );
  const set = (key: keyof Draft) => (e: { target: { value: string } }) =>
    setDraft({ ...draft, [key]: e.target.value });

  const toggleType = (id: string) =>
    setTypeIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  // Types the farm already declared stay selectable even if an admin deactivated them since.
  const typeOptions = (types.data?.animalTypes ?? []).filter(
    (type) => type.status === 'active' || typeIds.includes(type.id),
  );
  const last = editing || step === STEPS.length - 1;
  const show = (card: (typeof STEPS)[number]['card']) => editing || STEPS[step]!.card === card;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    const body = {
      name: draft.name.trim(),
      ...(draft.description.trim()
        ? { description: draft.description.trim() }
        : editing
          ? { description: null }
          : {}),
      location: {
        ...compact({
          province: draft.province,
          district: draft.district,
          subdistrict: draft.subdistrict,
          postalCode: draft.postalCode,
          address: draft.address,
        }),
        ...(pin ? { latitude: pin[0], longitude: pin[1] } : {}),
      },
      contact: compact({ phone: draft.phone, email: draft.email, lineId: draft.lineId }),
      animalTypeIds: typeIds,
    };
    const parsed = (editing ? updateFarmSchema : createFarmSchema).safeParse(body);
    if (!parsed.success) {
      const all = localizeErrors(fieldErrorsFromZod(parsed.error));
      if (editing) return setErrors(all);
      // While stepping through setup, only the current step's fields block "Next".
      const mine = (k: string) => STEPS[step]!.fields.some((f) => k === f || k.startsWith(`${f}.`));
      const current = Object.fromEntries(Object.entries(all).filter(([k]) => mine(k)));
      if (Object.keys(current).length > 0 || last) {
        if (last) {
          const first = STEPS.findIndex((s) =>
            Object.keys(all).some((k) => s.fields.some((f) => k === f || k.startsWith(`${f}.`))),
          );
          if (first >= 0) setStep(first);
        }
        return setErrors(last ? all : current);
      }
    }
    if (!last) {
      setErrors({});
      return setStep(step + 1);
    }
    if (!parsed.success) return;
    setBusy(true);
    setErrors({});
    try {
      if (editing) {
        await api.request<{ farm: FarmSummary }>('PATCH', `/farms/${farmId}`, {
          body: parsed.data,
        });
        setSaved(true);
        onSaved?.();
        return;
      }
      const res = await api.request<{ farm: FarmSummary }>('POST', '/farms', { body: parsed.data });
      navigate(`/farms/${res.farm.id}`, { replace: true });
    } catch (e) {
      const fromApi = fieldErrorsFromDetails(
        (e as { details?: { path: string; message: string }[] }).details,
      );
      setErrors(
        Object.keys(fromApi).length > 0 ? localizeErrors(fromApi) : { _form: errorMessage(e) },
      );
    } finally {
      setBusy(false);
    }
  };

  const f = (key: string) => errors[key];
  return (
    <>
      {!required && (
        <p>
          <Link to={editing ? `/farms/${farmId}` : '/farms'}>
            {editing ? t('common.back') : t('common.backToFarms')}
          </Link>
        </p>
      )}
      {required && <Alert tone="warning">{t('setup.required')}</Alert>}
      <h1>{editing ? t('form.editTitle') : t('setup.title')}</h1>
      {!editing && (
        <>
          <p>{t('setup.intro')}</p>
          {/* The badges carry the step numbers, so the list's own markers are hidden (no "1. 1."). */}
          <ol
            className="ds-row"
            data-tour="farm-setup-steps"
            style={{ listStyle: 'none' }}
            aria-label={t('setup.step', { n: step + 1, total: STEPS.length })}
          >
            {STEPS.map((s, i) => (
              <li key={s.card} aria-current={i === step ? 'step' : undefined}>
                <Badge tone={i < step ? 'success' : i === step ? 'info' : 'neutral'}>
                  {i + 1}. {t(s.title)}
                </Badge>
              </li>
            ))}
          </ol>
          <p role="status">{t('setup.step', { n: step + 1, total: STEPS.length })}</p>
        </>
      )}
      {farm?.status === 'archived' && <Alert tone="warning">{t('common.farmArchived')}</Alert>}
      {saved && <Alert tone="success">{t('form.saved')}</Alert>}
      <form onSubmit={submit} noValidate>
        {show('profile') && (
          <Card title={t('form.profile')} headingLevel={2}>
            <TextField
              label={t('form.name')}
              data-tour="farm-name"
              value={draft.name}
              onChange={set('name')}
              error={f('name')}
              required
            />
            <Textarea
              label={t('form.description')}
              value={draft.description}
              onChange={set('description')}
              error={f('description')}
              rows={3}
            />
            <fieldset
              className="ds-field"
              style={{ border: 0, padding: 0, margin: 0 }}
              data-tour="farm-animal-types"
            >
              <legend className="ds-field__label">{t('form.animalTypes')}</legend>
              <p className="ds-field__hint">{t('form.animalTypesHint')}</p>
              {types.error && <p role="alert">{t('form.animalTypesLoadError')}</p>}
              <div className="ds-row">
                {typeOptions.map((type) => (
                  <Checkbox
                    key={type.id}
                    label={typeName(type, locale)}
                    checked={typeIds.includes(type.id)}
                    onChange={() => toggleType(type.id)}
                  />
                ))}
              </div>
              {f('animalTypeIds') && <p className="ds-field__error">{f('animalTypeIds')}</p>}
            </fieldset>
          </Card>
        )}
        {show('location') && (
          <Card
            title={t('form.location')}
            headingLevel={2}
            style={{ marginTop: 'var(--ds-space-4)' }}
          >
            <div className="ds-grid ds-grid--2" data-tour="farm-location">
              <Select
                label={t('form.province')}
                value={draft.province}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    province: e.target.value,
                    district: '',
                    subdistrict: '',
                    postalCode: '',
                  })
                }
                error={f('location.province')}
              >
                <option value="">{t('form.selectProvince')}</option>
                {provinces.map((p) => (
                  <option key={p.id} value={p.name_local}>
                    {p.name_local}
                  </option>
                ))}
              </Select>
              <Select
                label={t('form.district')}
                value={draft.district}
                onChange={(e) =>
                  setDraft({ ...draft, district: e.target.value, subdistrict: '', postalCode: '' })
                }
                error={f('location.district')}
                disabled={!selectedProvince}
              >
                <option value="">{t('form.selectDistrict')}</option>
                {districts.map((p) => (
                  <option key={p.id} value={p.name_local}>
                    {p.name_local}
                  </option>
                ))}
              </Select>
              <Select
                label={t('form.subdistrict')}
                value={draft.subdistrict}
                onChange={(e) => {
                  const place = subdistricts.find((p) => p.name_local === e.target.value);
                  setDraft({
                    ...draft,
                    subdistrict: e.target.value,
                    postalCode: place?.postal_code ?? '',
                  });
                  if (place?.lat && place.lon) setMapCenter([place.lat, place.lon]);
                }}
                error={f('location.subdistrict')}
                disabled={!selectedDistrict}
              >
                <option value="">{t('form.selectSubdistrict')}</option>
                {subdistricts.map((p) => (
                  <option key={p.id} value={p.name_local}>
                    {p.name_local}
                  </option>
                ))}
              </Select>
              <TextField
                label={t('form.postalCode')}
                value={draft.postalCode}
                onChange={set('postalCode')}
                error={f('location.postalCode')}
                inputMode="numeric"
              />
            </div>
            <TextField
              label={t('form.address')}
              value={draft.address}
              onChange={set('address')}
              error={f('location.address')}
            />
            {placeLoadError && <p role="status">{t('form.addressUnavailable')}</p>}
            <div style={{ marginTop: 'var(--ds-space-4)' }}>
              <strong>{t('form.pin')}</strong>
              <p className="ds-field__hint">{t('form.pinHint')}</p>
              <MapPinPicker center={mapCenter} pin={pin} onPin={setPin} />
              {pin && (
                <p>
                  📍 {pin[0].toFixed(6)}, {pin[1].toFixed(6)}{' '}
                  <button type="button" onClick={() => setPin(null)}>
                    {t('form.removePin')}
                  </button>
                </p>
              )}
            </div>
          </Card>
        )}
        {show('contact') && (
          <Card
            title={t('form.contact')}
            data-tour="farm-contact"
            headingLevel={2}
            style={{ marginTop: 'var(--ds-space-4)' }}
          >
            <div className="ds-grid ds-grid--2">
              <TextField
                label={t('form.phone')}
                value={draft.phone}
                onChange={set('phone')}
                error={f('contact.phone')}
                type="tel"
              />
              <TextField
                label={t('form.email')}
                value={draft.email}
                onChange={set('email')}
                error={f('contact.email')}
                type="email"
              />
            </div>
            <TextField
              label={t('form.lineId')}
              value={draft.lineId}
              onChange={set('lineId')}
              error={f('contact.lineId')}
            />
          </Card>
        )}
        {errors['_form'] && (
          <Alert tone="danger" style={{ marginTop: 'var(--ds-space-4)' }}>
            {errors['_form']}
          </Alert>
        )}
        <div className="ds-row" style={{ marginTop: 'var(--ds-space-4)' }}>
          {!editing && step > 0 && (
            <Button
              type="button"
              onClick={() => {
                setErrors({});
                setStep(step - 1);
              }}
            >
              {t('setup.back')}
            </Button>
          )}
          <Button type="submit" variant="primary" loading={busy} data-tour="farm-setup-submit">
            {editing ? t('form.save') : last ? t('setup.finish') : t('setup.next')}
          </Button>
          {!required && (
            <Link to={editing ? `/farms/${farmId}` : '/farms'}>{t('common.cancel')}</Link>
          )}
        </div>
      </form>
      {farm && farm.access.permissions.includes('farm.archive') && (
        <ArchiveFarmCard farm={farm} onRestored={onSaved} />
      )}
    </>
  );
}

/**
 * Archive (or restore) the farm — owners only (`farm.archive`; the API checks it again). Archiving asks for
 * confirmation first, like archiving an animal, then opens the farm, which shows it as archived and read-only.
 */
function ArchiveFarmCard({ farm, onRestored }: { farm: FarmDetail; onRestored?: () => void }) {
  const t = useFarmsT();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [restored, setRestored] = useState(false);
  const archived = farm.status === 'archived';
  const run = async (action: 'archive' | 'restore') => {
    setBusy(true);
    setError(undefined);
    try {
      await api.request<{ farm: FarmSummary }>('POST', `/farms/${farm.id}/${action}`);
      if (action === 'archive') {
        setConfirming(false);
        navigate(`/farms/${farm.id}`);
      } else {
        setRestored(true);
        onRestored?.();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title={t('form.archiveTitle')}
      headingLevel={2}
      style={{ marginTop: 'var(--ds-space-4)' }}
    >
      {restored && <Alert tone="success">{t('form.restored')}</Alert>}
      {archived ? (
        <>
          <p>{t('form.restoreHint')}</p>
          {error && <Alert tone="danger">{error}</Alert>}
          <Button loading={busy} onClick={() => void run('restore')}>
            {t('form.restore')}
          </Button>
        </>
      ) : (
        <>
          <p>{t('form.archiveHint')}</p>
          <Button
            variant="danger"
            onClick={() => {
              setError(undefined);
              setConfirming(true);
            }}
          >
            {t('form.archive')}
          </Button>
        </>
      )}
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('form.archiveConfirmTitle', { name: farm.name })}
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" loading={busy} onClick={() => void run('archive')}>
              {t('form.archive')}
            </Button>
          </>
        }
      >
        <p>{t('form.archiveConfirm')}</p>
        {error && <Alert tone="danger">{error}</Alert>}
      </Modal>
    </Card>
  );
}

type Place = {
  id: string;
  name_local: string;
  parent_id: string | null;
  postal_code?: string | null;
  lat?: number;
  lon?: number;
};
type PlaceData = { province: Place[]; district: Place[]; subdistrict: Place[] };

function MapPinPicker({
  center,
  pin,
  onPin,
}: {
  center: [number, number];
  pin: [number, number] | null;
  onPin: (value: [number, number]) => void;
}) {
  const t = useFarmsT();
  const bounds = {
    north: center[0] + 0.15,
    south: center[0] - 0.15,
    east: center[1] + 0.2,
    west: center[1] - 0.2,
  };
  const params = new URLSearchParams({
    bbox: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    layer: 'mapnik',
    marker: pin ? `${pin[0]},${pin[1]}` : '',
  });
  const pick = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    onPin([
      bounds.north - y * (bounds.north - bounds.south),
      bounds.west + x * (bounds.east - bounds.west),
    ]);
  };
  return (
    <div
      data-tour="farm-map-pin"
      onClick={pick}
      role="button"
      tabIndex={0}
      aria-label={t('form.mapAria')}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onPin(center);
      }}
      style={{
        height: 320,
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 12,
        border: '1px solid var(--ds-color-border, #ccd3d8)',
        cursor: 'crosshair',
      }}
    >
      <iframe
        title={t('form.mapTitle')}
        src={`https://www.openstreetmap.org/export/embed.html?${params}`}
        style={{ width: '100%', height: '100%', border: 0, pointerEvents: 'none' }}
      />
      {pin && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: `${((pin[1] - bounds.west) / (bounds.east - bounds.west)) * 100}%`,
            top: `${((bounds.north - pin[0]) / (bounds.north - bounds.south)) * 100}%`,
            transform: 'translate(-50%, -100%)',
            fontSize: 30,
            pointerEvents: 'none',
          }}
        >
          📍
        </span>
      )}
    </div>
  );
}
