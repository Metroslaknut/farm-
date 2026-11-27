import { useEffect, useState, type FormEvent } from 'react';
import {
  GROWTH_SOURCE_KINDS,
  GROWTH_STANDARD_KINDS,
  GROWTH_STANDARD_SEXES,
  type AnimalTypeSummary,
  type GrowthStandardDTO,
  type GrowthStandardKind,
} from '@farmplus/shared-types';
import { createGrowthStandardSchema, updateGrowthStandardSchema } from '@farmplus/validation';
import { localName } from '@farmplus/shared-utils';
import { api } from '../../../api';
import { StateMessage } from '../../../components/admin';
import { useAdminI18n, type AdminKey } from '../../../components/admin/i18n';
import { errorMessage } from '../../../lib/format';
import { Tag } from '../finance-common';

const BOUNDS = [
  'minWeightKg',
  'maxWeightKg',
  'minHeightCm',
  'maxHeightCm',
  'minLengthCm',
  'maxLengthCm',
] as const;
type Bound = (typeof BOUNDS)[number];

interface Form extends Record<Bound, string> {
  animalTypeId: string;
  kind: GrowthStandardKind;
  breed: string;
  sex: string;
  ageFromDays: string;
  ageToDays: string;
  sourceKind: string;
  citation: string;
  note: string;
}

const formOf = (s: GrowthStandardDTO | null, typeId: string): Form => ({
  animalTypeId: s?.animalType.id ?? typeId,
  kind: s?.kind ?? 'weight_for_age',
  breed: s?.breed ?? '',
  sex: s?.sex ?? 'any',
  ageFromDays: s ? String(s.ageFromDays) : '',
  ageToDays: s ? String(s.ageToDays) : '',
  ...(Object.fromEntries(
    BOUNDS.map((b) => [b, s?.[b] === undefined ? '' : String(s[b])]),
  ) as Record<Bound, string>),
  sourceKind: s?.source.kind ?? 'system_recommendation',
  citation: s?.source.citation ?? '',
  note: s?.source.note ?? '',
});

const range = (min?: number, max?: number) =>
  min === undefined && max === undefined ? null : `${min ?? '…'}–${max ?? '…'}`;

/** `/admin/growth-standards` — growth criteria per type / breed / sex (API `/growth-standards`, `animal_types.manage`). */
export default function GrowthStandardsPage() {
  const { t, locale } = useAdminI18n();
  const [types, setTypes] = useState<AnimalTypeSummary[]>();
  const [rows, setRows] = useState<GrowthStandardDTO[]>();
  const [error, setError] = useState<string>();
  const [typeId, setTypeId] = useState('');
  const [inactive, setInactive] = useState(false);
  const [editing, setEditing] = useState<GrowthStandardDTO | 'new' | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .request<{ animalTypes: AnimalTypeSummary[] }>('GET', '/animal-types', {
        query: { includeInactive: 'true' },
      })
      .then((r) => live && setTypes(r.animalTypes))
      .catch((e: unknown) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    api
      .request<{ standards: GrowthStandardDTO[] }>('GET', '/growth-standards', {
        query: { ...(typeId ? { animalTypeId: typeId } : {}), includeInactive: String(inactive) },
      })
      .then((r) => live && setRows(r.standards))
      .catch((e: unknown) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [typeId, inactive, version]);

  // Thai names where the catalog has them (staging QA 2026-11-25: they were English).
  const typeLabel = (s: GrowthStandardDTO) => localName(s.animalType, locale);
  const breedLabel = (s: GrowthStandardDTO) => {
    const breed = types
      ?.find((ty) => ty.id === s.animalType.id)
      ?.breeds?.find((b) => b.key === s.breed);
    return breed ? localName(breed, locale) : s.breed;
  };
  return (
    <>
      <h1>{t('growthStd.title')}</h1>
      <p className="adm-muted">{t('growthStd.intro')}</p>
      <div className="adm-filters">
        <label className="adm-field">
          <span>{t('growthStd.animalType')}</span>
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">{t('common.all')}</option>
            {types?.map((ty) => (
              <option key={ty.id} value={ty.id}>
                {localName(ty, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-check">
          <input
            type="checkbox"
            checked={inactive}
            onChange={(e) => setInactive(e.target.checked)}
          />{' '}
          {t('growthStd.showInactive')}
        </label>
      </div>
      {error && <StateMessage kind="error">{error}</StateMessage>}
      {!rows && !error && <StateMessage kind="loading" />}
      {rows && rows.length === 0 && (
        <StateMessage kind="empty">{t('growthStd.empty')}</StateMessage>
      )}
      {rows && rows.length > 0 && (
        <div className="adm-table-scroll">
          <table className="adm-table" aria-label={t('growthStd.title')}>
            <thead>
              <tr>
                <th scope="col">{t('growthStd.animalType')}</th>
                <th scope="col">{t('growthStd.breed')}</th>
                <th scope="col">{t('growthStd.sex')}</th>
                <th scope="col">{t('growthStd.kind')}</th>
                <th scope="col">{t('growthStd.ageRange')}</th>
                <th scope="col">{t('growthStd.bounds')}</th>
                <th scope="col">{t('growthStd.source')}</th>
                <th scope="col">{t('common.state')}</th>
                <th scope="col">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>{typeLabel(s)}</td>
                  <td>{s.breed ? breedLabel(s) : t('growthStd.allBreeds')}</td>
                  <td>{t(`growthStd.sex.${s.sex}`)}</td>
                  <td>{t(`growthStd.kind.${s.kind}`)}</td>
                  <td>
                    {s.ageFromDays}–{s.ageToDays}
                  </td>
                  <td>
                    {[
                      range(s.minWeightKg, s.maxWeightKg) &&
                        `${range(s.minWeightKg, s.maxWeightKg)} kg`,
                      range(s.minHeightCm, s.maxHeightCm) &&
                        `H ${range(s.minHeightCm, s.maxHeightCm)} cm`,
                      range(s.minLengthCm, s.maxLengthCm) &&
                        `L ${range(s.minLengthCm, s.maxLengthCm)} cm`,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </td>
                  <td>
                    {t(`growthStd.source.${s.source.kind}`)}
                    {s.source.citation && (
                      <small className="adm-muted"> · {s.source.citation}</small>
                    )}
                  </td>
                  <td>
                    <Tag value={s.active ? 'active' : 'inactive'} />
                  </td>
                  <td>
                    <button type="button" className="adm-btn" onClick={() => setEditing(s)}>
                      {t('common.edit')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p>
        <button
          type="button"
          className="adm-btn adm-btn--primary"
          onClick={() => setEditing('new')}
          disabled={!types?.length}
        >
          {t('growthStd.new')}
        </button>
      </p>
      {editing && types && (
        <StandardForm
          key={editing === 'new' ? 'new' : editing.id}
          standard={editing === 'new' ? null : editing}
          types={types}
          defaultTypeId={typeId || types[0]?.id || ''}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </>
  );
}

function StandardForm({
  standard,
  types,
  defaultTypeId,
  onClose,
  onSaved,
}: {
  standard: GrowthStandardDTO | null;
  types: AnimalTypeSummary[];
  defaultTypeId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, validation, locale } = useAdminI18n();
  const [f, setF] = useState<Form>(formOf(standard, defaultTypeId));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Form, v: string) => setF((x) => ({ ...x, [k]: v }));
  const type = types.find((ty) => ty.id === f.animalTypeId);
  const sized = f.kind === 'weight_for_age';

  const save = async (
    body: unknown,
    schema: typeof updateGrowthStandardSchema | typeof createGrowthStandardSchema,
  ) => {
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      return setErrors(
        Object.fromEntries(
          parsed.error.issues.map((i) => [i.path.join('.') || '_form', validation(i.message)]),
        ),
      );
    setBusy(true);
    setErrors({});
    try {
      if (standard)
        await api.request('PATCH', `/growth-standards/${standard.id}`, { body: parsed.data });
      else await api.request('POST', '/growth-standards', { body: parsed.data });
      onSaved();
    } catch (err) {
      const details = (err as { details?: { path: string; message: string }[] }).details;
      setErrors(
        details?.length
          ? Object.fromEntries(details.map((d) => [d.path, validation(d.message)]))
          : { _form: errorMessage(err) },
      );
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Empty optional values: omitted on create, cleared (null) on edit.
    const clear = standard ? null : undefined;
    const n = (v: string) => (v.trim() === '' ? clear : Number(v));
    const body = {
      ...(standard ? {} : { animalTypeId: f.animalTypeId, kind: f.kind }),
      breed: f.breed || clear,
      sex: f.sex,
      ageFromDays: Number(f.ageFromDays),
      ageToDays: Number(f.ageToDays),
      ...Object.fromEntries(BOUNDS.map((b) => [b, sized ? n(f[b]) : clear])),
      source: {
        kind: f.sourceKind,
        ...(f.citation.trim() ? { citation: f.citation.trim() } : {}),
        ...(f.note.trim() ? { note: f.note.trim() } : {}),
      },
    };
    void save(body, standard ? updateGrowthStandardSchema : createGrowthStandardSchema);
  };

  const input = (k: keyof Form, label: AdminKey, errorKey: string = k) => (
    <label className="adm-field">
      <span>{t(label)}</span>
      <input
        value={f[k]}
        inputMode="decimal"
        onChange={(e) => set(k, e.target.value)}
        aria-invalid={errors[errorKey] ? true : undefined}
      />
      {errors[errorKey] && <small className="adm-error">{errors[errorKey]}</small>}
    </label>
  );
  const select = (
    k: keyof Form,
    label: AdminKey,
    options: { value: string; label: string }[],
    disabled = false,
  ) => (
    <label className="adm-field">
      <span>{t(label)}</span>
      <select
        value={f[k]}
        disabled={disabled}
        onChange={(e) => set(k, e.target.value)}
        aria-invalid={errors[k] ? true : undefined}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {errors[k] && <small className="adm-error">{errors[k]}</small>}
    </label>
  );

  return (
    <form
      className="adm-card adm-form"
      onSubmit={submit}
      noValidate
      aria-label={standard ? t('growthStd.editTitle') : t('growthStd.newTitle')}
    >
      <h2 style={{ marginTop: 0 }}>
        {standard ? t('growthStd.editTitle') : t('growthStd.newTitle')}
      </h2>
      {errors['_form'] && (
        <p className="adm-error" role="alert">
          {errors['_form']}
        </p>
      )}
      {standard && <p className="adm-muted">{t('growthStd.fixedOnEdit')}</p>}
      {select(
        'animalTypeId',
        'growthStd.animalType',
        types.map((ty) => ({ value: ty.id, label: localName(ty, locale) })),
        Boolean(standard),
      )}
      {select(
        'kind',
        'growthStd.kind',
        GROWTH_STANDARD_KINDS.map((k) => ({ value: k, label: t(`growthStd.kind.${k}`) })),
        Boolean(standard),
      )}
      {select('breed', 'growthStd.breed', [
        { value: '', label: t('growthStd.allBreeds') },
        ...(type?.breeds ?? []).map((b) => ({ value: b.key, label: localName(b, locale) })),
      ])}
      {select(
        'sex',
        'growthStd.sex',
        GROWTH_STANDARD_SEXES.map((s) => ({ value: s, label: t(`growthStd.sex.${s}`) })),
      )}
      {input('ageFromDays', 'growthStd.ageFrom')}
      {input('ageToDays', 'growthStd.ageTo')}
      {sized && BOUNDS.map((b) => <div key={b}>{input(b, `growthStd.${b}`)}</div>)}
      {select(
        'sourceKind',
        'growthStd.source',
        GROWTH_SOURCE_KINDS.map((k) => ({ value: k, label: t(`growthStd.source.${k}`) })),
      )}
      {input('citation', 'growthStd.citation', 'source.citation')}
      {input('note', 'growthStd.note', 'source.note')}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="submit" className="adm-btn adm-btn--primary" disabled={busy}>
          {busy ? t('common.saving') : t('growthStd.save')}
        </button>
        {standard && (
          <button
            type="button"
            className={`adm-btn ${standard.active ? 'adm-btn--danger' : ''}`}
            disabled={busy}
            onClick={() => void save({ active: !standard.active }, updateGrowthStandardSchema)}
          >
            {standard.active ? t('action.deactivate') : t('action.reactivate')}
          </button>
        )}
        <button type="button" className="adm-btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
