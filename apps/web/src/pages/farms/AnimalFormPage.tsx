import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ANIMAL_ORIGINS,
  ANIMAL_SEXES,
  ANIMAL_STATUSES,
  type AnimalDetail,
  type AnimalSummary,
  type Page,
} from '@farmplus/shared-types';
import {
  createAnimalSchema,
  createWeightSchema,
  estimatedBirthDate,
  fieldErrorsFromDetails,
  fieldErrorsFromZod,
  thaiToday,
  updateAnimalSchema,
  type FieldErrors,
} from '@farmplus/validation';
import { api } from '../../api';
import { Alert, Button, Card, Checkbox, Select, TextField, Textarea } from '../../components/ui';
import { useLocale } from '../../i18n';
import { errorMessage } from '../../lib/format';
import { loadAnimalTypes } from '../../lib/animalTypes';
import { useAsync } from '../../lib/useAsync';
import { breedLabel, enumLabel, localizeErrors, typeName, useFarmsT } from './labels';
import { MAX_PHOTOS, PhotoPicker, uploadPhotos, type PendingPhoto } from './PhotoPicker';
import { useFarm } from './useFarmAccess';
import { maxLengthOf } from '../../lib/schemaLimits';

interface Draft {
  animalCode: string;
  animalTypeId: string;
  breed: string;
  name: string;
  sex: string;
  birthDate: string;
  birthDateEstimated: boolean;
  acquisitionDate: string;
  originKind: string;
  originNote: string;
  currentStatus: string;
  sireId: string;
  damId: string;
  color: string;
  notes: string;
  rearingType: string;
  /** UI-only filter of the breed list (the group comes from the catalogue, never stored on the animal). */
  breedGroup: string;
  crossBreeds: string[];
  /** Create only: first weighing (kg), saved as a weight record. */
  weightKg: string;
}
const EMPTY: Draft = {
  animalCode: '',
  animalTypeId: '',
  breed: '',
  name: '',
  sex: '',
  birthDate: '',
  birthDateEstimated: false,
  acquisitionDate: '',
  originKind: 'born_on_farm',
  originNote: '',
  currentStatus: 'active',
  sireId: '',
  damId: '',
  color: '',
  notes: '',
  rearingType: '',
  breedGroup: '',
  crossBreeds: [],
  weightKg: '',
};
const toDraft = (a: AnimalDetail): Draft => ({
  animalCode: a.animalCode,
  animalTypeId: a.animalType.id,
  breed: a.breed ?? '',
  name: a.name ?? '',
  sex: a.sex,
  birthDate: a.birthDate ?? '',
  birthDateEstimated: a.birthDateEstimated,
  acquisitionDate: a.acquisitionDate ?? '',
  originKind: a.origin.kind,
  originNote: a.origin.note ?? '',
  currentStatus: a.currentStatus,
  sireId: a.sire?.id ?? '',
  damId: a.dam?.id ?? '',
  color: a.color ?? '',
  notes: a.notes ?? '',
  rearingType: a.rearingType ?? '',
  breedGroup: a.breedGroup?.key ?? '',
  crossBreeds: a.crossBreeds ?? [],
  weightKg: '',
});

/** "C-1 — Name · Breed": parents are picked by code, with their breed shown straight away. */
const parentLabel = (a: AnimalSummary, locale: string) =>
  [`${a.animalCode}${a.name ? ` — ${a.name}` : ''}`, breedLabel(a, locale)]
    .filter(Boolean)
    .join(' · ');

/** One form for registering a new animal and editing an existing one (identity fields are read-only when editing). */
export default function AnimalFormPage() {
  const t = useFarmsT();
  const [locale] = useLocale();
  const { farmId, animalId } = useParams();
  const editing = animalId !== undefined;
  const navigate = useNavigate();
  const { farm, can } = useFarm(farmId);
  const types = useAsync(() => loadAnimalTypes(), []);
  const existing = useAsync(
    async (signal) =>
      editing
        ? (
            await api.request<{ animal: AnimalDetail }>(
              'GET',
              `/farms/${farmId}/animals/${animalId}`,
              { signal },
            )
          ).animal
        : null,
    [farmId, animalId],
  );
  const location = useLocation();
  // Values the assistant understood (PR 6a), new animals only: text fields of this form, for the person to check.
  const [edits, setEdits] = useState<Partial<Draft>>(() => {
    const given = (location.state as { assistantPrefill?: Record<string, unknown> } | null)
      ?.assistantPrefill;
    if (editing || !given) return {};
    return Object.fromEntries(
      Object.entries(given).filter(
        ([k, v]) =>
          typeof v === 'string' &&
          typeof (EMPTY as unknown as Record<string, unknown>)[k] === 'string',
      ),
    ) as Partial<Draft>;
  });
  const base = existing.data ? toDraft(existing.data) : EMPTY;
  const draft: Draft = { ...base, ...edits };
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [approx, setApprox] = useState({ years: '', months: '' });
  const [approxError, setApproxError] = useState<string>();
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [uploading, setUploading] = useState<number>();

  // Parent pickers: same species only; sires are male, dams are female.
  const parents = useAsync(
    async (signal) => {
      if (!draft.animalTypeId) return { sires: [], dams: [] };
      const get = (sex: string) =>
        api.request<Page<AnimalSummary>>('GET', `/farms/${farmId}/animals`, {
          query: {
            animalTypeId: draft.animalTypeId,
            sex,
            pageSize: 100,
            sortBy: 'animalCode',
            order: 'asc',
          },
          signal,
        });
      const [sires, dams] = await Promise.all([get('male'), get('female')]);
      return { sires: sires.items, dams: dams.items };
    },
    [farmId, draft.animalTypeId],
  );

  const type = types.data?.animalTypes.find((x) => x.id === draft.animalTypeId);
  // Groups of the chosen rearing type (or all); breeds of the chosen group (or all).
  const groups = (type?.breedGroups ?? []).filter(
    (g) => !draft.rearingType || !g.rearingTypeKey || g.rearingTypeKey === draft.rearingType,
  );
  const breeds = (type?.breeds ?? []).filter(
    (b) => !draft.breedGroup || b.groupKey === draft.breedGroup,
  );
  const breedName = (key: string) => {
    const b = type?.breeds.find((x) => x.key === key);
    return b ? typeName(b, locale) : key;
  };
  /** Editing a field clears its error straight away (it is re-validated on the next submit). */
  const clearError = (key: string) =>
    setErrors((e) =>
      key in e ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)) : e,
    );
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setEdits((e) => ({ ...e, [key]: value }));
    clearError(key === 'originKind' ? 'origin.kind' : key);
  };
  const field = (key: string) => errors[key];
  const text = (key: keyof Draft) => ({
    value: draft[key] as string,
    onChange: (e: { target: { value: string } }) => set(key, e.target.value as never),
  });

  if (farm && (farm.status === 'archived' || !can('animals.write'))) {
    return (
      <Alert tone="warning">
        {farm.status === 'archived' ? t('common.farmArchived') : t('animalForm.noPermission')}
      </Alert>
    );
  }
  if (existing.data?.archived) return <Alert tone="warning">{t('animalForm.archived')}</Alert>;

  /** "About N years M months" → an estimated birth date, always flagged as estimated (never shown as exact). */
  const applyApproxAge = () => {
    const n = (v: string) => (v.trim() === '' ? 0 : Number(v));
    const date = estimatedBirthDate(n(approx.years), n(approx.months));
    if (!date) return setApproxError(t('animalForm.approxAgeInvalid'));
    setApproxError(undefined);
    set('birthDate', date);
    set('birthDateEstimated', true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const optional = (v: string) => (v.trim() === '' ? undefined : v.trim());
    const origin = {
      kind: draft.originKind,
      ...(optional(draft.originNote) ? { note: draft.originNote.trim() } : {}),
    };
    let parsed;
    if (!editing) {
      parsed = createAnimalSchema.safeParse({
        ...(optional(draft.animalCode) ? { animalCode: draft.animalCode.trim() } : {}),
        animalTypeId: draft.animalTypeId,
        ...(optional(draft.breed) ? { breed: draft.breed } : {}),
        ...(optional(draft.name) ? { name: draft.name.trim() } : {}),
        sex: draft.sex,
        ...(optional(draft.birthDate) ? { birthDate: draft.birthDate } : {}),
        birthDateEstimated: draft.birthDateEstimated,
        ...(optional(draft.acquisitionDate) ? { acquisitionDate: draft.acquisitionDate } : {}),
        origin,
        currentStatus: draft.currentStatus,
        ...(optional(draft.sireId) ? { sireId: draft.sireId } : {}),
        ...(optional(draft.damId) ? { damId: draft.damId } : {}),
        ...(optional(draft.color) ? { color: draft.color.trim() } : {}),
        ...(optional(draft.notes) ? { notes: draft.notes.trim() } : {}),
        ...(optional(draft.rearingType) ? { rearingType: draft.rearingType } : {}),
        ...(draft.crossBreeds.length ? { crossBreeds: draft.crossBreeds } : {}),
      });
      if (optional(draft.weightKg) && !(Number(draft.weightKg) > 0))
        return setErrors({ weightKg: t('animalForm.weightInvalid') });
    } else {
      // PATCH only what changed; clearing an optional field sends null.
      const diff: Record<string, unknown> = {};
      const nullable = (k: keyof Draft, v: string) => {
        if (draft[k] !== base[k])
          diff[k === 'sireId' || k === 'damId' ? k : k] = optional(v) ?? null;
      };
      nullable('breed', draft.breed);
      nullable('name', draft.name);
      nullable('birthDate', draft.birthDate);
      nullable('acquisitionDate', draft.acquisitionDate);
      nullable('sireId', draft.sireId);
      nullable('damId', draft.damId);
      nullable('color', draft.color);
      nullable('notes', draft.notes);
      nullable('rearingType', draft.rearingType);
      if (draft.crossBreeds.join(',') !== base.crossBreeds.join(','))
        diff['crossBreeds'] = draft.crossBreeds.length ? draft.crossBreeds : null;
      if (draft.sex !== base.sex) diff['sex'] = draft.sex;
      if (draft.currentStatus !== base.currentStatus) diff['currentStatus'] = draft.currentStatus;
      if (draft.birthDateEstimated !== base.birthDateEstimated)
        diff['birthDateEstimated'] = draft.birthDateEstimated;
      if (draft.originKind !== base.originKind || draft.originNote !== base.originNote)
        diff['origin'] = origin;
      parsed = updateAnimalSchema.safeParse(diff);
    }
    if (!parsed.success) return setErrors(localizeErrors(fieldErrorsFromZod(parsed.error)));

    setBusy(true);
    setErrors({});
    try {
      const res = editing
        ? await api.request<{ animal: AnimalDetail }>(
            'PATCH',
            `/farms/${farmId}/animals/${animalId}`,
            { body: parsed.data },
          )
        : await api.request<{ animal: AnimalDetail }>('POST', `/farms/${farmId}/animals`, {
            body: parsed.data,
          });
      let photoError: string | undefined;
      // The first weighing is a normal weight record (needs records.write); a failure keeps the animal.
      if (!editing && optional(draft.weightKg)) {
        const weight = createWeightSchema.safeParse({
          animalId: res.animal.id,
          weighedOn: draft.acquisitionDate || thaiToday(),
          weightKg: Number(draft.weightKg),
          method: 'scale',
        });
        try {
          if (weight.success)
            await api.request('POST', `/farms/${farmId}/weights`, { body: weight.data });
        } catch (e) {
          photoError = t('animalForm.weightFailed', { error: errorMessage(e) });
        }
      }
      if (photos.length > 0) {
        try {
          await uploadPhotos(farmId!, res.animal.id, photos, setUploading);
        } catch (e) {
          photoError = [photoError, t('photos.uploadFailed', { error: errorMessage(e) })]
            .filter(Boolean)
            .join(' ');
        }
      }
      navigate(`/farms/${farmId}/animals/${res.animal.id}`, { state: { photoError } });
    } catch (e) {
      const fromApi = fieldErrorsFromDetails(
        (e as { details?: { path: string; message: string }[] }).details,
      );
      setErrors(
        Object.keys(fromApi).length > 0 ? localizeErrors(fromApi) : { _form: errorMessage(e) },
      );
    } finally {
      setBusy(false);
      setUploading(undefined);
    }
  };
  const photoRoom = MAX_PHOTOS - (existing.data?.media.length ?? 0);
  const cancelTo = editing ? `/farms/${farmId}/animals/${animalId}` : `/farms/${farmId}/animals`;

  if (editing && existing.loading && !existing.data)
    return <p role="status">{t('detail.loading')}</p>;
  return (
    <>
      <p>
        <Link to={cancelTo}>{t('common.back')}</Link>
      </p>
      <h1>
        {editing
          ? t('animalForm.editTitle', { code: existing.data?.animalCode ?? t('animalForm.animal') })
          : t('animals.register')}
      </h1>
      <form onSubmit={submit} noValidate className="fd-form-layout">
        <div className="fd-form-layout__main">
          <Card title={t('animalForm.identity')} headingLevel={2}>
            <div className="fd-form-grid">
              <TextField
                label={t('animalForm.code')}
                data-tour="animal-code"
                hint={editing ? t('animalForm.codeLocked') : t('animalForm.codeHint')}
                disabled={editing}
                error={field('animalCode')}
                {...text('animalCode')}
              />
              <TextField label={t('animals.col.name')} error={field('name')} {...text('name')} />
              <Select
                label={t('dashboard.animalType')}
                data-tour="animal-type"
                required
                disabled={editing}
                error={field('animalTypeId')}
                value={draft.animalTypeId}
                onChange={(e) => {
                  setEdits((x) => ({
                    ...x,
                    animalTypeId: e.target.value,
                    breed: '',
                    breedGroup: '',
                    rearingType: '',
                    crossBreeds: [],
                    sireId: '',
                    damId: '',
                  }));
                  clearError('animalTypeId');
                }}
              >
                <option value="">{t('common.choose')}</option>
                {types.data?.animalTypes.map((x) => (
                  <option key={x.id} value={x.id}>
                    {typeName(x, locale)}
                  </option>
                ))}
              </Select>
              {type && (type.rearingTypes ?? []).length > 0 && (
                <Select
                  label={t('animalForm.rearingType')}
                  error={field('rearingType')}
                  value={draft.rearingType}
                  onChange={(e) => {
                    set('rearingType', e.target.value);
                    set('breedGroup', '');
                  }}
                >
                  <option value="">{t('animalForm.notSpecified')}</option>
                  {(type.rearingTypes ?? []).map((r) => (
                    <option key={r.key} value={r.key}>
                      {typeName(r, locale)}
                    </option>
                  ))}
                </Select>
              )}
              {groups.length > 0 && (
                <Select
                  label={t('animalForm.breedGroup')}
                  value={draft.breedGroup}
                  onChange={(e) => {
                    set('breedGroup', e.target.value);
                    set('breed', '');
                  }}
                >
                  <option value="">{t('animalForm.allGroups')}</option>
                  {groups.map((g) => (
                    <option key={g.key} value={g.key}>
                      {typeName(g, locale)}
                    </option>
                  ))}
                </Select>
              )}
              <Select
                label={t('animalForm.breed')}
                data-tour="animal-breed"
                error={field('breed')}
                value={draft.breed}
                onChange={(e) => {
                  const key = e.target.value;
                  const group = type?.breeds.find((b) => b.key === key)?.groupKey;
                  set('breed', key);
                  if (group) set('breedGroup', group);
                }}
                disabled={!type}
              >
                <option value="">
                  {type ? t('animalForm.notSpecified') : t('animalForm.chooseTypeFirst')}
                </option>
                {breeds.map((b) => (
                  <option key={b.key} value={b.key}>
                    {typeName(b, locale)}
                  </option>
                ))}
                {editing && draft.breed && !type?.breeds.some((b) => b.key === draft.breed) && (
                  <option value={draft.breed}>{breedLabel({ breed: draft.breed }, locale)}</option>
                )}
              </Select>
              {type && type.breeds.length > 1 && (
                <div className="ds-field">
                  <Select
                    label={t('animalForm.crossBreeds')}
                    hint={t('animalForm.crossBreedsHint')}
                    error={field('crossBreeds')}
                    value=""
                    onChange={(e) =>
                      e.target.value &&
                      set('crossBreeds', [...draft.crossBreeds, e.target.value].slice(0, 6))
                    }
                  >
                    <option value="">{t('animalForm.addCrossBreed')}</option>
                    {type.breeds
                      .filter((b) => b.key !== draft.breed && !draft.crossBreeds.includes(b.key))
                      .map((b) => (
                        <option key={b.key} value={b.key}>
                          {typeName(b, locale)}
                        </option>
                      ))}
                  </Select>
                  {draft.crossBreeds.length > 0 && (
                    <p className="ds-row" style={{ gap: 'var(--ds-space-1)' }}>
                      {draft.crossBreeds.map((k) => (
                        <Button
                          key={k}
                          size="sm"
                          aria-label={t('animalForm.removeCrossBreed', {
                            name: breedName(k),
                          })}
                          onClick={() =>
                            set(
                              'crossBreeds',
                              draft.crossBreeds.filter((x) => x !== k),
                            )
                          }
                        >
                          {breedName(k)} ✕
                        </Button>
                      ))}
                    </p>
                  )}
                </div>
              )}
              <Select
                label={t('animals.col.sex')}
                data-tour="animal-sex"
                required
                error={field('sex')}
                {...text('sex')}
              >
                <option value="">{t('common.choose')}</option>
                {ANIMAL_SEXES.map((s) => (
                  <option key={s} value={s}>
                    {enumLabel(t, 'sex', s)}
                  </option>
                ))}
              </Select>
              <Select
                label={t('animalForm.currentStatus')}
                error={field('currentStatus')}
                {...text('currentStatus')}
              >
                {ANIMAL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {enumLabel(t, 'status', s)}
                  </option>
                ))}
              </Select>
              <TextField
                label={t('animalForm.color')}
                hint={t('animalForm.colorHint')}
                error={field('color')}
                {...text('color')}
              />
              {!editing && (
                <TextField
                  label={t('animalForm.weightKg')}
                  data-tour="animal-first-weight"
                  hint={t('animalForm.weightHint')}
                  inputMode="decimal"
                  error={field('weightKg')}
                  {...text('weightKg')}
                />
              )}
            </div>
            {farm && (
              <p className="ds-field__hint">
                {t('animalForm.farmLine', { farm: farm.name })}
                {farm.owner && ` · ${t('animalForm.ownerLine', { owner: farm.owner.displayName })}`}
              </p>
            )}
          </Card>

          <Card title={t('animalForm.datesOrigin')} headingLevel={2} data-tour="animal-birth">
            <div className="fd-form-grid">
              <TextField
                label={t('detail.birthDate')}
                data-tour="animal-birth-date"
                type="date"
                error={field('birthDate')}
                {...text('birthDate')}
              />
              <TextField
                label={t('animalForm.acquisitionDate')}
                type="date"
                error={field('acquisitionDate')}
                {...text('acquisitionDate')}
              />
              <Select
                label={t('detail.origin')}
                error={field('origin.kind')}
                {...text('originKind')}
              >
                {ANIMAL_ORIGINS.map((o) => (
                  <option key={o} value={o}>
                    {enumLabel(t, 'origin', o)}
                  </option>
                ))}
              </Select>
            </div>
            <TextField
              label={t('animalForm.originNote')}
              error={field('origin.note')}
              {...text('originNote')}
            />
            <Checkbox
              label={t('animalForm.birthEstimated')}
              checked={draft.birthDateEstimated}
              onChange={(e) => set('birthDateEstimated', e.target.checked)}
            />
            <fieldset
              className="ds-field"
              style={{ border: 0, padding: 0, margin: 0 }}
              data-tour="animal-approx-age"
            >
              <legend className="ds-field__label">{t('animalForm.approxAge')}</legend>
              <p className="ds-field__hint">{t('animalForm.approxAgeHint')}</p>
              <div className="ds-row" style={{ alignItems: 'flex-end' }}>
                <TextField
                  label={t('animalForm.approxYears')}
                  inputMode="numeric"
                  value={approx.years}
                  onChange={(e) => setApprox((x) => ({ ...x, years: e.target.value }))}
                />
                <TextField
                  label={t('animalForm.approxMonths')}
                  inputMode="numeric"
                  value={approx.months}
                  onChange={(e) => setApprox((x) => ({ ...x, months: e.target.value }))}
                  error={approxError}
                />
                <Button type="button" onClick={applyApproxAge}>
                  {t('animalForm.useApproxAge')}
                </Button>
              </div>
            </fieldset>
          </Card>

          <Card title={t('animalForm.parents')} headingLevel={2} data-tour="animal-parents">
            <div className="fd-form-grid fd-form-grid--2">
              <Select
                label={t('animalForm.sire')}
                error={field('sireId')}
                {...text('sireId')}
                disabled={!draft.animalTypeId}
              >
                <option value="">{t('common.unknown')}</option>
                {parents.data?.sires
                  .filter((a) => a.id !== animalId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {parentLabel(a, locale)}
                    </option>
                  ))}
              </Select>
              <Select
                label={t('animalForm.dam')}
                error={field('damId')}
                {...text('damId')}
                disabled={!draft.animalTypeId}
              >
                <option value="">{t('common.unknown')}</option>
                {parents.data?.dams
                  .filter((a) => a.id !== animalId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {parentLabel(a, locale)}
                    </option>
                  ))}
              </Select>
            </div>
          </Card>

          <Card title={t('animalForm.notes')} headingLevel={2}>
            <Textarea
              label={t('animalForm.notes')}
              rows={4}
              maxLength={maxLengthOf(createAnimalSchema, 'notes')}
              error={field('notes')}
              {...text('notes')}
            />
          </Card>
        </div>

        <aside className="fd-form-layout__aside">
          <Card
            title={t('photos.title', { count: photos.length, max: Math.max(0, photoRoom) })}
            headingLevel={2}
          >
            <PhotoPicker
              photos={photos}
              onChange={setPhotos}
              max={Math.max(0, photoRoom)}
              disabled={busy}
            />
          </Card>
          <Card>
            {errors['_form'] && (
              <Alert tone="danger" style={{ marginBottom: 'var(--ds-space-3)' }}>
                {errors['_form']}
              </Alert>
            )}
            {uploading !== undefined && (
              <p role="status" className="ds-field__hint">
                {t('photos.uploading', { n: uploading, total: photos.length })}
              </p>
            )}
            <div className="fd-form-actions">
              <Button type="submit" variant="primary" loading={busy} data-tour="animal-save">
                {editing ? t('animalForm.save') : t('animals.register')}
              </Button>
              <Link to={cancelTo}>{t('common.cancel')}</Link>
            </div>
          </Card>
        </aside>
      </form>
    </>
  );
}
