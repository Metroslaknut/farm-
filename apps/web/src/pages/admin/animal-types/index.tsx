import { useEffect, useState, type FormEvent } from 'react';
import type { AnimalTypeSummary } from '@farmplus/shared-types';
import {
  addBreedSchema,
  createAnimalTypeSchema,
  updateAnimalTypeSchema,
  updateBreedSchema,
} from '@farmplus/validation';
import { api } from '../../../api';
import { StateMessage } from '../../../components/admin';
import { useAdminI18n } from '../../../components/admin/i18n';
import { errorMessage } from '../../../lib/format';
import { Tag } from '../finance-common';

type Errors = Record<string, string>;
const CONFIG = ['gestationDays', 'minBreedingAgeDays', 'maxWeightKg'] as const;
type ConfigKey = (typeof CONFIG)[number];

/** Empty → `undefined` (create) or `null` (update: clear the value); otherwise a number (NaN fails validation). */
const num = (v: string, clear: null | undefined) => (v.trim() === '' ? clear : Number(v));

function issuesToErrors(
  issues: { path: PropertyKey[]; message: string }[],
  validation: (m: string) => string,
): Errors {
  return Object.fromEntries(
    issues.map((i) => [String(i.path[0] ?? '_form'), validation(i.message)]),
  );
}

/** `/admin/animal-types` — the species catalogue (API: `/animal-types`, permission `animal_types.manage`). */
export default function AnimalTypesPage() {
  const { t, status } = useAdminI18n();
  const [types, setTypes] = useState<AnimalTypeSummary[]>();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<AnimalTypeSummary | 'new' | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .request<{ animalTypes: AnimalTypeSummary[] }>('GET', '/animal-types', {
        query: { includeInactive: 'true' },
      })
      .then((r) => {
        if (!live) return;
        setTypes(r.animalTypes);
        // Keep the open editor in sync with the reloaded data (e.g. after adding a breed).
        setEditing((e) =>
          e && e !== 'new' ? (r.animalTypes.find((x) => x.id === e.id) ?? null) : e,
        );
      })
      .catch((e: unknown) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [version]);
  const reload = () => setVersion((v) => v + 1);

  return (
    <>
      <h1>{t('species.title')}</h1>
      <p className="adm-muted">{t('species.intro')}</p>
      {error && <StateMessage kind="error">{error}</StateMessage>}
      {!types && !error && <StateMessage kind="loading" />}
      {types && types.length === 0 && (
        <StateMessage kind="empty">{t('species.empty')}</StateMessage>
      )}
      {types && types.length > 0 && (
        <div className="adm-table-scroll">
          <table className="adm-table" aria-label={t('species.title')}>
            <thead>
              <tr>
                <th scope="col">{t('common.name')}</th>
                <th scope="col">{t('species.key')}</th>
                <th scope="col">{t('species.breeds')}</th>
                <th scope="col">{t('species.config')}</th>
                <th scope="col">{t('common.state')}</th>
                <th scope="col">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {types.map((type) => (
                <tr key={type.id}>
                  <td>
                    {type.name}
                    {type.nameTh && <small className="adm-muted"> · {type.nameTh}</small>}
                  </td>
                  <td>
                    <code>{type.key}</code>
                  </td>
                  <td>
                    {type.breeds.length
                      ? type.breeds
                          .map((b) => (b.active ? b.name : `${b.name} (${status('inactive')})`))
                          .join(', ')
                      : '—'}
                  </td>
                  <td>
                    {CONFIG.filter((k) => type[k] !== undefined)
                      .map((k) => `${t(`species.${k}`)}: ${type[k]}`)
                      .join(' · ') || '—'}
                  </td>
                  <td>
                    <Tag value={type.status} />
                  </td>
                  <td>
                    <button type="button" className="adm-btn" onClick={() => setEditing(type)}>
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
        >
          {t('species.new')}
        </button>
      </p>
      {editing && (
        <TypeForm
          key={editing === 'new' ? 'new' : editing.id}
          type={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(close) => {
            if (close) setEditing(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function TypeForm({
  type,
  onClose,
  onSaved,
}: {
  type: AnimalTypeSummary | null;
  onClose: () => void;
  onSaved: (close: boolean) => void;
}) {
  const { t, validation } = useAdminI18n();
  const [f, setF] = useState({
    key: '',
    name: type?.name ?? '',
    nameTh: type?.nameTh ?? '',
    ...(Object.fromEntries(
      CONFIG.map((k) => [k, type?.[k] === undefined ? '' : String(type[k])]),
    ) as Record<ConfigKey, string>),
  });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const run = async (call: () => Promise<unknown>, close: boolean) => {
    setBusy(true);
    setErrors({});
    try {
      await call();
      onSaved(close);
    } catch (err) {
      setErrors({ _form: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const clear = type ? null : undefined;
    const body = {
      ...(type ? {} : { key: f.key.trim() }),
      name: f.name.trim(),
      nameTh: f.nameTh.trim() || clear,
      ...Object.fromEntries(CONFIG.map((k) => [k, num(f[k], clear)])),
    };
    const parsed = (type ? updateAnimalTypeSchema : createAnimalTypeSchema).safeParse(body);
    if (!parsed.success) return setErrors(issuesToErrors(parsed.error.issues, validation));
    await run(
      () =>
        type
          ? api.request('PATCH', `/animal-types/${type.id}`, { body: parsed.data })
          : api.request('POST', '/animal-types', { body: parsed.data }),
      true,
    );
  };

  const field = (k: keyof typeof f, label: string, hint?: string, inputMode?: 'numeric') => (
    <label className="adm-field">
      <span>{label}</span>
      <input
        value={f[k]}
        inputMode={inputMode}
        onChange={(e) => set(k, e.target.value)}
        aria-invalid={errors[k] ? true : undefined}
      />
      {hint && <small className="adm-muted">{hint}</small>}
      {errors[k] && <small className="adm-error">{errors[k]}</small>}
    </label>
  );

  return (
    <div className="adm-card adm-form">
      <form
        onSubmit={submit}
        noValidate
        aria-label={type ? t('species.editTitle', { name: type.name }) : t('species.new')}
      >
        <h2 style={{ marginTop: 0 }}>
          {type ? t('species.editTitle', { name: type.name }) : t('species.new')}
        </h2>
        {errors['_form'] && (
          <p className="adm-error" role="alert">
            {errors['_form']}
          </p>
        )}
        {!type && field('key', t('species.key'), t('species.keyHint'))}
        {field('name', t('common.name'))}
        {field('nameTh', t('species.nameTh'))}
        {CONFIG.map((k) => (
          <div key={k}>{field(k, t(`species.${k}`), t('species.configHint'), 'numeric')}</div>
        ))}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="submit" className="adm-btn adm-btn--primary" disabled={busy}>
            {busy ? t('common.saving') : t('species.save')}
          </button>
          {type && (
            <button
              type="button"
              className={`adm-btn ${type.status === 'active' ? 'adm-btn--danger' : ''}`}
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    api.request('PATCH', `/animal-types/${type.id}`, {
                      body: { status: type.status === 'active' ? 'inactive' : 'active' },
                    }),
                  true,
                )
              }
            >
              {type.status === 'active' ? t('action.deactivate') : t('action.reactivate')}
            </button>
          )}
          <button type="button" className="adm-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
      {type && <Breeds type={type} onChanged={() => onSaved(false)} />}
    </div>
  );
}

function Breeds({ type, onChanged }: { type: AnimalTypeSummary; onChanged: () => void }) {
  const { t, validation } = useAdminI18n();
  const [f, setF] = useState({ key: '', name: '', nameTh: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  const call = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErrors({});
    try {
      await fn();
      onChanged();
      return true;
    } catch (err) {
      setErrors({ _form: errorMessage(err) });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = addBreedSchema.safeParse({
      key: f.key.trim(),
      name: f.name.trim(),
      ...(f.nameTh.trim() ? { nameTh: f.nameTh.trim() } : {}),
    });
    if (!parsed.success) return setErrors(issuesToErrors(parsed.error.issues, validation));
    if (
      await call(() =>
        api.request('POST', `/animal-types/${type.id}/breeds`, { body: parsed.data }),
      )
    )
      setF({ key: '', name: '', nameTh: '' });
  };
  const toggle = (key: string, active: boolean) => {
    const body = updateBreedSchema.parse({ active });
    void call(() => api.request('PATCH', `/animal-types/${type.id}/breeds/${key}`, { body }));
  };

  return (
    <section aria-label={t('species.breeds')}>
      <h3>{t('species.breeds')}</h3>
      {errors['_form'] && (
        <p className="adm-error" role="alert">
          {errors['_form']}
        </p>
      )}
      <ul>
        {type.breeds.map((b) => (
          <li key={b.key}>
            {b.name}
            {b.nameTh && ` · ${b.nameTh}`} <code>{b.key}</code>{' '}
            <Tag value={b.active ? 'active' : 'inactive'} />{' '}
            <button
              type="button"
              className="adm-btn"
              disabled={busy}
              onClick={() => toggle(b.key, !b.active)}
            >
              {b.active ? t('action.deactivate') : t('action.reactivate')}
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} noValidate aria-label={t('species.addBreed')} className="adm-filters">
        {(['key', 'name', 'nameTh'] as const).map((k) => (
          <label key={k} className="adm-field">
            <span>
              {k === 'key'
                ? t('species.key')
                : k === 'name'
                  ? t('common.name')
                  : t('species.nameTh')}
            </span>
            <input
              value={f[k]}
              onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))}
              aria-invalid={errors[k] ? true : undefined}
            />
            {errors[k] && <small className="adm-error">{errors[k]}</small>}
          </label>
        ))}
        <button type="submit" className="adm-btn" disabled={busy}>
          {t('species.addBreed')}
        </button>
      </form>
    </section>
  );
}
